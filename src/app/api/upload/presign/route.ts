import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { toErrorResponse } from "@/app/api/_utils/http";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUploadEnv } from "@/lib/env";
import { InternalAppError, RateLimitError } from "@/lib/errors";
import {
  getGuestCookieOptions,
  GUEST_ID_COOKIE,
  INTERNAL_GUEST_ID_HEADER,
  INTERNAL_GUEST_ID_TRUST_HEADER,
  isGuestId,
  resolveGuestSession,
  serializeGuestCookie,
} from "@/lib/guest";
import { createLogger } from "@/lib/logger";
import { buildObjectKey, buildObjectTags } from "@/lib/objectKey";
import { normalizeRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import { getStorageBucket, presignPut } from "@/lib/storage";
import { assertUploadPresignAllowed } from "@/server/uploads/rateLimit";
import {
  parsePresignRequestJson,
  parsePresignUploadInput,
  UploadValidationError,
  validateUpload,
} from "@/server/uploads/presignPolicy";
import { RateLimitExceededError } from "@/server/rateLimit";

const FILE_OBJECT_PENDING_UPLOAD = "PENDING_UPLOAD";

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || undefined;
  }

  return request.headers.get("x-real-ip")?.trim() || undefined;
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
  const guestSession = userId
    ? null
    : trustedGuestId
      ? {
          guestId: trustedGuestId,
          isNew: false,
          shouldSetCookie: false,
        }
      : await resolveGuestSession(request.cookies.get(GUEST_ID_COOKIE)?.value);
  const log = createLogger({
    requestId,
    userId,
  });

  try {
    await assertUploadPresignAllowed({
      guestId: guestSession?.guestId,
      ip: getClientIp(request),
      userId,
    });

    const body = parsePresignUploadInput(await parsePresignRequestJson(request));
    validateUpload(body);

    const fileIdSeed = crypto.randomUUID();
    const objectKey = buildObjectKey({
      filename: body.filename,
      guestId: guestSession?.guestId,
      jobId: fileIdSeed,
      kind: "upload",
      userId,
    });
    const uploadEnv = getUploadEnv();
    const fileObject = await prisma.fileObject.create({
      data: {
        bucket: getStorageBucket(),
        checksum: null,
        expiresAt: null,
        guestId: guestSession?.guestId ?? null,
        mimeType: body.contentType,
        objectKey,
        originalName: body.filename,
        sizeBytes: BigInt(body.sizeBytes),
        status: FILE_OBJECT_PENDING_UPLOAD,
        userId: userId ?? null,
      },
      select: {
        id: true,
        objectKey: true,
      },
    });

    const presignedUpload = await presignPut(
      fileObject.objectKey,
      body.contentType,
      uploadEnv.PRESIGN_EXPIRES_SECONDS,
      {
        tags: buildObjectTags(),
      }
    );

    log.info(
      {
        fileId: fileObject.id,
        guestId: guestSession?.guestId,
        mimeType: body.contentType,
        sizeBytes: body.sizeBytes,
      },
      "Created presigned upload"
    );

    const response = NextResponse.json({
      expiresInSeconds: uploadEnv.PRESIGN_EXPIRES_SECONDS,
      fileId: fileObject.id,
      headers: presignedUpload.headers,
      objectKey: fileObject.objectKey,
      uploadUrl: presignedUpload.uploadUrl,
    });

    if (guestSession?.shouldSetCookie) {
      response.cookies.set(
        GUEST_ID_COOKIE,
        await serializeGuestCookie(guestSession.guestId),
        getGuestCookieOptions()
      );
    }

    return response;
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      log.warn(
        {
          guestId: guestSession?.guestId,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        "Upload presign request was rate limited"
      );

      return toErrorResponse(new RateLimitError(error.retryAfterSeconds));
    }

    if (error instanceof UploadValidationError) {
      log.warn(
        {
          guestId: guestSession?.guestId,
        },
        error.message
      );

      return toErrorResponse(error);
    }

    log.error(
      {
        err: error,
        guestId: guestSession?.guestId,
      },
      "Failed to create presigned upload"
    );

    return toErrorResponse(
      new InternalAppError("Unable to create upload URL", {
        code: "UPLOAD_PRESIGN_FAILED",
      })
    );
  }
}
