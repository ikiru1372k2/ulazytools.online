"use client";

import { splitPdfRangesSchema } from "@/lib/splitPdfRanges";
import type { JobErrorResponse, JobStatusResponse } from "@/types/job";

export class ApiClientError extends Error {
  code: string;
  status: number;

  constructor(message: string, options: { code: string; status: number }) {
    super(message);
    this.name = "ApiClientError";
    this.code = options.code;
    this.status = options.status;
  }
}

export type PresignUploadResponse = {
  fileId: string;
  headers?: Record<string, string>;
  objectKey: string;
  uploadUrl: string;
};

export type CompleteUploadResponse = {
  ok?: boolean;
  retryable?: boolean;
};

export type CreateJobResponse = {
  jobId: string;
  status: JobStatusResponse["status"];
};

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function requestJson<T>(
  input: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(input, init);
  const payload = await parseJsonSafe<T & JobErrorResponse>(response);

  if (!response.ok) {
    throw new ApiClientError(
      payload?.error?.message || payload?.error?.code || "Request failed",
      {
        code: payload?.error?.code || "REQUEST_FAILED",
        status: response.status,
      }
    );
  }

  if (!payload) {
    throw new ApiClientError("Request failed", {
      code: "INVALID_RESPONSE",
      status: response.status,
    });
  }

  return payload;
}

export async function createSplitPdfRangesJob(input: {
  inputKey: string;
  ranges: string;
}) {
  const ranges = splitPdfRangesSchema.parse(input.ranges);

  return requestJson<CreateJobResponse>("/api/jobs", {
    body: JSON.stringify({
      inputKeys: [input.inputKey],
      jobType: "split_pdf_ranges",
      options: {
        ranges,
      },
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}
