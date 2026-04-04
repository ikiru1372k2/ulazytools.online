import { NextResponse } from "next/server";

import { RateLimitError, toAppError } from "@/lib/errors";

type ErrorResponseOptions = {
  cacheControl?: string;
  extraBody?: Record<string, unknown>;
  headers?: HeadersInit;
};

export function toErrorResponse(
  error: unknown,
  options: ErrorResponseOptions = {}
) {
  const appError = toAppError(error);
  const response = NextResponse.json(
    {
      ...options.extraBody,
      error: {
        code: appError.code,
        message: appError.userMessage,
      },
    },
    {
      status: appError.httpStatus,
    }
  );

  if (options.cacheControl) {
    response.headers.set("Cache-Control", options.cacheControl);
  }

  if (options.headers) {
    const headers = new Headers(options.headers);

    headers.forEach((value, key) => {
      response.headers.set(key, value);
    });
  }

  if (appError instanceof RateLimitError) {
    response.headers.set("Retry-After", String(appError.retryAfterSeconds));
  }

  return response;
}
