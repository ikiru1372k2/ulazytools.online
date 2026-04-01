export {};

const auth = jest.fn();
const create = jest.fn();
const info = jest.fn();
const warn = jest.fn();
const error = jest.fn();
const presignPut = jest.fn();
const getStorageBucket = jest.fn();

jest.mock("next/server", () => ({
  NextResponse: {
    json(body: unknown, init?: { status?: number }) {
      const cookieCalls: unknown[] = [];

      return {
        cookies: {
          set: (...args: unknown[]) => {
            cookieCalls.push(args);
          },
        },
        cookieCalls,
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

    process.env.MAX_UPLOAD_MB = "10";
    process.env.PRESIGN_EXPIRES_SECONDS = "60";

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
    create.mockResolvedValue({
      id: "file-123",
      objectKey: "uploads/2026/04/upload/report.pdf",
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
      objectKey: "uploads/2026/04/upload/report.pdf",
      uploadUrl: "https://example.com/upload",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bucket: "test-bucket",
          checksum: null,
          guestId: null,
          mimeType: "application/pdf",
          originalName: "report.pdf",
          status: "PENDING_UPLOAD",
          userId: "user-123",
        }),
      })
    );
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "file-123",
        mimeType: "application/pdf",
      }),
      "Created presigned upload"
    );
  });

  it("creates a guest cookie for anonymous callers", async () => {
    auth.mockResolvedValue(null);
    create.mockResolvedValue({
      id: "file-guest",
      objectKey: "uploads/2026/04/upload/guest.pdf",
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
          guestId: expect.any(String),
          status: "PENDING_UPLOAD",
          userId: null,
        }),
      })
    );
  });

  it("returns 400 for invalid upload payloads", async () => {
    auth.mockResolvedValue(null);

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
    create.mockResolvedValue({
      id: "file-500",
      objectKey: "uploads/2026/04/upload/fail.pdf",
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
});
