import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  GUEST_ID_COOKIE,
  INTERNAL_GUEST_ID_HEADER,
  isGuestId,
  verifyGuestCookieValue,
} from "@/lib/guest";
import { createLogger } from "@/lib/logger";
import { normalizeRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import {
  loadVerifiedObjectMetadata,
  parseCompleteUploadInput,
  parseCompleteUploadJson,
  UploadCompletionError,
} from "@/server/uploads/verify";

const FILE_OBJECT_PENDING_UPLOAD = "PENDING_UPLOAD";
const FILE_OBJECT_READY = "READY";
const FILE_OBJECT_FAILED = "FAILED";

function buildResponse(
  body: Record<string, unknown>,
  init?: { status?: number }
) {
  return NextResponse.json(body, init);
}

export async function POST(request: NextRequest) {
  const requestId = normalizeRequestId(request.headers.get(REQUEST_ID_HEADER));
  const session = await auth();
  const userId = session?.user?.id;
  const forwardedGuestId = request.headers.get(INTERNAL_GUEST_ID_HEADER)?.trim();
  const trustedGuestId =
    forwardedGuestId && isGuestId(forwardedGuestId) ? forwardedGuestId : null;
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
    const body = parseCompleteUploadInput(await parseCompleteUploadJson(request));
    const file = await prisma.fileObject.findUnique({
      where: {
        id: body.fileId,
      },
      select: {
        checksum: true,
        guestId: true,
        id: true,
        objectKey: true,
        sizeBytes: true,
        status: true,
        userId: true,
      },
    });

    if (!file) {
      return buildResponse({ error: "File not found" }, { status: 404 });
    }

    const isAuthorizedUser = Boolean(userId && file.userId === userId);
    const isAuthorizedGuest = Boolean(
      !file.userId && file.guestId && file.guestId === guestId
    );

    if (!isAuthorizedUser && !isAuthorizedGuest) {
      return buildResponse({ error: "File not found" }, { status: 404 });
    }

    if (file.status !== FILE_OBJECT_PENDING_UPLOAD) {
      return buildResponse(
        { error: "Invalid state transition" },
        { status: 400 }
      );
    }

    const metadata = await loadVerifiedObjectMetadata(file.objectKey);

    if (metadata.size !== file.sizeBytes) {
      await prisma.fileObject.update({
        where: {
          id: file.id,
        },
        data: {
          status: FILE_OBJECT_FAILED,
        },
      });

      log.warn(
        {
          fileId: file.id,
          guestId,
          mismatch: "SIZE_MISMATCH",
        },
        "Upload completion failed verification"
      );

      return buildResponse({ error: "SIZE_MISMATCH" }, { status: 409 });
    }

    if (!metadata.etag || metadata.etag !== body.etag) {
      await prisma.fileObject.update({
        where: {
          id: file.id,
        },
        data: {
          status: FILE_OBJECT_FAILED,
        },
      });

      log.warn(
        {
          fileId: file.id,
          guestId,
          mismatch: "ETAG_MISMATCH",
        },
        "Upload completion failed verification"
      );

      return buildResponse({ error: "ETAG_MISMATCH" }, { status: 409 });
    }

    await prisma.fileObject.update({
      where: {
        id: file.id,
      },
      data: {
        checksum: metadata.etag,
        status: FILE_OBJECT_READY,
      },
    });

    log.info(
      {
        fileId: file.id,
        guestId,
        status: FILE_OBJECT_READY,
      },
      "Upload verified successfully"
    );

    return buildResponse({ ok: true });
  } catch (error) {
    if (error instanceof UploadCompletionError) {
      log.warn(
        {
          guestId,
          retryable: error.retryable,
        },
        error.message
      );

      return buildResponse(
        {
          error: error.message,
          retryable: error.retryable,
        },
        { status: error.status }
      );
    }

    log.error(
      {
        err: error,
        guestId,
      },
      "Upload completion verification failed"
    );

    return buildResponse(
      {
        error: "UPLOAD_VERIFICATION_FAILED",
        retryable: true,
      },
      { status: 500 }
    );
  }
}
