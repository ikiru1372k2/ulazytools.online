import { createHash } from "crypto";

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
import {
  createJobRequestSchema,
  type CreateJobRequest,
} from "@/lib/jobs/merge";
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
const IDEMPOTENCY_REUSE_CODE = "IDEMPOTENCY_KEY_REUSED";

type IdempotentJobRecord = {
  id: string;
  inputRef: string | null;
  status: string;
};

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

function buildRequestFingerprint(request: CreateJobRequest) {
  return createHash("sha256")
    .update(JSON.stringify(request))
    .digest("hex");
}

function hashIdempotencyKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
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

function parseCreateJobInput(payload: unknown): CreateJobRequest {
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

  return parsed.data;
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
      inputRef: true,
      status: true,
    },
    where: {
      idempotencyKey,
      ...buildActorWhere({
        guestId,
        userId,
      }),
    },
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

function getStoredRequestFingerprint(inputRef: string | null) {
  if (!inputRef) {
    return null;
  }

  try {
    const parsed = JSON.parse(inputRef) as {
      requestFingerprint?: unknown;
    };

    return typeof parsed.requestFingerprint === "string"
      ? parsed.requestFingerprint
      : null;
  } catch {
    return null;
  }
}

function assertReusableIdempotentJob(
  job: IdempotentJobRecord,
  requestFingerprint: string
) {
  const storedRequestFingerprint = getStoredRequestFingerprint(job.inputRef);

  if (!storedRequestFingerprint || storedRequestFingerprint !== requestFingerprint) {
    throw new ConflictError(
      "Idempotency key is already associated with a different merge request.",
      {
        code: IDEMPOTENCY_REUSE_CODE,
      }
    );
  }

  switch (job.status) {
    case "PENDING":
      return "pending" as const;
    case "RUNNING":
      return "processing" as const;
    case "FAILED":
    case "CANCELED":
    case "SUCCEEDED":
      throw new ConflictError(
        "Idempotency key is already associated with a completed merge job. Use a new key to retry.",
        {
          code: IDEMPOTENCY_REUSE_CODE,
        }
      );
    default:
      throw new InternalAppError("Unknown merge job status", {
        code: "JOB_STATUS_UNSUPPORTED",
      });
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
  const rateLimitIdentity: JobCreateRateLimitIdentity = {
    guestId,
    ip: getClientIp(request),
    userId,
  };

  try {
    await assertJobCreateAllowed(rateLimitIdentity);

    const payload = await parseJsonSafe(request);
    const parsedInput = parseCreateJobInput(payload);
    const idempotencyKey = getIdempotencyKey(request);
    const hashedIdempotencyKey = idempotencyKey
      ? hashIdempotencyKey(idempotencyKey)
      : undefined;
    const requestFingerprint = buildRequestFingerprint(parsedInput);
    const existingJob = await findIdempotentJob({
      guestId,
      idempotencyKey: hashedIdempotencyKey,
      userId,
    });

    if (existingJob) {
      return NextResponse.json(
        {
          jobId: existingJob.id,
          status: assertReusableIdempotentJob(existingJob, requestFingerprint),
        },
        {
          status: 201,
        }
      );
    }

    const validated = await parseAndValidateMergeJobInput(
      parsedInput,
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
            idempotencyKey: hashedIdempotencyKey ?? null,
            inputRef: JSON.stringify({
              inputFileIds: validated.inputFileIds,
              options: validated.options,
              requestFingerprint,
            }),
            status: JOB_STATUS_PENDING,
            type: JOB_TYPE,
            userId: userId ?? null,
          },
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
              isIdempotent: Boolean(hashedIdempotencyKey),
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
        hashedIdempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const duplicateJob = await findIdempotentJob({
          guestId,
          idempotencyKey: hashedIdempotencyKey,
          userId,
        });

        if (duplicateJob) {
          return NextResponse.json(
            {
              jobId: duplicateJob.id,
              status: assertReusableIdempotentJob(
                duplicateJob,
                requestFingerprint
              ),
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
