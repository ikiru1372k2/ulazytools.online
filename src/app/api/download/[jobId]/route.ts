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
  getObjectMetadata,
  presignGet,
  StorageObjectNotFoundError,
} from "@/lib/storage";
import {
  canAccessJob,
  DOWNLOAD_URL_TTL_SECONDS,
  isJobExpired,
} from "@/server/jobs/jobAccess";

const DOWNLOAD_EVENT_MESSAGE = "Output downloaded.";

function buildJsonResponse(body: Record<string, unknown>, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function buildMethodNotAllowedResponse() {
  const response = new NextResponse(null, { status: 405 });
  response.headers.set("Allow", "GET");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function sanitizeDownloadFilename(filename: string) {
  const trimmed = filename.trim();

  if (!trimmed) {
    return "download.pdf";
  }

  const safe = trimmed
    .replace(/[/\\]+/g, "-")
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!safe) {
    return "download.pdf";
  }

  return safe.toLowerCase().endsWith(".pdf") ? safe : `${safe}.pdf`;
}

function getFallbackFilename(outputRef: string) {
  const fromKey = outputRef.split("/").pop();
  return sanitizeDownloadFilename(fromKey ?? "download.pdf");
}

function buildAttachmentContentDisposition(filename: string) {
  const asciiFallback = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/"/g, "");
  const encodedFilename = encodeURIComponent(filename);

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}

async function resolveGuestId(request: NextRequest, userId?: string) {
  if (userId) {
    return undefined;
  }

  const forwardedGuestId = request.headers.get(INTERNAL_GUEST_ID_HEADER)?.trim();
  const trustedGuestHeader =
    request.headers.get(INTERNAL_GUEST_ID_TRUST_HEADER) === "1";
  const trustedGuestId =
    trustedGuestHeader && forwardedGuestId && isGuestId(forwardedGuestId)
      ? forwardedGuestId
      : null;

  return (
    trustedGuestId ||
    (await verifyGuestCookieValue(request.cookies.get(GUEST_ID_COOKIE)?.value)) ||
    undefined
  );
}

export async function HEAD() {
  return buildMethodNotAllowedResponse();
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
    return buildJsonResponse({ error: "Not found" }, 404);
  }

  const guestId = await resolveGuestId(request, userId);
  const log = createLogger({
    requestId,
    userId,
  });

  try {
    const job = await prisma.job.findUnique({
      where: {
        id: jobId,
      },
      select: {
        completedAt: true,
        fileObject: {
          select: {
            originalName: true,
          },
        },
        guestId: true,
        id: true,
        outputRef: true,
        status: true,
        updatedAt: true,
        userId: true,
      },
    });

    if (!job || !canAccessJob(job, { guestId, userId })) {
      return buildJsonResponse({ error: "Not found" }, 404);
    }

    if (job.status !== "SUCCEEDED") {
      return buildJsonResponse({ error: "JOB_NOT_READY" }, 409);
    }

    if (isJobExpired(job)) {
      return buildJsonResponse({ error: "JOB_EXPIRED" }, 410);
    }

    if (!job.outputRef) {
      throw new Error(`Job "${job.id}" is missing outputRef`);
    }

    const filename = sanitizeDownloadFilename(
      job.fileObject?.originalName ?? getFallbackFilename(job.outputRef)
    );
    await getObjectMetadata(job.outputRef);
    const downloadUrl = await presignGet(job.outputRef, DOWNLOAD_URL_TTL_SECONDS, {
      responseContentDisposition: buildAttachmentContentDisposition(filename),
    });

    try {
      await prisma.jobEvent.create({
        data: {
          jobId: job.id,
          level: "info",
          message: DOWNLOAD_EVENT_MESSAGE,
          metadata: {
            actorType: userId ? "user" : "guest",
            requestId,
            route: "api_download",
          },
        },
      });
    } catch (auditError) {
      log.warn(
        {
          err: auditError,
          guestId,
          jobId,
        },
        "Failed to persist download audit event"
      );
    }

    log.info(
      {
        filename,
        guestId,
        jobId,
      },
      "Created private download redirect"
    );

    const response = NextResponse.redirect(downloadUrl, 302);
    response.headers.set("Cache-Control", "no-store");

    return response;
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      log.warn(
        {
          guestId,
          jobId,
        },
        "Download output object was not found"
      );

      return buildJsonResponse({ error: "JOB_EXPIRED" }, 410);
    }

    log.error(
      {
        err: error,
        guestId,
        jobId,
      },
      "Failed to create download URL"
    );

    return buildJsonResponse({ error: "Unable to create download URL" }, 500);
  }
}
