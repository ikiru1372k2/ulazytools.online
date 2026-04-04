import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { toErrorResponse } from "@/app/api/_utils/http";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { GoneError, InternalAppError, NotFoundError, RateLimitError } from "@/lib/errors";
import {
  GUEST_ID_COOKIE,
  INTERNAL_GUEST_ID_HEADER,
  INTERNAL_GUEST_ID_TRUST_HEADER,
  isGuestId,
  verifyGuestCookieValue,
} from "@/lib/guest";
import { createLogger } from "@/lib/logger";
import { normalizeRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import {
  buildJobStatusEtag,
  canAccessJob,
  isJobExpired,
  toSafeJobProjection,
} from "@/server/jobs/jobAccess";
import { assertJobStatusAllowed } from "@/server/jobs/rateLimit";
import { RateLimitExceededError } from "@/server/rateLimit";

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || undefined;
  }

  return request.headers.get("x-real-ip")?.trim() || undefined;
}

function buildResponse(
  body: Record<string, unknown>,
  init?: {
    etag?: string;
    retryAfterSeconds?: number;
    status?: number;
  }
) {
  const response = NextResponse.json(body, {
    status: init?.status,
  });

  response.headers.set("Cache-Control", "no-store");

  if (init?.etag) {
    response.headers.set("ETag", init.etag);
  }

  if (init?.retryAfterSeconds) {
    response.headers.set("Retry-After", String(init.retryAfterSeconds));
  }

  return response;
}

export async function GET(
  request: NextRequest,
  context: { params: { jobId: string } }
) {
  const requestId = normalizeRequestId(request.headers.get(REQUEST_ID_HEADER));
  const session = await auth();
  const userId = session?.user?.id;
  const jobId = context.params.jobId?.trim();

  if (!jobId) {
    return toErrorResponse(new NotFoundError(), {
      cacheControl: "no-store",
    });
  }

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
    await assertJobStatusAllowed({
      guestId,
      ip: getClientIp(request),
      userId,
    });

    const job = await prisma.job.findUnique({
      where: {
        id: jobId,
      },
      select: {
        completedAt: true,
        createdAt: true,
        errorCode: true,
        errorMessage: true,
        guestId: true,
        id: true,
        outputRef: true,
        status: true,
        updatedAt: true,
        userId: true,
      },
    });

    if (!job || !canAccessJob(job, { guestId, userId })) {
      return toErrorResponse(new NotFoundError(), {
        cacheControl: "no-store",
      });
    }

    if (isJobExpired(job)) {
      return toErrorResponse(
        new GoneError("Job output has expired", {
          code: "JOB_EXPIRED",
        }),
        {
          cacheControl: "no-store",
        }
      );
    }

    const projection = await toSafeJobProjection(job);

    return buildResponse(projection, {
      etag: projection.status === "done" ? undefined : buildJobStatusEtag(job),
      status: 200,
    });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      log.warn(
        {
          guestId,
          jobId,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        "Job status request was rate limited"
      );

      return toErrorResponse(new RateLimitError(error.retryAfterSeconds), {
        cacheControl: "no-store",
      });
    }

    log.error(
      {
        err: error,
        guestId,
        jobId,
      },
      "Failed to load job status"
    );

    return toErrorResponse(
      new InternalAppError("Unable to load job status", {
        code: "JOB_STATUS_UNAVAILABLE",
      }),
      {
        cacheControl: "no-store",
      }
    );
  }
}
