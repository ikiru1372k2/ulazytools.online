import "server-only";

import { prisma } from "@/lib/db";
import {
  InternalAppError,
  isAppError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { buildObjectKey, buildObjectTags } from "@/lib/objectKey";
import { uploadBuffer } from "@/lib/storage";
import { mergePdf } from "@/server/pdf/mergePdf";

import type { PdfJobPayload } from "@/lib/queue";

export type ProcessPdfJobResult = {
  outputKey: string;
  userId: string | null;
};

const STUB_PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  "utf8"
);

type MergeInputRef = {
  inputFileIds?: unknown;
  options?: {
    pageOrder?: unknown;
  };
};

const FILE_OBJECT_READY = "READY";
const PDF_MIME_TYPE = "application/pdf";

function parseMergeInputRef(inputRef: string | null) {
  if (!inputRef) {
    throw new ValidationError("Merge job input is missing.", {
      code: "JOB_INPUT_MISSING",
    });
  }

  let parsed: MergeInputRef;

  try {
    parsed = JSON.parse(inputRef) as MergeInputRef;
  } catch {
    throw new ValidationError("Merge job input is invalid.", {
      code: "JOB_INPUT_INVALID",
    });
  }

  if (
    !Array.isArray(parsed.inputFileIds) ||
    parsed.inputFileIds.some(
      (value) => typeof value !== "string" || !value.trim()
    )
  ) {
    throw new ValidationError("Merge job input is invalid.", {
      code: "JOB_INPUT_INVALID",
    });
  }

  if (
    !parsed.options ||
    !Array.isArray(parsed.options.pageOrder) ||
    parsed.options.pageOrder.some(
      (value) => !Number.isInteger(value) || value < 0
    )
  ) {
    throw new ValidationError("Merge job page order is invalid.", {
      code: "INVALID_PAGE_ORDER",
    });
  }

  if (parsed.options.pageOrder.length !== parsed.inputFileIds.length) {
    throw new ValidationError("Merge job page order is invalid.", {
      code: "INVALID_PAGE_ORDER",
    });
  }

  const expectedOrder = new Set(
    parsed.inputFileIds.map((_, index) => index)
  );
  const actualOrder = new Set(parsed.options.pageOrder);

  if (
    actualOrder.size !== expectedOrder.size ||
    parsed.options.pageOrder.some((value) => !expectedOrder.has(value))
  ) {
    throw new ValidationError("Merge job page order is invalid.", {
      code: "INVALID_PAGE_ORDER",
    });
  }

  return {
    inputFileIds: parsed.inputFileIds,
    pageOrder: parsed.options.pageOrder,
  };
}

async function processStubPdfJob(dbJob: {
  guestId: string | null;
  id: string;
  inputRef: string | null;
  type: PdfJobPayload["type"];
  userId: string | null;
}): Promise<ProcessPdfJobResult> {
  createLogger({
    jobId: dbJob.id,
    userId: dbJob.userId ?? undefined,
  }).info(
    {
      hasInputRef: Boolean(dbJob.inputRef),
      jobType: dbJob.type,
    },
    "Stub processing PDF job"
  );

  const outputFilename =
    dbJob.type === "pdf.merge" ? "merged.pdf" : "processed.pdf";

  const outputKey = buildObjectKey({
    filename: outputFilename,
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
    if (isAppError(error)) {
      throw error;
    }

    throw new InternalAppError("Unable to persist processed PDF output", {
      code: "PDF_OUTPUT_WRITE_FAILED",
      logContext: {
        cause:
          error instanceof Error ? error.message : "Unknown output write failure",
        outputKey,
      },
    });
  }

  return {
    outputKey,
    userId: dbJob.userId,
  };
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
    userId: dbJob.userId ?? undefined,
  }).info(
    {
      hasInputRef: Boolean(dbJob.inputRef),
      jobType: payload.type,
    },
    "Starting PDF job processor"
  );

  if (payload.type === "process") {
    return processStubPdfJob({
      ...dbJob,
      type: payload.type,
    });
  }

  if (payload.type === "pdf.merge") {
    const mergeInput = parseMergeInputRef(dbJob.inputRef);
    const fileObjects = await prisma.fileObject.findMany({
      select: {
        id: true,
        objectKey: true,
      },
      where: {
        id: {
          in: mergeInput.inputFileIds,
        },
        mimeType: PDF_MIME_TYPE,
        status: FILE_OBJECT_READY,
        ...(dbJob.userId
          ? {
              userId: dbJob.userId,
            }
          : {
              guestId: dbJob.guestId ?? "__missing_guest__",
              userId: null,
            }),
      },
    });
    const filesById = new Map(fileObjects.map((file) => [file.id, file]));

    const inputFiles = mergeInput.inputFileIds.map((fileId) => {
      const file = filesById.get(fileId);

      if (!file) {
        throw new NotFoundError("One or more PDFs are missing for this merge job.", {
          code: "PDF_INPUT_NOT_FOUND",
        });
      }

      return {
        fileId: file.id,
        objectKey: file.objectKey,
      };
    });

    return mergePdf({
      guestId: dbJob.guestId,
      inputFiles,
      jobId: dbJob.id,
      pageOrder: mergeInput.pageOrder,
      requestId: payload.requestId,
      userId: dbJob.userId,
    });
  }

  throw new ValidationError(`Unsupported PDF job type "${payload.type}"`, {
    code: "JOB_TYPE_MISMATCH",
    httpStatus: 409,
  });
}
