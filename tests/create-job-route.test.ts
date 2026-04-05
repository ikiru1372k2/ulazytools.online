export {};

const auth = jest.fn();
const findMany = jest.fn();
const create = jest.fn();
const update = jest.fn();
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

describe("/api/jobs", () => {
  beforeEach(() => {
    jest.resetModules();
    auth.mockReset();
    findMany.mockReset();
    create.mockReset();
    update.mockReset();
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

    jest.doMock("@/lib/auth", () => ({ auth }));
    jest.doMock("@/lib/db", () => ({
      prisma: {
        fileObject: {
          findMany,
        },
        job: {
          create,
          update,
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

  it("creates a merge job for the owning authenticated user", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findMany.mockResolvedValue([
      { id: "file-1", objectKey: "uploads/first.pdf" },
      { id: "file-2", objectKey: "uploads/second.pdf" },
    ]);
    create.mockResolvedValue({
      id: "job-123",
    });

    const { POST } = await import("@/app/api/jobs/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers({
        "x-request-id": "req-123",
      }),
      json: async () => ({
        inputKeys: ["uploads/first.pdf", "uploads/second.pdf"],
        jobType: "merge",
        options: {
          includeBookmarks: true,
          outputFilename: "merged.pdf",
        },
      }),
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-123",
      status: "pending",
    });
    expect(findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        objectKey: true,
      },
      where: {
        objectKey: {
          in: ["uploads/first.pdf", "uploads/second.pdf"],
        },
        status: "READY",
        userId: "user-123",
      },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fileObjectId: "file-1",
        guestId: null,
        status: "PENDING",
        type: "merge",
        userId: "user-123",
      }),
      select: {
        id: true,
      },
    });
    expect(enqueuePdfJob).toHaveBeenCalledWith({
      jobId: "job-123",
      requestId: "req-123",
      type: "merge",
    });
    expect(assertJobCreateAllowed).toHaveBeenCalledWith({
      guestId: undefined,
      ip: undefined,
      userId: "user-123",
    });
  });

  it("creates a merge job for the matching guest owner", async () => {
    auth.mockResolvedValue(null);
    verifyGuestCookieValue.mockResolvedValue("guest-123");
    findMany.mockResolvedValue([
      { id: "file-1", objectKey: "uploads/first.pdf" },
      { id: "file-2", objectKey: "uploads/second.pdf" },
    ]);
    create.mockResolvedValue({
      id: "job-guest",
    });

    const { POST } = await import("@/app/api/jobs/route");

    const response = await POST({
      cookies: {
        get: jest.fn(() => ({ value: "guest-123.signature" })),
      },
      headers: new Headers(),
      json: async () => ({
        inputKeys: ["uploads/first.pdf", "uploads/second.pdf"],
        jobType: "merge",
        options: {
          includeBookmarks: false,
        },
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(verifyGuestCookieValue).toHaveBeenCalledWith("guest-123.signature");
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        guestId: "guest-123",
        userId: null,
      }),
      select: {
        id: true,
      },
    });
  });

  it("returns 400 for invalid payloads", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });

    const { POST } = await import("@/app/api/jobs/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        inputKeys: ["uploads/only-one.pdf"],
        jobType: "merge",
        options: {
          includeBookmarks: true,
        },
      }),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_JOB_REQUEST",
        message: "Select at least two uploaded PDFs.",
      },
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when an uploaded file is missing or unauthorized", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findMany.mockResolvedValue([{ id: "file-1", objectKey: "uploads/first.pdf" }]);

    const { POST } = await import("@/app/api/jobs/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        inputKeys: ["uploads/first.pdf", "uploads/second.pdf"],
        jobType: "merge",
        options: {
          includeBookmarks: false,
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

  it("marks the created job failed when enqueueing the worker job fails", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findMany.mockResolvedValue([
      { id: "file-1", objectKey: "uploads/first.pdf" },
      { id: "file-2", objectKey: "uploads/second.pdf" },
    ]);
    create.mockResolvedValue({
      id: "job-stuck",
    });
    enqueuePdfJob.mockRejectedValue(new Error("queue unavailable"));

    const { POST } = await import("@/app/api/jobs/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        inputKeys: ["uploads/first.pdf", "uploads/second.pdf"],
        jobType: "merge",
        options: {
          includeBookmarks: false,
        },
      }),
    } as never);

    expect(response.status).toBe(500);
    expect(update).toHaveBeenCalledWith({
      where: {
        id: "job-stuck",
      },
      data: expect.objectContaining({
        errorCode: "QUEUE_ENQUEUE_FAILED",
        errorMessage: "Unable to queue merge job",
        status: "FAILED",
      }),
    });
  });

  it("returns 429 when job creation is rate limited", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    assertJobCreateAllowed.mockRejectedValue(new MockRateLimitExceededError(12));

    const { POST } = await import("@/app/api/jobs/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        inputKeys: ["uploads/first.pdf", "uploads/second.pdf"],
        jobType: "merge",
        options: {
          includeBookmarks: false,
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
    expect(create).not.toHaveBeenCalled();
  });
});
