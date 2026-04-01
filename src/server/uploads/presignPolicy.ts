import "server-only";

import { z } from "zod";
import { getUploadEnv } from "@/lib/env";

const presignRequestSchema = z.object({
  contentType: z.string().trim().min(1),
  filename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().finite().positive(),
});

export class UploadValidationError extends Error {
  status = 400 as const;
}

export type PresignUploadInput = z.infer<typeof presignRequestSchema>;

export async function parsePresignRequestJson(request: { json: () => Promise<unknown> }) {
  try {
    return await request.json();
  } catch {
    throw new UploadValidationError("Invalid upload request payload");
  }
}

export function parsePresignUploadInput(payload: unknown): PresignUploadInput {
  const parsed = presignRequestSchema.safeParse(payload);

  if (!parsed.success) {
    throw new UploadValidationError("Invalid upload request payload");
  }

  return parsed.data;
}

export function validateUpload(input: PresignUploadInput) {
  const uploadEnv = getUploadEnv();
  const maxBytes = uploadEnv.MAX_UPLOAD_MB * 1024 * 1024;

  if (input.contentType !== "application/pdf") {
    throw new UploadValidationError("Only PDF uploads are allowed");
  }

  if (input.sizeBytes > maxBytes) {
    throw new UploadValidationError(
      `File exceeds the ${uploadEnv.MAX_UPLOAD_MB}MB upload limit`
    );
  }
}

function getMonth(date: Date) {
  return String(date.getUTCMonth() + 1).padStart(2, "0");
}

function sanitizeUploadId(uploadId: string) {
  const trimmed = uploadId.trim();

  if (!trimmed) {
    throw new UploadValidationError("Upload key requires a non-empty ID");
  }

  const safe = trimmed
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!safe) {
    throw new UploadValidationError("Upload key requires a safe ID");
  }

  return safe;
}

function sanitizeFilename(filename: string) {
  const trimmed = filename.trim().toLowerCase();

  if (!trimmed) {
    return "payload.bin";
  }

  const safe = trimmed
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return safe || "payload.bin";
}

export function buildPresignedUploadKey(uploadId: string, filename: string) {
  const normalizedUploadId = sanitizeUploadId(uploadId);
  const year = String(new Date().getUTCFullYear());
  const month = getMonth(new Date());
  const objectName = sanitizeFilename(filename);

  return `uploads/${year}/${month}/${normalizedUploadId}/${objectName}`;
}
