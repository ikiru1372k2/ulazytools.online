"use client";

import {
  createJobResponseSchema,
  type CreateJobRequest,
  type CreateJobResponse,
} from "@/lib/jobs/merge";

type ErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function createJob(
  payload: CreateJobRequest,
  fetchImpl: typeof fetch = fetch
): Promise<CreateJobResponse> {
  const response = await fetchImpl("/api/jobs", {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const json = await parseJsonSafe<CreateJobResponse & ErrorPayload>(response);

  if (!response.ok) {
    throw new Error(
      json?.error?.message || json?.error?.code || "Unable to create job"
    );
  }

  return createJobResponseSchema.parse(json);
}
