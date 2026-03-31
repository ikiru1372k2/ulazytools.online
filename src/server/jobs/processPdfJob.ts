import "server-only";

import { prisma } from "@/lib/db";

import type { PdfJobPayload } from "@/lib/queue";

export type ProcessPdfJobResult = {
  outputKey: string;
};

function buildOutputKey(jobId: string) {
  return `outputs/${jobId}/processed.pdf`;
}

export async function processPdfJob(
  payload: PdfJobPayload
): Promise<ProcessPdfJobResult> {
  const dbJob = await prisma.job.findUnique({
    where: {
      id: payload.jobId,
    },
    select: {
      id: true,
      inputRef: true,
      type: true,
    },
  });

  if (!dbJob) {
    throw new Error(`Job "${payload.jobId}" was not found`);
  }

  if (dbJob.type !== payload.type) {
    throw new Error(
      `Job "${dbJob.id}" has type "${dbJob.type}" but queue payload requested "${payload.type}"`
    );
  }

  console.log(
    `[pdfWorker] stub processing job ${dbJob.id} (${payload.type}) input=${
      dbJob.inputRef ?? "n/a"
    }`
  );

  return {
    outputKey: buildOutputKey(dbJob.id),
  };
}
