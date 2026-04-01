import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUploadEnv } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import {
  getStorageBucket,
  presignPut,
} from "@/lib/storage";
import {
  normalizeRequestId,
  REQUEST_ID_HEADER,
} from "@/lib/request-id";
import {
  getGuestCookieOptions,
  GUEST_ID_COOKIE,
  resolveGuestIdentity,
} from "@/server/uploads/guestIdentity";
import { assertUploadPresignAllowed } from "@/server/uploads/rateLimit";
import {
  buildPresignedUploadKey,
  parsePresignRequestJson,
  parsePresignUploadInput,
  UploadValidationError,
  validateUpload,
} from "@/server/uploads/presignPolicy";

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
  const userId =
    session?.user && "id" in session.user && typeof session.user.id === "string"
      ? session.user.id
      : undefined;
  const guestIdentity = resolveGuestIdentity(
    request.cookies.get(GUEST_ID_COOKIE)?.value
  );
  const log = createLogger({
    requestId,
    userId,
  });

  try {
    await assertUploadPresignAllowed({
      guestId: userId ? undefined : guestIdentity.guestId,
      ip: getClientIp(request),
      userId,
    });

    const body = parsePresignUploadInput(await parsePresignRequestJson(request));
    validateUpload(body);

    const fileIdSeed = crypto.randomUUID();
    const objectKey = buildPresignedUploadKey(fileIdSeed, body.filename);
    const uploadEnv = getUploadEnv();
    const fileObject = await prisma.fileObject.create({
      data: {
        bucket: getStorageBucket(),
        checksum: null,
        mimeType: body.contentType,
        objectKey,
        originalName: body.filename,
        sizeBytes: BigInt(body.sizeBytes),
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
      uploadEnv.PRESIGN_EXPIRES_SECONDS
    );

    log.info(
      {
        fileId: fileObject.id,
        guestId: userId ? undefined : guestIdentity.guestId,
        mimeType: body.contentType,
        objectKey: fileObject.objectKey,
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

    if (!userId && guestIdentity.isNew) {
      response.cookies.set(
        GUEST_ID_COOKIE,
        guestIdentity.guestId,
        getGuestCookieOptions()
      );
    }

    return response;
  } catch (error) {
    if (error instanceof UploadValidationError) {
      log.warn(
        {
          guestId: userId ? undefined : guestIdentity.guestId,
        },
        error.message
      );

      return NextResponse.json(
        {
          error: error.message,
        },
        { status: error.status }
      );
    }

    log.error(
      {
        err: error,
        guestId: userId ? undefined : guestIdentity.guestId,
      },
      "Failed to create presigned upload"
    );

    return NextResponse.json(
      {
        error: "Unable to create upload URL",
      },
      { status: 500 }
    );
  }
}
