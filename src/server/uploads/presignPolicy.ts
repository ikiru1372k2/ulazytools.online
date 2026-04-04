import "server-only";

import { z } from "zod";
import { getUploadEnv } from "@/lib/env";
import { ValidationError } from "@/lib/errors";

const presignRequestSchema = z.object({
  contentType: z.string().trim().min(1),
  filename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().finite().positive(),
});

export class UploadValidationError extends ValidationError {
  constructor(message: string, code = "UPLOAD_INVALID_REQUEST") {
    super(message, { code });
    this.name = "UploadValidationError";
  }
}

export type PresignUploadInput = z.infer<typeof presignRequestSchema>;

export async function parsePresignRequestJson(request: { json: () => Promise<unknown> }) {
  try {
    return await request.json();
  } catch {
    throw new UploadValidationError(
      "Invalid upload request payload",
      "UPLOAD_INVALID_REQUEST"
    );
  }
}

export function parsePresignUploadInput(payload: unknown): PresignUploadInput {
  const parsed = presignRequestSchema.safeParse(payload);

  if (!parsed.success) {
    throw new UploadValidationError(
      "Invalid upload request payload",
      "UPLOAD_INVALID_REQUEST"
    );
  }

  return parsed.data;
}

export function validateUpload(input: PresignUploadInput) {
  const uploadEnv = getUploadEnv();
  const maxBytes = uploadEnv.MAX_UPLOAD_MB * 1024 * 1024;

  if (input.contentType !== "application/pdf") {
    throw new UploadValidationError(
      "Only PDF uploads are allowed",
      "UPLOAD_INVALID_TYPE"
    );
  }

  if (input.sizeBytes > maxBytes) {
    throw new UploadValidationError(
      `File exceeds the ${uploadEnv.MAX_UPLOAD_MB}MB upload limit`,
      "UPLOAD_TOO_LARGE"
    );
  }
}
