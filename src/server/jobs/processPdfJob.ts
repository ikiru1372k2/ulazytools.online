import "server-only";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

import type { PdfJobPayload } from "@/lib/queue";

export type ProcessPdfJobResult = {
  outputKey: string;
  userId: string | null;
};

function buildOutputKey(jobId: string) {
  return `outputs/${jobId}/processed.pdf`;
}

export async function processPdfJob(
  payload: PdfJobPayload
): Promise<ProcessPdfJobResult> {
  const log = createLogger({
    jobId: payload.jobId,
    requestId: payload.requestId,
  });

  const dbJob = await prisma.job.findUnique({
    where: {
      id: payload.jobId,
    },
    select: {
      id: true,
      inputRef: true,
      type: true,
      userId: true,
    },
  });

  if (!dbJob) {
    log.error("PDF job record was not found");
    throw new Error(`Job "${payload.jobId}" was not found`);
  }

  if (dbJob.type !== payload.type) {
    log.error(
      {
        actualType: dbJob.type,
        requestedType: payload.type,
      },
      "PDF job payload type does not match the database record"
    );
    throw new Error(
      `Job "${dbJob.id}" has type "${dbJob.type}" but queue payload requested "${payload.type}"`
    );
  }

  createLogger({
    jobId: dbJob.id,
    requestId: payload.requestId,
    userId: dbJob.userId,
  }).info(
    {
      inputRef: dbJob.inputRef ?? "n/a",
      jobType: payload.type,
    },
    "Stub processing PDF job"
  );

  return {
    outputKey: buildOutputKey(dbJob.id),
    userId: dbJob.userId,
  };
}
