import "server-only";

import { z } from "zod";

import { ValidationError } from "@/lib/errors";
import { getObjectMetadata, StorageObjectNotFoundError } from "@/lib/storage";

const completionSchema = z.object({
  etag: z.string().trim().min(1),
  fileId: z.string().trim().min(1),
});

class AppErrorBase extends ValidationError {
  constructor(message: string, status: number, code?: string) {
    super(message, {
      code: code ?? (status === 409 ? "UPLOAD_CONFLICT" : "UPLOAD_INVALID_REQUEST"),
      httpStatus: status,
    });
  }
}

export class UploadCompletionError extends AppErrorBase {
  retryable: boolean;

  constructor(
    message: string,
    status: number,
    retryable = false,
    code?: string
  ) {
    super(message, status, code);
    this.name = "UploadCompletionError";
    this.retryable = retryable;
  }
}

export type CompleteUploadInput = z.infer<typeof completionSchema>;

export function normalizeEtag(etag: string) {
  const trimmed = etag.trim().replace(/^"+|"+$/g, "");

  if (!trimmed) {
    throw new UploadCompletionError(
      "Missing fileId or etag",
      400,
      false,
      "UPLOAD_INVALID_REQUEST"
    );
  }

  return trimmed;
}

export async function parseCompleteUploadJson(request: {
  json: () => Promise<unknown>;
}) {
  try {
    return await request.json();
  } catch {
    throw new UploadCompletionError(
      "Missing fileId or etag",
      400,
      false,
      "UPLOAD_INVALID_REQUEST"
    );
  }
}

export function parseCompleteUploadInput(payload: unknown): CompleteUploadInput {
  const parsed = completionSchema.safeParse(payload);

  if (!parsed.success) {
    throw new UploadCompletionError(
      "Missing fileId or etag",
      400,
      false,
      "UPLOAD_INVALID_REQUEST"
    );
  }

  return {
    etag: normalizeEtag(parsed.data.etag),
    fileId: parsed.data.fileId,
  };
}

export async function loadVerifiedObjectMetadata(objectKey: string) {
  try {
    const metadata = await getObjectMetadata(objectKey);

    return {
      etag: metadata.etag,
      size: metadata.size,
    };
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      throw new UploadCompletionError(
        "Upload is not visible yet",
        409,
        true,
        "UPLOAD_NOT_VISIBLE_YET"
      );
    }

    throw error;
  }
}
