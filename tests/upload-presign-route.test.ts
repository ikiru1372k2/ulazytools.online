export {};

const auth = jest.fn();
const create = jest.fn();
const info = jest.fn();
const warn = jest.fn();
const error = jest.fn();
const presignPut = jest.fn();
const getStorageBucket = jest.fn();
const resolveGuestSession = jest.fn();
const serializeGuestCookie = jest.fn();
const assertUploadPresignAllowed = jest.fn();
const buildObjectKey = jest.fn();
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
      const cookieCalls: unknown[] = [];
      const headers = new Headers();

      return {
        cookies: {
          set: (...args: unknown[]) => {
            cookieCalls.push(args);
          },
        },
        cookieCalls,
        headers,
        async json() {
          return body;
        },
        status: init?.status ?? 200,
      };
    },
  },
}));

describe("/api/upload/presign", () => {
  beforeEach(() => {
    jest.resetModules();
    auth.mockReset();
    create.mockReset();
    info.mockReset();
    warn.mockReset();
    error.mockReset();
    presignPut.mockReset();
    getStorageBucket.mockReset();
    resolveGuestSession.mockReset();
    serializeGuestCookie.mockReset();
    assertUploadPresignAllowed.mockReset();
    buildObjectKey.mockReset();

    process.env.MAX_UPLOAD_MB = "10";
    process.env.PRESIGN_EXPIRES_SECONDS = "60";
    process.env.FILE_RETENTION_HOURS = "168";
    jest.doMock("@/lib/auth", () => ({ auth }));
    jest.doMock("@/lib/db", () => ({
      prisma: {
        fileObject: {
          create,
        },
      },
    }));
    jest.doMock("@/lib/storage", () => ({
      getStorageBucket,
      presignPut,
    }));
    jest.doMock("@/lib/objectKey", () => ({
      buildObjectKey: (...args: unknown[]) => buildObjectKey(...args),
      buildObjectTags: jest.fn((input: { expiresAt?: Date | null; jobId?: string | null } = {}) => ({
        app: "ulazytoolsa",
        ...(input.expiresAt
          ? {
              expiresAt: input.expiresAt.toISOString(),
            }
          : {}),
        ...(input.jobId
          ? {
              jobId: input.jobId,
            }
          : {}),
      })),
    }));
    jest.doMock("@/server/uploads/rateLimit", () => ({
      assertUploadPresignAllowed,
    }));
    jest.doMock("@/server/rateLimit", () => ({
      RateLimitExceededError: MockRateLimitExceededError,
    }));
    jest.doMock("@/lib/guest", () => ({
      getGuestCookieOptions: jest.fn(() => ({
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: false,
      })),
      GUEST_ID_COOKIE: "guestId",
      INTERNAL_GUEST_ID_HEADER: "x-ulazytools-guest-id",
      INTERNAL_GUEST_ID_TRUST_HEADER: "x-ulazytools-guest-trusted",
      isGuestId: (value: string) =>
        /^[0-9a-f-]{36}$/i.test(value),
      resolveGuestSession: (...args: unknown[]) => resolveGuestSession(...args),
      serializeGuestCookie: (...args: unknown[]) => serializeGuestCookie(...args),
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

  it("creates a presigned upload for an authenticated user", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    buildObjectKey.mockReturnValue(
      "uploads/2026/04/users/user-123/jobs/file-seed/report.pdf"
    );
    create.mockResolvedValue({
      id: "file-123",
      objectKey: "uploads/2026/04/users/user-123/jobs/file-seed/report.pdf",
    });
    presignPut.mockResolvedValue({
      headers: {
        "Content-Type": "application/pdf",
      },
      uploadUrl: "https://example.com/upload",
    });
    getStorageBucket.mockReturnValue("test-bucket");

    const { POST } = await import("@/app/api/upload/presign/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers({
        "content-type": "application/json",
        "x-request-id": "req-123",
      }),
      json: async () => ({
        contentType: "application/pdf",
        filename: "report.pdf",
        sizeBytes: 4096,
      }),
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      expiresInSeconds: 60,
      fileId: "file-123",
      headers: {
        "Content-Type": "application/pdf",
      },
      objectKey: "uploads/2026/04/users/user-123/jobs/file-seed/report.pdf",
      uploadUrl: "https://example.com/upload",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bucket: "test-bucket",
          checksum: null,
          expiresAt: null,
          guestId: null,
          mimeType: "application/pdf",
          originalName: "report.pdf",
          status: "PENDING_UPLOAD",
          userId: "user-123",
        }),
      })
    );
    expect(buildObjectKey).toHaveBeenCalledWith({
      filename: "report.pdf",
      guestId: undefined,
      jobId: expect.any(String),
      kind: "upload",
      userId: "user-123",
    });
    expect(presignPut).toHaveBeenCalledWith(
      "uploads/2026/04/users/user-123/jobs/file-seed/report.pdf",
      "application/pdf",
      60,
      {
        tags: {
          app: "ulazytoolsa",
        },
      }
    );
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "file-123",
        mimeType: "application/pdf",
      }),
      "Created presigned upload"
    );
    expect(resolveGuestSession).not.toHaveBeenCalled();
  });

  it("creates a guest cookie for anonymous callers", async () => {
    auth.mockResolvedValue(null);
    buildObjectKey.mockReturnValue(
      "uploads/2026/04/guests/guest-123/jobs/file-seed/guest.pdf"
    );
    resolveGuestSession.mockResolvedValue({
      guestId: "guest-123",
      isNew: true,
      shouldSetCookie: true,
    });
    serializeGuestCookie.mockResolvedValue("guest-123.signature");
    create.mockResolvedValue({
      id: "file-guest",
      objectKey: "uploads/2026/04/guests/guest-123/jobs/file-seed/guest.pdf",
    });
    presignPut.mockResolvedValue({
      headers: {
        "Content-Type": "application/pdf",
      },
      uploadUrl: "https://example.com/upload",
    });
    getStorageBucket.mockReturnValue("test-bucket");

    const { POST } = await import("@/app/api/upload/presign/route");

    const response = (await POST({
      cookies: {
        get: jest.fn(() => undefined),
      },
      headers: new Headers(),
      json: async () => ({
        contentType: "application/pdf",
        filename: "guest.pdf",
        sizeBytes: 2048,
      }),
    } as never)) as any;

    expect(response.status).toBe(200);
    expect(response.cookieCalls).toHaveLength(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expiresAt: null,
          guestId: "guest-123",
          status: "PENDING_UPLOAD",
          userId: null,
        }),
      })
    );
  });

  it("uses the middleware-forwarded guest identity without minting a second one", async () => {
    auth.mockResolvedValue(null);
    buildObjectKey.mockReturnValue(
      "uploads/2026/04/guests/00000000-0000-4000-8000-000000000123/jobs/file-seed/forwarded.pdf"
    );
    create.mockResolvedValue({
      id: "file-forwarded",
      objectKey:
        "uploads/2026/04/guests/00000000-0000-4000-8000-000000000123/jobs/file-seed/forwarded.pdf",
    });
    presignPut.mockResolvedValue({
      headers: {
        "Content-Type": "application/pdf",
      },
      uploadUrl: "https://example.com/upload",
    });
    getStorageBucket.mockReturnValue("test-bucket");

    const { POST } = await import("@/app/api/upload/presign/route");

    const response = (await POST({
      cookies: {
        get: jest.fn(() => undefined),
      },
      headers: new Headers({
        "x-ulazytools-guest-id": "00000000-0000-4000-8000-000000000123",
        "x-ulazytools-guest-trusted": "1",
      }),
      json: async () => ({
        contentType: "application/pdf",
        filename: "forwarded.pdf",
        sizeBytes: 2048,
      }),
    } as never)) as any;

    expect(response.status).toBe(200);
    expect(resolveGuestSession).not.toHaveBeenCalled();
    expect(response.cookieCalls).toHaveLength(0);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expiresAt: null,
          guestId: "00000000-0000-4000-8000-000000000123",
        }),
      })
    );
  });

  it("ignores an untrusted forwarded guest identity", async () => {
    auth.mockResolvedValue(null);
    buildObjectKey.mockReturnValue(
      "uploads/2026/04/guests/guest-123/jobs/file-seed/untrusted.pdf"
    );
    resolveGuestSession.mockResolvedValue({
      guestId: "guest-123",
      isNew: false,
      shouldSetCookie: false,
    });
    create.mockResolvedValue({
      id: "file-untrusted",
      objectKey: "uploads/2026/04/guests/guest-123/jobs/file-seed/untrusted.pdf",
    });
    presignPut.mockResolvedValue({
      headers: {
        "Content-Type": "application/pdf",
      },
      uploadUrl: "https://example.com/upload",
    });
    getStorageBucket.mockReturnValue("test-bucket");

    const { POST } = await import("@/app/api/upload/presign/route");

    await POST({
      cookies: {
        get: jest.fn(() => undefined),
      },
      headers: new Headers({
        "x-ulazytools-guest-id": "00000000-0000-4000-8000-000000000123",
      }),
      json: async () => ({
        contentType: "application/pdf",
        filename: "untrusted.pdf",
        sizeBytes: 2048,
      }),
    } as never);

    expect(resolveGuestSession).toHaveBeenCalled();
  });

  it("returns 400 for invalid upload payloads", async () => {
    auth.mockResolvedValue(null);
    resolveGuestSession.mockResolvedValue({
      guestId: "guest-123",
      isNew: false,
      shouldSetCookie: false,
    });

    const { POST } = await import("@/app/api/upload/presign/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        contentType: "image/png",
        filename: "image.png",
        sizeBytes: 100,
      }),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Only PDF uploads are allowed",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 500 for storage failures", async () => {
    auth.mockResolvedValue(null);
    buildObjectKey.mockReturnValue(
      "uploads/2026/04/guests/guest-123/jobs/file-seed/fail.pdf"
    );
    resolveGuestSession.mockResolvedValue({
      guestId: "guest-123",
      isNew: false,
      shouldSetCookie: false,
    });
    create.mockResolvedValue({
      id: "file-500",
      objectKey: "uploads/2026/04/guests/guest-123/jobs/file-seed/fail.pdf",
    });
    presignPut.mockRejectedValue(new Error("storage failed"));
    getStorageBucket.mockReturnValue("test-bucket");

    const { POST } = await import("@/app/api/upload/presign/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        contentType: "application/pdf",
        filename: "fail.pdf",
        sizeBytes: 1000,
      }),
    } as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Unable to create upload URL",
    });
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
      }),
      "Failed to create presigned upload"
    );
  });

  it("returns 429 with Retry-After when upload presign is rate limited", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    assertUploadPresignAllowed.mockRejectedValue(
      new MockRateLimitExceededError(17)
    );

    const { POST } = await import("@/app/api/upload/presign/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        contentType: "application/pdf",
        filename: "report.pdf",
        sizeBytes: 4096,
      }),
    } as never);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    await expect(response.json()).resolves.toEqual({
      error: "RATE_LIMITED",
    });
    expect(create).not.toHaveBeenCalled();
  });
});
