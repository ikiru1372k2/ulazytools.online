import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { createJobRequestSchema } from "@/lib/jobs/merge";

const FILE_OBJECT_READY = "READY";
const PDF_MIME_TYPE = "application/pdf";

export type ValidateJobInputAccess = {
  guestId?: string;
  userId?: string;
};

export type ValidatedMergeJobInput = {
  files: Array<{
    id: string;
    mimeType: string;
    objectKey: string;
  }>;
  inputFileIds: string[];
  jobType: "pdf.merge";
  options: {
    pageOrder: number[];
  };
};

export async function parseAndValidateMergeJobInput(
  payload: unknown,
  access: ValidateJobInputAccess
): Promise<ValidatedMergeJobInput> {
  const parsed = createJobRequestSchema.safeParse(payload);

  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message || "Invalid job request payload",
      {
        code: "INVALID_JOB_REQUEST",
        logContext: {
          details: parsed.error.issues.map((issue) => ({
            message: issue.message,
            path: issue.path.join("."),
          })),
        },
      }
    );
  }

  if (parsed.data.options.pageOrder.length !== parsed.data.inputFileIds.length) {
    throw new ValidationError(
      "Page order must include each uploaded PDF exactly once.",
      {
        code: "INVALID_PAGE_ORDER",
        logContext: {
          details: [
            {
              message: "pageOrder length must match inputFileIds length.",
              path: "options.pageOrder",
            },
          ],
        },
      }
    );
  }

  const expectedPageOrder = new Set(
    Array.from(
      {
        length: parsed.data.inputFileIds.length,
      },
      (_, index) => index
    )
  );
  const providedPageOrder = new Set(parsed.data.options.pageOrder);

  if (
    providedPageOrder.size !== expectedPageOrder.size ||
    parsed.data.options.pageOrder.some((index) => !expectedPageOrder.has(index))
  ) {
    throw new ValidationError(
      "Page order must be a zero-based permutation of the uploaded PDFs.",
      {
        code: "INVALID_PAGE_ORDER",
        logContext: {
          details: [
            {
              message:
                "pageOrder must contain each index from 0 to inputFileIds.length - 1 exactly once.",
              path: "options.pageOrder",
            },
          ],
        },
      }
    );
  }

  const files = await prisma.fileObject.findMany({
    select: {
      id: true,
      mimeType: true,
      objectKey: true,
    },
    where: {
      id: {
        in: parsed.data.inputFileIds,
      },
      mimeType: PDF_MIME_TYPE,
      status: FILE_OBJECT_READY,
      ...(access.userId
        ? {
            userId: access.userId,
          }
        : {
            guestId: access.guestId ?? "__missing_guest__",
            userId: null,
          }),
    },
  });

  if (files.length !== parsed.data.inputFileIds.length) {
    throw new NotFoundError("One or more uploaded PDFs are unavailable.", {
      code: "UPLOADS_NOT_FOUND",
    });
  }

  const filesById = new Map(files.map((file) => [file.id, file]));
  const orderedFiles = parsed.data.inputFileIds.map((inputFileId) =>
    filesById.get(inputFileId)
  );

  if (orderedFiles.some((file) => !file)) {
    throw new NotFoundError("One or more uploaded PDFs are unavailable.", {
      code: "UPLOADS_NOT_FOUND",
    });
  }

  return {
    files: orderedFiles.filter(
      (
        file
      ): file is {
        id: string;
        mimeType: string;
        objectKey: string;
      } => Boolean(file)
    ),
    inputFileIds: parsed.data.inputFileIds,
    jobType: parsed.data.jobType,
    options: parsed.data.options,
  };
}
