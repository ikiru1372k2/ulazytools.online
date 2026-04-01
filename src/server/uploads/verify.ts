import "server-only";

import { z } from "zod";

import { getObjectMetadata, StorageObjectNotFoundError } from "@/lib/storage";

const completionSchema = z.object({
  etag: z.string().trim().min(1),
  fileId: z.string().trim().min(1),
});

export class UploadCompletionError extends Error {
  retryable: boolean;
  status: number;

  constructor(message: string, status: number, retryable = false) {
    super(message);
    this.name = "UploadCompletionError";
    this.retryable = retryable;
    this.status = status;
  }
}

export type CompleteUploadInput = z.infer<typeof completionSchema>;

export function normalizeEtag(etag: string) {
  const trimmed = etag.trim().replace(/^"+|"+$/g, "");

  if (!trimmed) {
    throw new UploadCompletionError("Missing fileId or etag", 400);
  }

  return trimmed;
}

export async function parseCompleteUploadJson(request: {
  json: () => Promise<unknown>;
}) {
  try {
    return await request.json();
  } catch {
    throw new UploadCompletionError("Missing fileId or etag", 400);
  }
}

export function parseCompleteUploadInput(payload: unknown): CompleteUploadInput {
  const parsed = completionSchema.safeParse(payload);

  if (!parsed.success) {
    throw new UploadCompletionError("Missing fileId or etag", 400);
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
      throw new UploadCompletionError("UPLOAD_NOT_VISIBLE_YET", 409, true);
    }

    throw error;
  }
}
