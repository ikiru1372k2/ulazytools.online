import "server-only";

import { Queue, type JobsOptions } from "bullmq";
import IORedis, { type RedisOptions } from "ioredis";
import { getQueueEnv } from "@/lib/env";

const queueEnv = getQueueEnv();

export const PDF_QUEUE_NAME = "pdf-jobs";
export const PDF_JOB_TYPES = ["process"] as const;
const PDF_JOB_TYPE_SET = new Set<string>(PDF_JOB_TYPES);

export type PdfJobType = (typeof PDF_JOB_TYPES)[number];

export type PdfJobPayload = {
  jobId: string;
  type: PdfJobType;
};

const globalForQueue = globalThis as typeof globalThis & {
  pdfQueue?: Queue<PdfJobPayload>;
  pdfQueueConnection?: IORedis;
};

function getRedisOptions(): RedisOptions {
  return {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  };
}

export function getRedisUrl() {
  return queueEnv.REDIS_URL;
}

export function createRedisConnection() {
  return new IORedis(getRedisUrl(), getRedisOptions());
}

function getSharedQueueConnection() {
  if (!globalForQueue.pdfQueueConnection) {
    globalForQueue.pdfQueueConnection = createRedisConnection();
  }

  return globalForQueue.pdfQueueConnection;
}

export function getPdfQueue() {
  if (!globalForQueue.pdfQueue) {
    globalForQueue.pdfQueue = new Queue<PdfJobPayload>(PDF_QUEUE_NAME, {
      connection: getSharedQueueConnection(),
      defaultJobOptions: getDefaultPdfJobOptions(),
    });
  }

  return globalForQueue.pdfQueue;
}

export function getDefaultPdfJobOptions(): JobsOptions {
  return {
    attempts: 3,
    backoff: {
      delay: 5000,
      type: "exponential",
    },
    removeOnComplete: 100,
    removeOnFail: 100,
  };
}

function normalizePdfJobPayload(payload: PdfJobPayload): PdfJobPayload {
  const normalizedPayload = {
    jobId: payload.jobId.trim(),
    type: payload.type,
  } satisfies PdfJobPayload;

  if (!normalizedPayload.jobId) {
    throw new Error("enqueuePdfJob requires a non-empty jobId");
  }

  if (!PDF_JOB_TYPE_SET.has(normalizedPayload.type)) {
    throw new Error(`Unsupported PDF job type: ${normalizedPayload.type}`);
  }

  return normalizedPayload;
}

export async function enqueuePdfJob(payload: PdfJobPayload) {
  const normalizedPayload = normalizePdfJobPayload(payload);
  const queuedJob = await getPdfQueue().add(
    normalizedPayload.type,
    normalizedPayload,
    {
      ...getDefaultPdfJobOptions(),
      jobId: normalizedPayload.jobId,
    }
  );

  if (queuedJob.name !== normalizedPayload.type) {
    throw new Error(
      `Queue job "${normalizedPayload.jobId}" already exists with type "${queuedJob.name}"`
    );
  }

  return queuedJob;
}
