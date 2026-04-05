import { Prisma } from "@prisma/client";
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
import { createLogger } from "@/lib/logger";
import { enqueuePdfJob } from "@/lib/queue";
import { normalizeRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import {
  assertJobCreateAllowed,
  type JobCreateRateLimitIdentity,
} from "@/server/jobs/createRateLimit";
import { parseAndValidateMergeJobInput } from "@/server/jobs/validateJobInput";
import { RateLimitExceededError } from "@/server/rateLimit";

const JOB_STATUS_FAILED = "FAILED";
const JOB_STATUS_PENDING = "PENDING";
const JOB_TYPE = "pdf.merge";
const IDEMPOTENCY_HEADER = "idempotency-key";

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
      logContext: {
        details: [
          {
            message: "Request body must be valid JSON.",
            path: "",
          },
        ],
      },
    });
  }
}

function getIdempotencyKey(request: NextRequest) {
  const value = request.headers.get(IDEMPOTENCY_HEADER)?.trim();

  if (!value) {
    return undefined;
  }

  if (value.length > 191) {
    throw new ValidationError("Idempotency key must be 191 characters or fewer.", {
      code: "INVALID_IDEMPOTENCY_KEY",
      logContext: {
        details: [
          {
            message: "Idempotency-Key header is too long.",
            path: "headers.Idempotency-Key",
          },
        ],
      },
    });
  }

  return value;
}

function buildActorWhere({
  guestId,
  userId,
}: {
  guestId?: string;
  userId?: string;
}) {
  return userId
    ? {
        userId,
      }
    : {
        guestId: guestId ?? "__missing_guest__",
        userId: null,
      };
}

async function findIdempotentJob({
  guestId,
  idempotencyKey,
  userId,
}: {
  guestId?: string;
  idempotencyKey?: string;
  userId?: string;
}) {
  if (!idempotencyKey) {
    return null;
  }

  return prisma.job.findFirst({
    select: {
      id: true,
      status: true,
    },
    where: {
      idempotencyKey,
      ...buildActorWhere({
        guestId,
        userId,
      }),
    } as never,
  });
}

function createDetailedErrorResponse(error: ValidationError | NotFoundError | ConflictError) {
  return toErrorResponse(error, {
    extraBody:
      error.logContext && "details" in error.logContext
        ? {
            details: error.logContext.details,
          }
        : undefined,
  });
}

function toCreateJobStatus(status: string): "pending" | "processing" {
  return status === "RUNNING" ? "processing" : "pending";
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
  const rateLimitIdentity: JobCreateRateLimitIdentity = {
    guestId,
    ip: getClientIp(request),
    userId,
  };

  try {
    await assertJobCreateAllowed(rateLimitIdentity);

    const idempotencyKey = getIdempotencyKey(request);
    const existingJob = await findIdempotentJob({
      guestId,
      idempotencyKey,
      userId,
    });

    if (existingJob) {
      return NextResponse.json(
        {
          jobId: existingJob.id,
          status: toCreateJobStatus(existingJob.status),
        },
        {
          status: 201,
        }
      );
    }

    const validated = await parseAndValidateMergeJobInput(
      await parseJsonSafe(request),
      {
        guestId,
        userId,
      }
    );
    const primaryFile = validated.files[validated.options.pageOrder[0]];

    if (!primaryFile) {
      throw new ValidationError("Page order must reference an uploaded PDF.", {
        code: "INVALID_PAGE_ORDER",
      });
    }

    let createdJobId: string | null = null;

    try {
      const job = await prisma.$transaction(async (tx) => {
        const createdJob = await tx.job.create({
          data: {
            fileObjectId: primaryFile.id,
            guestId: userId ? null : guestId ?? null,
            idempotencyKey: idempotencyKey ?? null,
            inputRef: JSON.stringify({
              inputFileIds: validated.inputFileIds,
              options: validated.options,
            }),
            status: JOB_STATUS_PENDING,
            type: JOB_TYPE,
            userId: userId ?? null,
          } as never,
          select: {
            id: true,
          },
        });

        await tx.jobEvent.create({
          data: {
            jobId: createdJob.id,
            level: "info",
            message: "Merge job created.",
            metadata: {
              fileCount: validated.inputFileIds.length,
              idempotencyKey: idempotencyKey ?? null,
              requestId: requestId ?? null,
            },
          },
        });

        return createdJob;
      });

      createdJobId = job.id;

      await enqueuePdfJob({
        jobId: job.id,
        requestId,
        type: JOB_TYPE,
      });

      log.info(
        {
          fileCount: validated.inputFileIds.length,
          guestId,
          jobId: job.id,
          jobType: JOB_TYPE,
        },
        "Created merge PDF job"
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
      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const duplicateJob = await findIdempotentJob({
          guestId,
          idempotencyKey,
          userId,
        });

        if (duplicateJob) {
          return NextResponse.json(
            {
              jobId: duplicateJob.id,
              status: toCreateJobStatus(duplicateJob.status),
            },
            {
              status: 201,
            }
          );
        }
      }

      if (createdJobId) {
        try {
          await prisma.$transaction(async (tx) => {
            await tx.job.update({
              where: {
                id: createdJobId!,
              },
              data: {
                completedAt: new Date(),
                errorCode: "QUEUE_ENQUEUE_FAILED",
                errorMessage: "Unable to queue merge job",
                status: JOB_STATUS_FAILED,
              },
            });
            await tx.jobEvent.create({
              data: {
                jobId: createdJobId!,
                level: "error",
                message: "Merge job enqueue failed.",
                metadata: {
                  errorCode: "QUEUE_ENQUEUE_FAILED",
                },
              },
            });
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

      throw error;
    }
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof NotFoundError ||
      error instanceof ConflictError
    ) {
      return createDetailedErrorResponse(error);
    }

    if (error instanceof RateLimitExceededError) {
      log.warn(
        {
          guestId,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        "Merge job creation request was rate limited"
      );

      return toErrorResponse(new RateLimitError(error.retryAfterSeconds));
    }

    log.error(
      {
        err: error,
        guestId,
      },
      "Failed to create merge PDF job"
    );

    return toErrorResponse(
      new InternalAppError("Unable to create job", {
        code: "JOB_CREATE_FAILED",
      })
    );
  }
}
