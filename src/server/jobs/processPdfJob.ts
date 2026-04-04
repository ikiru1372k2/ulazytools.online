import "server-only";

import { prisma } from "@/lib/db";
import { InternalAppError, NotFoundError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { buildObjectKey, buildObjectTags } from "@/lib/objectKey";
import { uploadBuffer } from "@/lib/storage";

import type { PdfJobPayload } from "@/lib/queue";

export type ProcessPdfJobResult = {
  outputKey: string;
  userId: string | null;
};

const STUB_PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  "utf8"
);

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
      guestId: true,
      id: true,
      inputRef: true,
      type: true,
      userId: true,
    },
  });

  if (!dbJob) {
    log.error("PDF job record was not found");
    throw new NotFoundError(`Job "${payload.jobId}" was not found`, {
      code: "JOB_NOT_FOUND",
    });
  }

  if (dbJob.type !== payload.type) {
    log.error(
      {
        actualType: dbJob.type,
        requestedType: payload.type,
      },
      "PDF job payload type does not match the database record"
    );
    throw new ValidationError(
      `Job "${dbJob.id}" has type "${dbJob.type}" but queue payload requested "${payload.type}"`,
      {
        code: "JOB_TYPE_MISMATCH",
        httpStatus: 409,
      }
    );
  }

  createLogger({
    jobId: dbJob.id,
    requestId: payload.requestId,
    userId: dbJob.userId,
  }).info(
    {
      hasInputRef: Boolean(dbJob.inputRef),
      jobType: payload.type,
    },
    "Stub processing PDF job"
  );

  const outputKey = buildObjectKey({
    filename: "processed.pdf",
    guestId: dbJob.guestId,
    jobId: dbJob.id,
    kind: "output",
    userId: dbJob.userId,
  });

  try {
    await uploadBuffer(outputKey, STUB_PDF_BYTES, "application/pdf", {
      tags: buildObjectTags({
        jobId: dbJob.id,
      }),
    });
  } catch (error) {
    throw new InternalAppError("Unable to persist processed PDF output", {
      code: "PDF_OUTPUT_WRITE_FAILED",
      logContext: {
        outputKey,
      },
    });
  }

  return {
    outputKey,
    userId: dbJob.userId,
  };
}
