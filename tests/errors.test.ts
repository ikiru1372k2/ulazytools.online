jest.mock("next/server", () => ({
  NextResponse: {
    json(body: unknown, init?: { status?: number }) {
      const headers = new Headers();

      return {
        headers,
        async json() {
          return body;
        },
        status: init?.status ?? 200,
      };
    },
  },
}));

import { toErrorResponse } from "@/app/api/_utils/http";
import {
  GoneError,
  InternalAppError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "@/lib/errors";

describe("shared error mapping", () => {
  it("maps known app errors to nested JSON responses", async () => {
    const response = toErrorResponse(
      new ValidationError("Only PDF uploads are allowed", {
        code: "UPLOAD_INVALID_TYPE",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UPLOAD_INVALID_TYPE",
        message: "Only PDF uploads are allowed",
      },
    });
  });

  it("adds Retry-After for rate-limited errors", async () => {
    const response = toErrorResponse(new RateLimitError(12), {
      cacheControl: "no-store",
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again later.",
      },
    });
  });

  it("maps unknown thrown values to a safe internal error", async () => {
    const response = toErrorResponse(new Error("database exploded"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    });
  });

  it("supports route-specific overrides for gone and not found errors", async () => {
    const notFound = toErrorResponse(new NotFoundError());
    const expired = toErrorResponse(
      new GoneError("Job output has expired", {
        code: "JOB_EXPIRED",
      })
    );

    await expect(notFound.json()).resolves.toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Not found",
      },
    });
    await expect(expired.json()).resolves.toEqual({
      error: {
        code: "JOB_EXPIRED",
        message: "Job output has expired",
      },
    });
  });

  it("allows internal app errors to expose safe route-specific messages", async () => {
    const response = toErrorResponse(
      new InternalAppError("Unable to load job status", {
        code: "JOB_STATUS_UNAVAILABLE",
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "JOB_STATUS_UNAVAILABLE",
        message: "Unable to load job status",
      },
    });
  });
});
