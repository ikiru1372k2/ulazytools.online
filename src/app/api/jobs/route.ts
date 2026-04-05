import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { toErrorResponse } from "@/app/api/_utils/http";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  ConflictError,
  InternalAppError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "@/lib/errors";
import {
  GUEST_ID_COOKIE,
  INTERNAL_GUEST_ID_HEADER,
  INTERNAL_GUEST_ID_TRUST_HEADER,
  isGuestId,
  verifyGuestCookieValue,
} from "@/lib/guest";
import {
  createJobRequestSchema,
  type CreateJobRequest,
} from "@/lib/jobs/merge";
import { createLogger } from "@/lib/logger";
import { enqueuePdfJob } from "@/lib/queue";
import { normalizeRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import { assertJobCreateAllowed } from "@/server/jobs/createRateLimit";
import { RateLimitExceededError } from "@/server/rateLimit";

const FILE_OBJECT_READY = "READY";
const JOB_STATUS_FAILED = "FAILED";

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || undefined;
  }

  return request.headers.get("x-real-ip")?.trim() || undefined;
}

async function parseJsonSafe(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    throw new ValidationError("Invalid job request payload", {
      code: "INVALID_JOB_REQUEST",
    });
  }
}

function parseCreateJobInput(payload: unknown): CreateJobRequest {
  const parsed = createJobRequestSchema.safeParse(payload);

  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message || "Invalid job request payload",
      {
        code: "INVALID_JOB_REQUEST",
      }
    );
  }

  return parsed.data;
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
  let createdJobId: string | null = null;

  try {
    await assertJobCreateAllowed({
      guestId,
      ip: getClientIp(request),
      userId,
    });

    const body = parseCreateJobInput(await parseJsonSafe(request));
    const files = await prisma.fileObject.findMany({
      where: {
        objectKey: {
          in: body.inputKeys,
        },
        status: FILE_OBJECT_READY,
        ...(userId
          ? {
              userId,
            }
          : {
              guestId: guestId ?? "__missing_guest__",
              userId: null,
            }),
      },
      select: {
        id: true,
        objectKey: true,
      },
    });

    if (files.length !== body.inputKeys.length) {
      throw new NotFoundError("One or more uploaded PDFs are unavailable.", {
        code: "UPLOADS_NOT_FOUND",
      });
    }

    const filesByKey = new Map(files.map((file) => [file.objectKey, file]));
    const orderedFiles = body.inputKeys.map((inputKey) => filesByKey.get(inputKey));

    if (orderedFiles.some((file) => !file)) {
      throw new NotFoundError("One or more uploaded PDFs are unavailable.", {
        code: "UPLOADS_NOT_FOUND",
      });
    }

    const primaryFile = orderedFiles[0];

    if (!primaryFile) {
      throw new ConflictError("At least one uploaded PDF is required.", {
        code: "PRIMARY_UPLOAD_MISSING",
        httpStatus: 400,
      });
    }

    const job = await prisma.job.create({
      data: {
        fileObjectId: primaryFile.id,
        guestId: userId ? null : guestId ?? null,
        inputRef: JSON.stringify({
          inputFileIds: orderedFiles.map((file) => file!.id),
          inputKeys: body.inputKeys,
          options: body.options,
        }),
        status: "PENDING",
        type: body.jobType,
        userId: userId ?? null,
      },
      select: {
        id: true,
      },
    });
    createdJobId = job.id;

    await enqueuePdfJob({
      jobId: job.id,
      requestId,
      type: body.jobType,
    });

    log.info(
      {
        fileCount: orderedFiles.length,
        guestId,
        jobId: job.id,
        jobType: body.jobType,
      },
      "Created PDF job"
    );

    return NextResponse.json({
      jobId: job.id,
      status: "pending",
    });
  } catch (error) {
    if (
      createdJobId &&
      !(error instanceof ValidationError) &&
      !(error instanceof NotFoundError) &&
      !(error instanceof ConflictError)
    ) {
      try {
        await prisma.job.update({
          where: {
            id: createdJobId,
          },
          data: {
            completedAt: new Date(),
            errorCode: "QUEUE_ENQUEUE_FAILED",
            errorMessage: "Unable to queue merge job",
            status: JOB_STATUS_FAILED,
          },
        });
      } catch (markFailedError) {
        log.error(
          {
            err: markFailedError,
            jobId: createdJobId,
          },
          "Failed to mark queued job creation failure"
        );
      }
    }

    if (
      error instanceof ValidationError ||
      error instanceof NotFoundError ||
      error instanceof ConflictError
    ) {
      return toErrorResponse(error);
    }

    if (error instanceof RateLimitExceededError) {
      log.warn(
        {
          guestId,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        "Job creation request was rate limited"
      );

      return toErrorResponse(new RateLimitError(error.retryAfterSeconds));
    }

    log.error(
      {
        err: error,
        guestId,
      },
      "Failed to create PDF job"
    );

    return toErrorResponse(
      new InternalAppError("Unable to create job", {
        code: "JOB_CREATE_FAILED",
      })
    );
  }
}
