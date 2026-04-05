export {};

const auth = jest.fn();
const fileObjectFindMany = jest.fn();
const jobCreate = jest.fn();
const jobFindFirst = jest.fn();
const jobUpdate = jest.fn();
const jobEventCreate = jest.fn();
const transaction = jest.fn();
const enqueuePdfJob = jest.fn();
const info = jest.fn();
const error = jest.fn();
const warn = jest.fn();
const verifyGuestCookieValue = jest.fn();
const assertJobCreateAllowed = jest.fn();
const MockRateLimitExceededError = class RateLimitExceededError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("RATE_LIMITED");
    this.retryAfterSeconds = retryAfterSeconds;
  }
};

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

describe("/api/jobs/merge", () => {
  beforeEach(() => {
    jest.resetModules();
    auth.mockReset();
    fileObjectFindMany.mockReset();
    jobCreate.mockReset();
    jobFindFirst.mockReset();
    jobUpdate.mockReset();
    jobEventCreate.mockReset();
    transaction.mockReset();
    enqueuePdfJob.mockReset();
    info.mockReset();
    error.mockReset();
    warn.mockReset();
    verifyGuestCookieValue.mockReset();
    assertJobCreateAllowed.mockReset();

    process.env.RATE_LIMIT_JOB_CREATE_LIMIT = "10";
    process.env.RATE_LIMIT_JOB_CREATE_WINDOW_SECONDS = "60";
    process.env.RATE_LIMIT_JOB_STATUS_LIMIT = "120";
    process.env.RATE_LIMIT_JOB_STATUS_WINDOW_SECONDS = "60";
    process.env.RATE_LIMIT_UPLOAD_PRESIGN_LIMIT = "20";
    process.env.RATE_LIMIT_UPLOAD_PRESIGN_WINDOW_SECONDS = "60";

    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        job: {
          create: jobCreate,
          update: jobUpdate,
        },
        jobEvent: {
          create: jobEventCreate,
        },
      })
    );

    jest.doMock("@/lib/auth", () => ({ auth }));
    jest.doMock("@/lib/db", () => ({
      prisma: {
        $transaction: transaction,
        fileObject: {
          findMany: fileObjectFindMany,
        },
        job: {
          findFirst: jobFindFirst,
        },
      },
    }));
    jest.doMock("@/lib/queue", () => ({
      enqueuePdfJob,
    }));
    jest.doMock("@/server/jobs/createRateLimit", () => ({
      assertJobCreateAllowed,
    }));
    jest.doMock("@/server/rateLimit", () => ({
      RateLimitExceededError: MockRateLimitExceededError,
    }));
    jest.doMock("@/lib/guest", () => ({
      GUEST_ID_COOKIE: "guestId",
      INTERNAL_GUEST_ID_HEADER: "x-ulazytools-guest-id",
      INTERNAL_GUEST_ID_TRUST_HEADER: "x-ulazytools-guest-trusted",
      isGuestId: (value: string) => /^[0-9a-f-]{36}$/i.test(value),
      verifyGuestCookieValue: (...args: unknown[]) => verifyGuestCookieValue(...args),
    }));
    jest.doMock(
      "pino",
      () => {
        const instance = {
          child: jest.fn(),
          error,
          info,
          warn,
        };
        instance.child.mockReturnValue(instance);
        const pino = jest.fn(() => instance);
        return { __esModule: true, default: pino };
      },
      { virtual: true }
    );
  });

  it("creates a merge job, persists an event, and enqueues exactly once", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    jobFindFirst.mockResolvedValue(null);
    fileObjectFindMany.mockResolvedValue([
      { id: "file-1", objectKey: "uploads/first.pdf" },
      { id: "file-2", objectKey: "uploads/second.pdf" },
    ]);
    jobCreate.mockResolvedValue({
      id: "job-123",
    });

    const { POST } = await import("@/app/api/jobs/merge/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers({
        "Idempotency-Key": "idem-123",
        "x-request-id": "req-123",
      }),
      json: async () => ({
        inputFileIds: ["file-1", "file-2"],
        jobType: "pdf.merge",
        options: {
          pageOrder: [1, 0],
        },
      }),
    } as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-123",
      status: "pending",
    });
    expect(fileObjectFindMany).toHaveBeenCalledWith({
      select: {
        id: true,
        objectKey: true,
      },
      where: {
        id: {
          in: ["file-1", "file-2"],
        },
        status: "READY",
        userId: "user-123",
      },
    });
    expect(jobCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fileObjectId: "file-2",
        guestId: null,
        idempotencyKey: "idem-123",
        status: "PENDING",
        type: "pdf.merge",
        userId: "user-123",
      }),
      select: {
        id: true,
      },
    });
    expect(jobEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobId: "job-123",
        level: "info",
        message: "Merge job created.",
      }),
    });
    expect(enqueuePdfJob).toHaveBeenCalledWith({
      jobId: "job-123",
      requestId: "req-123",
      type: "pdf.merge",
    });
    expect(assertJobCreateAllowed).toHaveBeenCalledWith({
      guestId: undefined,
      ip: undefined,
      userId: "user-123",
    });
  });

  it("returns the original job for the same idempotency key and actor", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    jobFindFirst.mockResolvedValue({
      id: "job-existing",
      status: "PENDING",
    });

    const { POST } = await import("@/app/api/jobs/merge/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers({
        "Idempotency-Key": "idem-123",
      }),
      json: async () => ({
        inputFileIds: ["file-1", "file-2"],
        jobType: "pdf.merge",
        options: {
          pageOrder: [0, 1],
        },
      }),
    } as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-existing",
      status: "pending",
    });
    expect(fileObjectFindMany).not.toHaveBeenCalled();
    expect(enqueuePdfJob).not.toHaveBeenCalled();
  });

  it("does not collide across different actors using the same idempotency key", async () => {
    auth
      .mockResolvedValueOnce({ user: { id: "user-123" } })
      .mockResolvedValueOnce({ user: { id: "user-456" } });
    jobFindFirst
      .mockResolvedValueOnce({
        id: "job-user-1",
        status: "PENDING",
      })
      .mockResolvedValueOnce(null);
    fileObjectFindMany.mockResolvedValue([
      { id: "file-1", objectKey: "uploads/first.pdf" },
    ]);
    jobCreate.mockResolvedValue({
      id: "job-user-2",
    });

    const { POST } = await import("@/app/api/jobs/merge/route");

    const firstResponse = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers({
        "Idempotency-Key": "idem-123",
      }),
      json: async () => ({
        inputFileIds: ["file-1"],
        jobType: "pdf.merge",
        options: {
          pageOrder: [0],
        },
      }),
    } as never);

    const secondResponse = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers({
        "Idempotency-Key": "idem-123",
      }),
      json: async () => ({
        inputFileIds: ["file-1"],
        jobType: "pdf.merge",
        options: {
          pageOrder: [0],
        },
      }),
    } as never);

    await expect(firstResponse.json()).resolves.toEqual({
      jobId: "job-user-1",
      status: "pending",
    });
    await expect(secondResponse.json()).resolves.toEqual({
      jobId: "job-user-2",
      status: "pending",
    });
    expect(enqueuePdfJob).toHaveBeenCalledTimes(1);
  });

  it("returns 400 with validation details for invalid payloads", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    jobFindFirst.mockResolvedValue(null);

    const { POST } = await import("@/app/api/jobs/merge/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        inputFileIds: ["file-1", "file-2"],
        jobType: "pdf.merge",
        options: {
          pageOrder: [0],
        },
      }),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      details: [
        {
          message: "pageOrder length must match inputFileIds length.",
          path: "options.pageOrder",
        },
      ],
      error: {
        code: "INVALID_PAGE_ORDER",
        message: "Page order must include each uploaded PDF exactly once.",
      },
    });
    expect(fileObjectFindMany).not.toHaveBeenCalled();
  });

  it("returns 404 when an uploaded file is missing or unauthorized", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    jobFindFirst.mockResolvedValue(null);
    fileObjectFindMany.mockResolvedValue([{ id: "file-1", objectKey: "uploads/first.pdf" }]);

    const { POST } = await import("@/app/api/jobs/merge/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        inputFileIds: ["file-1", "file-2"],
        jobType: "pdf.merge",
        options: {
          pageOrder: [0, 1],
        },
      }),
    } as never);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UPLOADS_NOT_FOUND",
        message: "One or more uploaded PDFs are unavailable.",
      },
    });
  });

  it("marks the created job failed and records a failure event when enqueueing fails", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    jobFindFirst.mockResolvedValue(null);
    fileObjectFindMany.mockResolvedValue([
      { id: "file-1", objectKey: "uploads/first.pdf" },
      { id: "file-2", objectKey: "uploads/second.pdf" },
    ]);
    jobCreate.mockResolvedValue({
      id: "job-stuck",
    });
    enqueuePdfJob.mockRejectedValue(new Error("queue unavailable"));

    const { POST } = await import("@/app/api/jobs/merge/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        inputFileIds: ["file-1", "file-2"],
        jobType: "pdf.merge",
        options: {
          pageOrder: [0, 1],
        },
      }),
    } as never);

    expect(response.status).toBe(500);
    expect(jobUpdate).toHaveBeenCalledWith({
      where: {
        id: "job-stuck",
      },
      data: expect.objectContaining({
        errorCode: "QUEUE_ENQUEUE_FAILED",
        errorMessage: "Unable to queue merge job",
        status: "FAILED",
      }),
    });
    expect(jobEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobId: "job-stuck",
        level: "error",
        message: "Merge job enqueue failed.",
      }),
    });
  });

  it("returns 429 when job creation is rate limited", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    assertJobCreateAllowed.mockRejectedValue(new MockRateLimitExceededError(12));

    const { POST } = await import("@/app/api/jobs/merge/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        inputFileIds: ["file-1"],
        jobType: "pdf.merge",
        options: {
          pageOrder: [0],
        },
      }),
    } as never);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again later.",
      },
    });
  });
});
