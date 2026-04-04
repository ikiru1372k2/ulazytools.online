export {};

const auth = jest.fn();
const findUnique = jest.fn();
const update = jest.fn();
const info = jest.fn();
const warn = jest.fn();
const error = jest.fn();
const loadVerifiedObjectMetadata = jest.fn();
const parseCompleteUploadInput = jest.fn();
const parseCompleteUploadJson = jest.fn();
const verifyGuestCookieValue = jest.fn();
const UploadCompletionError = class UploadCompletionError extends Error {
  __appErrorBrand = true as const;
  code: string;
  httpStatus: number;
  retryable: boolean;
  status: number;
  userMessage: string;

  constructor(
    message: string,
    status: number,
    retryable = false,
    code = status === 409 ? "UPLOAD_CONFLICT" : "UPLOAD_INVALID_REQUEST"
  ) {
    super(message);
    this.code = code;
    this.httpStatus = status;
    this.retryable = retryable;
    this.status = status;
    this.userMessage = message;
  }
};

jest.mock("next/server", () => ({
  NextResponse: {
    json(body: unknown, init?: { status?: number }) {
      return {
        async json() {
          return body;
        },
        status: init?.status ?? 200,
      };
    },
  },
}));

describe("/api/upload/complete", () => {
  beforeEach(() => {
    jest.resetModules();
    auth.mockReset();
    findUnique.mockReset();
    update.mockReset();
    info.mockReset();
    warn.mockReset();
    error.mockReset();
    loadVerifiedObjectMetadata.mockReset();
    verifyGuestCookieValue.mockReset();
    process.env.FILE_RETENTION_HOURS = "168";

    jest.doMock("@/lib/auth", () => ({ auth }));
    jest.doMock("@/lib/db", () => ({
      prisma: {
        fileObject: {
          findUnique,
          update,
        },
      },
    }));
    jest.doMock("@/server/uploads/verify", () => ({
      UploadCompletionError,
      loadVerifiedObjectMetadata,
      parseCompleteUploadInput,
      parseCompleteUploadJson,
    }));
    jest.doMock("@/lib/guest", () => ({
      GUEST_ID_COOKIE: "guestId",
      INTERNAL_GUEST_ID_HEADER: "x-ulazytools-guest-id",
      INTERNAL_GUEST_ID_TRUST_HEADER: "x-ulazytools-guest-trusted",
      isGuestId: (value: string) =>
        /^[0-9a-f-]{36}$/i.test(value),
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

    parseCompleteUploadJson.mockImplementation(async (request: { json: () => Promise<unknown> }) =>
      request.json()
    );
    parseCompleteUploadInput.mockImplementation((payload: { etag: string; fileId: string }) => ({
      etag: payload.etag.replace(/^"+|"+$/g, ""),
      fileId: payload.fileId,
    }));
  });

  it("completes an authenticated upload on matching size and etag", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue({
      checksum: null,
      guestId: null,
      id: "file-123",
      objectKey: "uploads/2026/04/file-123/report.pdf",
      sizeBytes: BigInt(1234),
      status: "PENDING_UPLOAD",
      userId: "user-123",
    });
    loadVerifiedObjectMetadata.mockResolvedValue({
      etag: "etag-123",
      size: BigInt(1234),
    });

    const { POST } = await import("@/app/api/upload/complete/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers({
        "x-request-id": "req-123",
      }),
      json: async () => ({
        etag: '"etag-123"',
        fileId: "file-123",
      }),
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: "file-123" },
      data: {
        checksum: "etag-123",
        expiresAt: expect.any(Date),
        status: "READY",
      },
    });
    expect(verifyGuestCookieValue).not.toHaveBeenCalled();
  });

  it("starts retention when upload verification succeeds", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue({
      checksum: null,
      guestId: null,
      id: "file-123",
      objectKey: "uploads/2026/04/file-123/report.pdf",
      sizeBytes: BigInt(1234),
      status: "PENDING_UPLOAD",
      userId: "user-123",
    });
    loadVerifiedObjectMetadata.mockResolvedValue({
      etag: "etag-123",
      size: BigInt(1234),
    });

    const { POST } = await import("@/app/api/upload/complete/route");
    const originalDateNow = Date.now;
    Date.now = jest.fn(() => new Date("2026-04-04T12:00:00.000Z").getTime());

    try {
      await POST({
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers(),
        json: async () => ({
          etag: '"etag-123"',
          fileId: "file-123",
        }),
      } as never);

      expect(update).toHaveBeenCalledWith({
        where: { id: "file-123" },
        data: {
          checksum: "etag-123",
          expiresAt: new Date("2026-04-11T12:00:00.000Z"),
          status: "READY",
        },
      });
    } finally {
      Date.now = originalDateNow;
    }
  });

  it("allows the matching guest to complete a guest upload", async () => {
    auth.mockResolvedValue(null);
    verifyGuestCookieValue.mockResolvedValue("guest-123");
    findUnique.mockResolvedValue({
      checksum: null,
      guestId: "guest-123",
      id: "file-guest",
      objectKey: "uploads/2026/04/file-guest/guest.pdf",
      sizeBytes: BigInt(200),
      status: "PENDING_UPLOAD",
      userId: null,
    });
    loadVerifiedObjectMetadata.mockResolvedValue({
      etag: "etag-guest",
      size: BigInt(200),
    });

    const { POST } = await import("@/app/api/upload/complete/route");

    const response = await POST({
      cookies: {
        get: jest.fn(() => ({ value: "guest-123" })),
      },
      headers: new Headers(),
      json: async () => ({
        etag: "etag-guest",
        fileId: "file-guest",
      }),
    } as never);

    expect(response.status).toBe(200);
  });

  it("uses the middleware-forwarded guest identity without re-verifying the cookie", async () => {
    auth.mockResolvedValue(null);
    findUnique.mockResolvedValue({
      checksum: null,
      guestId: "00000000-0000-4000-8000-000000000123",
      id: "file-forwarded",
      objectKey: "uploads/2026/04/file-forwarded/forwarded.pdf",
      sizeBytes: BigInt(200),
      status: "PENDING_UPLOAD",
      userId: null,
    });
    loadVerifiedObjectMetadata.mockResolvedValue({
      etag: "etag-forwarded",
      size: BigInt(200),
    });

    const { POST } = await import("@/app/api/upload/complete/route");

    const response = await POST({
      cookies: {
        get: jest.fn(() => undefined),
      },
      headers: new Headers({
        "x-ulazytools-guest-id": "00000000-0000-4000-8000-000000000123",
        "x-ulazytools-guest-trusted": "1",
      }),
      json: async () => ({
        etag: "etag-forwarded",
        fileId: "file-forwarded",
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(verifyGuestCookieValue).not.toHaveBeenCalled();
  });

  it("ignores an untrusted forwarded guest identity", async () => {
    auth.mockResolvedValue(null);
    verifyGuestCookieValue.mockResolvedValue("guest-123");
    findUnique.mockResolvedValue({
      checksum: null,
      guestId: "guest-123",
      id: "file-untrusted",
      objectKey: "uploads/2026/04/file-untrusted/untrusted.pdf",
      sizeBytes: BigInt(200),
      status: "PENDING_UPLOAD",
      userId: null,
    });
    loadVerifiedObjectMetadata.mockResolvedValue({
      etag: "etag-untrusted",
      size: BigInt(200),
    });

    const { POST } = await import("@/app/api/upload/complete/route");

    const response = await POST({
      cookies: {
        get: jest.fn(() => ({ value: "guest-123.signature" })),
      },
      headers: new Headers({
        "x-ulazytools-guest-id": "00000000-0000-4000-8000-000000000123",
      }),
      json: async () => ({
        etag: "etag-untrusted",
        fileId: "file-untrusted",
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(verifyGuestCookieValue).toHaveBeenCalledWith("guest-123.signature");
  });

  it("rejects non-owner callers", async () => {
    auth.mockResolvedValue({ user: { id: "user-999" } });
    verifyGuestCookieValue.mockResolvedValue(null);
    findUnique.mockResolvedValue({
      guestId: null,
      id: "file-123",
      objectKey: "uploads/key",
      sizeBytes: BigInt(100),
      status: "PENDING_UPLOAD",
      userId: "user-123",
    });

    const { POST } = await import("@/app/api/upload/complete/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        etag: "etag-123",
        fileId: "file-123",
      }),
    } as never);

    expect(response.status).toBe(404);
  });

  it("returns retryable when the object is not yet visible", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue({
      guestId: null,
      id: "file-123",
      objectKey: "uploads/key",
      sizeBytes: BigInt(100),
      status: "PENDING_UPLOAD",
      userId: "user-123",
    });
    loadVerifiedObjectMetadata.mockRejectedValue(
      new UploadCompletionError(
        "Upload is not visible yet",
        409,
        true,
        "UPLOAD_NOT_VISIBLE_YET"
      )
    );

    const { POST } = await import("@/app/api/upload/complete/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        etag: "etag-123",
        fileId: "file-123",
      }),
    } as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UPLOAD_NOT_VISIBLE_YET",
        message: "Upload is not visible yet",
      },
      retryable: true,
    });
  });

  it("marks failed on size mismatch", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue({
      guestId: null,
      id: "file-123",
      objectKey: "uploads/key",
      sizeBytes: BigInt(100),
      status: "PENDING_UPLOAD",
      userId: "user-123",
    });
    loadVerifiedObjectMetadata.mockResolvedValue({
      etag: "etag-123",
      size: BigInt(200),
    });

    const { POST } = await import("@/app/api/upload/complete/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        etag: "etag-123",
        fileId: "file-123",
      }),
    } as never);

    expect(response.status).toBe(409);
    expect(update).toHaveBeenCalledWith({
      where: { id: "file-123" },
      data: {
        status: "FAILED",
      },
    });
  });

  it("marks failed on etag mismatch", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue({
      guestId: null,
      id: "file-123",
      objectKey: "uploads/key",
      sizeBytes: BigInt(100),
      status: "PENDING_UPLOAD",
      userId: "user-123",
    });
    loadVerifiedObjectMetadata.mockResolvedValue({
      etag: "other-etag",
      size: BigInt(100),
    });

    const { POST } = await import("@/app/api/upload/complete/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        etag: "etag-123",
        fileId: "file-123",
      }),
    } as never);

    expect(response.status).toBe(409);
  });

  it("rejects duplicate completion once ready", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue({
      guestId: null,
      id: "file-123",
      objectKey: "uploads/key",
      sizeBytes: BigInt(100),
      status: "READY",
      userId: "user-123",
    });

    const { POST } = await import("@/app/api/upload/complete/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers(),
      json: async () => ({
        etag: "etag-123",
        fileId: "file-123",
      }),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_STATE_TRANSITION",
        message: "Invalid state transition",
      },
    });
  });
});
