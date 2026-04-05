import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { toErrorResponse } from "@/app/api/_utils/http";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  ConflictError,
  InternalAppError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  GUEST_ID_COOKIE,
  INTERNAL_GUEST_ID_HEADER,
  INTERNAL_GUEST_ID_TRUST_HEADER,
  isGuestId,
  verifyGuestCookieValue,
} from "@/lib/guest";
import { createLogger } from "@/lib/logger";
import { enqueuePdfJob, type PdfJobType } from "@/lib/queue";
import { normalizeRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import { splitPdfRangesSchema } from "@/lib/splitPdfRanges";

const FILE_OBJECT_READY = "READY";
const SUPPORTED_JOB_TYPE = "split_pdf_ranges" satisfies PdfJobType;

const createJobBodySchema = z.object({
  inputKeys: z.array(z.string().trim().min(1)).length(1),
  jobType: z.literal(SUPPORTED_JOB_TYPE),
  options: z.object({
    ranges: splitPdfRangesSchema,
  }),
});

function canAccessFile(
  file: { guestId: string | null; userId: string | null },
  access: { guestId?: string; userId?: string }
) {
  const isAuthorizedUser = Boolean(
    access.userId && file.userId === access.userId
  );
  const isAuthorizedGuest = Boolean(
    !file.userId &&
      access.guestId &&
      file.guestId &&
      access.guestId === file.guestId
  );

  return isAuthorizedUser || isAuthorizedGuest;
}

async function parseCreateJobBody(request: NextRequest) {
  try {
    return createJobBodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      throw new ValidationError(issue?.message || "Invalid job request", {
        code: "INVALID_JOB_REQUEST",
      });
    }

    throw error;
  }
}

export async function POST(request: NextRequest) {
  const requestId = normalizeRequestId(request.headers.get(REQUEST_ID_HEADER));
  const session = await auth();
  const userId = session?.user?.id;
  const forwardedGuestId = request.headers
    .get(INTERNAL_GUEST_ID_HEADER)
    ?.trim();
  const trustedGuestHeader =
    request.headers.get(INTERNAL_GUEST_ID_TRUST_HEADER) === "1";
  const trustedGuestId =
    trustedGuestHeader && forwardedGuestId && isGuestId(forwardedGuestId)
      ? forwardedGuestId
      : null;
  const guestId = userId
    ? undefined
    : trustedGuestId ||
      (await verifyGuestCookieValue(request.cookies.get(GUEST_ID_COOKIE)?.value)) ||
      undefined;
  const log = createLogger({
    requestId,
    userId,
  });

  try {
    const body = await parseCreateJobBody(request);
    const [inputKey] = body.inputKeys;
    const file = await prisma.fileObject.findUnique({
      where: {
        objectKey: inputKey,
      },
      select: {
        guestId: true,
        id: true,
        mimeType: true,
        objectKey: true,
        status: true,
        userId: true,
      },
    });

    if (!file || !canAccessFile(file, { guestId, userId })) {
      return toErrorResponse(
        new NotFoundError("File not found", { code: "FILE_NOT_FOUND" }),
        {
          cacheControl: "no-store",
        }
      );
    }

    if (file.status !== FILE_OBJECT_READY) {
      return toErrorResponse(
        new ConflictError("Uploaded file is not ready yet", {
          code: "FILE_NOT_READY",
          httpStatus: 409,
        }),
        {
          cacheControl: "no-store",
        }
      );
    }

    if (file.mimeType !== "application/pdf") {
      return toErrorResponse(
        new ValidationError("Only PDF files can be split.", {
          code: "FILE_INVALID_TYPE",
        }),
        {
          cacheControl: "no-store",
        }
      );
    }

    const job = await prisma.job.create({
      data: {
        fileObjectId: file.id,
        guestId: guestId ?? null,
        inputRef: file.objectKey,
        type: body.jobType,
        userId: userId ?? null,
      },
      select: {
        id: true,
      },
    });

    try {
      await enqueuePdfJob({
        inputKey: file.objectKey,
        jobId: job.id,
        options: {
          ranges: body.options.ranges,
        },
        requestId,
        type: body.jobType,
      });
    } catch (error) {
      await prisma.job.update({
        where: {
          id: job.id,
        },
        data: {
          completedAt: new Date(),
          errorCode: "JOB_ENQUEUE_FAILED",
          errorMessage: "Unable to start the split job.",
          status: "FAILED",
        },
      });

      throw error;
    }

    log.info(
      {
        fileId: file.id,
        guestId,
        jobId: job.id,
        jobType: body.jobType,
      },
      "Created PDF tool job"
    );

    return NextResponse.json(
      {
        jobId: job.id,
        status: "pending",
      },
      {
        status: 201,
      }
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return toErrorResponse(error, {
        cacheControl: "no-store",
      });
    }

    log.error(
      {
        err: error,
        guestId,
      },
      "Failed to create PDF tool job"
    );

    return toErrorResponse(
      new InternalAppError("Unable to create PDF job", {
        code: "JOB_CREATE_FAILED",
      }),
      {
        cacheControl: "no-store",
      }
    );
  }
}
