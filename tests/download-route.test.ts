export {};

const auth = jest.fn();
const findUnique = jest.fn();
const createJobEvent = jest.fn();
const info = jest.fn();
const warn = jest.fn();
const error = jest.fn();
const getObjectMetadata = jest.fn();
const presignGet = jest.fn();
const verifyGuestCookieValue = jest.fn();
const MockStorageObjectNotFoundError = class StorageObjectNotFoundError extends Error {};

jest.mock("next/server", () => ({
  NextResponse: class MockNextResponse {
    headers: Headers;
    status: number;
    body: unknown;

    constructor(body: unknown, init?: { headers?: Headers; status?: number }) {
      this.body = body;
      this.headers = init?.headers ?? new Headers();
      this.status = init?.status ?? 200;
    }

    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, {
        headers: new Headers(),
        status: init?.status,
      });
    }

    static redirect(url: string, status = 307) {
      const headers = new Headers();
      headers.set("Location", url);
      return new MockNextResponse(null, {
        headers,
        status,
      });
    }

    async json() {
      return this.body;
    }
  },
}));

describe("/api/download/[jobId]", () => {
  const fixedNow = new Date("2026-04-04T12:00:00.000Z");

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(fixedNow);
    auth.mockReset();
    findUnique.mockReset();
    createJobEvent.mockReset();
    info.mockReset();
    warn.mockReset();
    error.mockReset();
    getObjectMetadata.mockReset();
    presignGet.mockReset();
    verifyGuestCookieValue.mockReset();

    jest.doMock("@/lib/auth", () => ({ auth }));
    jest.doMock("@/lib/db", () => ({
      prisma: {
        job: {
          findUnique,
        },
        jobEvent: {
          create: createJobEvent,
        },
      },
    }));
    jest.doMock("@/lib/storage", () => ({
      getObjectMetadata,
      presignGet,
      StorageObjectNotFoundError: MockStorageObjectNotFoundError,
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

  function buildJob(overrides: Record<string, unknown> = {}) {
    return {
      completedAt: new Date("2026-04-04T11:01:00.000Z"),
      fileObject: {
        originalName: "Original Report.pdf",
      },
      guestId: null,
      id: "job-123",
      outputRef: "outputs/job-123/processed.pdf",
      status: "SUCCEEDED",
      updatedAt: new Date("2026-04-04T11:01:00.000Z"),
      userId: "user-123",
      ...overrides,
    };
  }

  it("redirects the owning authenticated user to a presigned download URL", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(buildJob());
    getObjectMetadata.mockResolvedValue({
      etag: "etag-123",
      size: BigInt(1234),
    });
    presignGet.mockResolvedValue("https://example.com/download");

    const { GET } = await import("@/app/api/download/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers({
          "x-request-id": "req-123",
        }),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.com/download");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(presignGet).toHaveBeenCalledWith(
      "outputs/job-123/processed.pdf",
      300,
      {
        responseContentDisposition:
          'attachment; filename="Original Report.pdf"; filename*=UTF-8\'\'Original%20Report.pdf',
      }
    );
    expect(createJobEvent).toHaveBeenCalledWith({
      data: {
        jobId: "job-123",
        level: "info",
        message: "Output downloaded.",
        metadata: {
          actorType: "user",
          requestId: "req-123",
          route: "api_download",
        },
      },
    });
  });

  it("redirects the matching guest owner", async () => {
    auth.mockResolvedValue(null);
    verifyGuestCookieValue.mockResolvedValue("guest-123");
    findUnique.mockResolvedValue(
      buildJob({
        guestId: "guest-123",
        userId: null,
      })
    );
    getObjectMetadata.mockResolvedValue({
      etag: "etag-123",
      size: BigInt(1234),
    });
    presignGet.mockResolvedValue("https://example.com/download");

    const { GET } = await import("@/app/api/download/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(() => ({ value: "guest-123.signature" })),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(302);
    expect(verifyGuestCookieValue).toHaveBeenCalledWith("guest-123.signature");
  });

  it("uses the trusted forwarded guest identity and ignores the cookie path", async () => {
    auth.mockResolvedValue(null);
    findUnique.mockResolvedValue(
      buildJob({
        fileObject: {
          originalName: "Guest Report.pdf",
        },
        guestId: "00000000-0000-4000-8000-000000000123",
        userId: null,
      })
    );
    getObjectMetadata.mockResolvedValue({
      etag: "etag-123",
      size: BigInt(1234),
    });
    presignGet.mockResolvedValue("https://example.com/download");

    const { GET } = await import("@/app/api/download/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(() => undefined),
        },
        headers: new Headers({
          "x-ulazytools-guest-id": "00000000-0000-4000-8000-000000000123",
          "x-ulazytools-guest-trusted": "1",
        }),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(302);
    expect(verifyGuestCookieValue).not.toHaveBeenCalled();
  });

  it("ignores an untrusted forwarded guest identity", async () => {
    auth.mockResolvedValue(null);
    verifyGuestCookieValue.mockResolvedValue("guest-123");
    findUnique.mockResolvedValue(
      buildJob({
        guestId: "guest-123",
        userId: null,
      })
    );
    getObjectMetadata.mockResolvedValue({
      etag: "etag-123",
      size: BigInt(1234),
    });
    presignGet.mockResolvedValue("https://example.com/download");

    const { GET } = await import("@/app/api/download/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(() => ({ value: "guest-123.signature" })),
        },
        headers: new Headers({
          "x-ulazytools-guest-id": "00000000-0000-4000-8000-000000000123",
        }),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(302);
    expect(verifyGuestCookieValue).toHaveBeenCalledWith("guest-123.signature");
  });

  it("returns 404 for unauthorized callers", async () => {
    auth.mockResolvedValue({ user: { id: "user-999" } });
    findUnique.mockResolvedValue(buildJob());

    const { GET } = await import("@/app/api/download/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Not found",
      },
    });
  });

  it("returns 404 when the job does not exist", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(null);

    const { GET } = await import("@/app/api/download/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(404);
  });

  it("returns 409 for authorized jobs that are not ready", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(
      buildJob({
        outputRef: null,
        status: "RUNNING",
      })
    );

    const { GET } = await import("@/app/api/download/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "JOB_NOT_READY",
        message: "Job output is not ready yet",
      },
    });
    expect(presignGet).not.toHaveBeenCalled();
  });

  it("returns 410 for authorized expired output", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(
      buildJob({
        completedAt: new Date("2026-04-03T10:00:00.000Z"),
        updatedAt: new Date("2026-04-03T10:00:00.000Z"),
      })
    );

    const { GET } = await import("@/app/api/download/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "JOB_EXPIRED",
        message: "Job output has expired",
      },
    });
  });

  it("falls back to a safe filename when the original name is unavailable", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(
      buildJob({
        fileObject: null,
        outputRef: "outputs/job-123/Processed Final",
      })
    );
    getObjectMetadata.mockResolvedValue({
      etag: "etag-123",
      size: BigInt(1234),
    });
    presignGet.mockResolvedValue("https://example.com/download");

    const { GET } = await import("@/app/api/download/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(302);
    expect(presignGet).toHaveBeenCalledWith(
      "outputs/job-123/Processed Final",
      300,
      {
        responseContentDisposition:
          'attachment; filename="Processed Final.pdf"; filename*=UTF-8\'\'Processed%20Final.pdf',
      }
    );
  });

  it("still redirects when audit logging fails", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(buildJob());
    getObjectMetadata.mockResolvedValue({
      etag: "etag-123",
      size: BigInt(1234),
    });
    presignGet.mockResolvedValue("https://example.com/download");
    createJobEvent.mockRejectedValue(new Error("db unavailable"));

    const { GET } = await import("@/app/api/download/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers({
          "x-request-id": "req-456",
        }),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.com/download");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        jobId: "job-123",
      }),
      "Failed to persist download audit event"
    );
  });

  it("returns 410 when the output object is missing", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(buildJob());
    getObjectMetadata.mockRejectedValue(new MockStorageObjectNotFoundError());

    const { GET } = await import("@/app/api/download/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "JOB_EXPIRED",
        message: "Job output has expired",
      },
    });
    expect(presignGet).not.toHaveBeenCalled();
  });

  it("returns 405 for HEAD requests and advertises GET", async () => {
    const { HEAD } = await import("@/app/api/download/[jobId]/route");

    const response = await HEAD();

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
  });

  it("returns a generic 500 when storage signing fails", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(buildJob());
    getObjectMetadata.mockResolvedValue({
      etag: "etag-123",
      size: BigInt(1234),
    });
    presignGet.mockRejectedValue(new Error("storage unavailable"));

    const { GET } = await import("@/app/api/download/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "DOWNLOAD_URL_CREATION_FAILED",
        message: "Unable to create download URL",
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });
});
