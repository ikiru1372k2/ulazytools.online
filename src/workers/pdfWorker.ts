import { Worker, type Job as BullJob } from "bullmq";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import {
  PDF_QUEUE_NAME,
  createRedisConnection,
  type PdfJobPayload,
} from "@/lib/queue";
import { processPdfJob } from "@/server/jobs/processPdfJob";

type ManagedResource = {
  close: () => Promise<unknown>;
  name: string;
};

type WorkerManagedStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
type JobEventLevel = "error" | "info";
type SafeErrorDetails = {
  code: string;
  message: string;
};
type LifecycleEvent = {
  level: JobEventLevel;
  message: string;
  metadata?: Record<string, string>;
};

const workerConnection = createRedisConnection();
let isShuttingDown = false;
const workerLogger = createLogger({
  queue: PDF_QUEUE_NAME,
});

function clamp(value: string, maxLength: number) {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function getErrorDetails(error: unknown): SafeErrorDetails {
  if (error instanceof Error) {
    return {
      code: clamp(error.name || "WorkerError", 191),
      message: sanitizePersistedErrorMessage(error.message),
    };
  }

  return {
    code: "WorkerError",
    message: "Unknown PDF worker failure",
  };
}

function sanitizePersistedErrorMessage(message: string) {
  const trimmed = message.trim();

  if (!trimmed) {
    return "PDF processing failed.";
  }

  return clamp(trimmed.replace(/\s+/g, " "), 500);
}

async function getJobStatus(jobId: string) {
  const job = await prisma.job.findUnique({
    where: {
      id: jobId,
    },
    select: {
      status: true,
    },
  });

  return job?.status;
}

async function expectStatusUpdate(
  tx: { job: typeof prisma.job; jobEvent: typeof prisma.jobEvent },
  jobId: string,
  nextStatus: WorkerManagedStatus,
  allowedCurrentStatuses: WorkerManagedStatus[],
  data: Record<string, unknown>,
  event: LifecycleEvent
) {
  const result = await tx.job.updateMany({
    where: {
      id: jobId,
      status: {
        in: allowedCurrentStatuses,
      },
    },
    data,
  });

  if (result.count > 0) {
    await tx.jobEvent.create({
      data: {
        jobId,
        level: event.level,
        message: event.message,
        metadata: event.metadata,
      },
    });
    return;
  }

  const currentStatus = await getJobStatus(jobId);

  if (!currentStatus) {
    throw new Error(`Job "${jobId}" was not found while marking ${nextStatus}`);
  }

  throw new Error(
    `Job "${jobId}" cannot transition from ${currentStatus} to ${nextStatus}`
  );
}

async function markRunning(jobId: string, payload: PdfJobPayload) {
  const startedAt = new Date();

  await prisma.$transaction(
    async (tx: { job: typeof prisma.job; jobEvent: typeof prisma.jobEvent }) => {
    await expectStatusUpdate(
      tx,
      jobId,
      "RUNNING",
      ["PENDING", "FAILED"],
      {
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        outputRef: null,
        startedAt,
        status: "RUNNING",
      },
      {
        level: "info",
        message: "PDF job started.",
        metadata: {
          queue: PDF_QUEUE_NAME,
          queueJobType: payload.type,
        },
      }
    );
    }
  );

  return startedAt;
}

async function markSucceeded(
  jobId: string,
  payload: PdfJobPayload,
  outputKey: string
) {
  const completedAt = new Date();

  await prisma.$transaction(
    async (tx: { job: typeof prisma.job; jobEvent: typeof prisma.jobEvent }) => {
    await expectStatusUpdate(
      tx,
      jobId,
      "SUCCEEDED",
      ["RUNNING"],
      {
        completedAt,
        errorCode: null,
        errorMessage: null,
        outputRef: outputKey,
        status: "SUCCEEDED",
      },
      {
        level: "info",
        message: "PDF job completed.",
        metadata: {
          outputKey,
          queue: PDF_QUEUE_NAME,
          queueJobType: payload.type,
        },
      }
    );
    }
  );
}

async function markFailed(jobId: string, error: unknown) {
  const completedAt = new Date();
  const details = getErrorDetails(error);

  await prisma.$transaction(
    async (tx: { job: typeof prisma.job; jobEvent: typeof prisma.jobEvent }) => {
    await expectStatusUpdate(
      tx,
      jobId,
      "FAILED",
      ["PENDING", "RUNNING"],
      {
        completedAt,
        errorCode: details.code,
        errorMessage: details.message,
        outputRef: null,
        status: "FAILED",
      },
      {
        level: "error",
        message: "PDF job failed.",
        metadata: {
          errorCode: details.code,
          errorMessage: details.message,
          queue: PDF_QUEUE_NAME,
        },
      }
    );
    }
  );
}

async function markFailedSafely(jobId: string, error: unknown) {
  try {
    await markFailed(jobId, error);
  } catch (markFailedError) {
    createLogger({ jobId, queue: PDF_QUEUE_NAME }).error(
      { err: markFailedError },
      "Failed to persist job FAILED state"
    );
  }
}

async function processQueueJob(job: BullJob<PdfJobPayload>) {
  const log = createLogger({
    jobId: job.data.jobId,
    queue: PDF_QUEUE_NAME,
    requestId: job.data.requestId,
  });

  log.info(
    {
      bullJobId: job.id,
      queueJobType: job.name,
    },
    "Picked up PDF queue job"
  );

  await markRunning(job.data.jobId, job.data);

  try {
    const result = await processPdfJob(job.data);
    const completedLog = createLogger({
      jobId: job.data.jobId,
      queue: PDF_QUEUE_NAME,
      requestId: job.data.requestId,
      userId: result.userId,
    });

    await markSucceeded(job.data.jobId, job.data, result.outputKey);

    completedLog.info(
      {
        outputKey: result.outputKey,
      },
      "Completed PDF queue job"
    );

    return result;
  } catch (error) {
    log.error({ err: error }, "PDF queue job failed");
    await markFailedSafely(job.data.jobId, error);
    throw error;
  }
}

const worker = new Worker<PdfJobPayload>(PDF_QUEUE_NAME, processQueueJob, {
  connection: workerConnection,
  concurrency: 1,
});

worker.on("ready", () => {
  workerLogger.info('Listening for PDF jobs');
});

worker.on("completed", (job) => {
  createLogger({
    jobId: job.data.jobId,
    queue: PDF_QUEUE_NAME,
    requestId: job.data.requestId,
  }).info(
    {
      bullJobId: job.id,
    },
    "BullMQ marked job as completed"
  );
});

worker.on("failed", (job, error) => {
  const details = getErrorDetails(error);

  createLogger({
    jobId: job?.data.jobId,
    queue: PDF_QUEUE_NAME,
    requestId: job?.data.requestId,
  }).error(
    {
      bullJobId: job?.id,
      errorCode: details.code,
      errorMessage: details.message,
    },
    "BullMQ marked job as failed"
  );
});

async function shutdown(resources: ManagedResource[], signal: string) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  workerLogger.info({ signal }, "Shutting down PDF worker");

  for (const resource of resources) {
    try {
      await resource.close();
    } catch (error) {
      workerLogger.error(
        {
          err: error,
          resource: resource.name,
        },
        "Failed to close worker resource cleanly"
      );
    }
  }

  process.exit(0);
}

function registerShutdown(resources: ManagedResource[]) {
  const handleSignal = (signal: string) => {
    void shutdown(resources, signal);
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
}

registerShutdown([
  {
    name: "worker",
    close: () => worker.close(),
  },
  {
    name: "redis connection",
    close: () => workerConnection.quit(),
  },
  {
    name: "prisma",
    close: () => prisma.$disconnect(),
  },
]);
