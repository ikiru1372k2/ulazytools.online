import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
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
    return buildResponse({ error: "Not found" }, { status: 404 });
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
      return buildResponse({ error: "Not found" }, { status: 404 });
    }

    if (isJobExpired(job)) {
      return buildResponse({ error: "JOB_EXPIRED" }, { status: 410 });
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

      return buildResponse(
        {
          error: "RATE_LIMITED",
        },
        {
          retryAfterSeconds: error.retryAfterSeconds,
          status: 429,
        }
      );
    }

    log.error(
      {
        err: error,
        guestId,
        jobId,
      },
      "Failed to load job status"
    );

    return buildResponse(
      {
        error: "Unable to load job status",
      },
      { status: 500 }
    );
  }
}
