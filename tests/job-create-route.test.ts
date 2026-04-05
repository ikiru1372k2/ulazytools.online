export {};

const auth = jest.fn();
const findUnique = jest.fn();
const create = jest.fn();
const update = jest.fn();
const enqueuePdfJob = jest.fn();
const info = jest.fn();
const error = jest.fn();
const verifyGuestCookieValue = jest.fn();

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
    findUnique.mockReset();
    create.mockReset();
    update.mockReset();
    enqueuePdfJob.mockReset();
    info.mockReset();
    error.mockReset();
    verifyGuestCookieValue.mockReset();

    jest.doMock("@/lib/auth", () => ({ auth }));
    jest.doMock("@/lib/db", () => ({
      prisma: {
        fileObject: {
          findUnique,
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
        };
        instance.child.mockReturnValue(instance);
        const pino = jest.fn(() => instance);
        return { __esModule: true, default: pino };
      },
      { virtual: true }
    );
  });

  it("creates and enqueues a split job for the owning authenticated user", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue({
      guestId: null,
      id: "file-123",
      mimeType: "application/pdf",
      objectKey: "uploads/2026/04/users/user-123/jobs/file/report.pdf",
      status: "READY",
      userId: "user-123",
    });
    create.mockResolvedValue({ id: "job-123" });
    enqueuePdfJob.mockResolvedValue({ id: "job-123" });

    const { POST } = await import("@/app/api/jobs/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers({
        "content-type": "application/json",
        "x-request-id": "req-123",
      }),
      json: async () => ({
        inputKeys: ["uploads/2026/04/users/user-123/jobs/file/report.pdf"],
        jobType: "split_pdf_ranges",
        options: {
          ranges: "1-3,5",
        },
      }),
    } as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-123",
      status: "pending",
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        fileObjectId: "file-123",
        guestId: null,
        inputRef: "uploads/2026/04/users/user-123/jobs/file/report.pdf",
        type: "split_pdf_ranges",
        userId: "user-123",
      },
      select: {
        id: true,
      },
    });
    expect(enqueuePdfJob).toHaveBeenCalledWith({
      inputKey: "uploads/2026/04/users/user-123/jobs/file/report.pdf",
      jobId: "job-123",
      options: {
        ranges: "1-3,5",
      },
      requestId: "req-123",
      type: "split_pdf_ranges",
    });
  });

  it("returns 409 when the file is not ready", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue({
      guestId: null,
      id: "file-123",
      mimeType: "application/pdf",
      objectKey: "uploads/file.pdf",
      status: "PENDING_UPLOAD",
      userId: "user-123",
    });

    const { POST } = await import("@/app/api/jobs/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers({
        "content-type": "application/json",
      }),
      json: async () => ({
        inputKeys: ["uploads/file.pdf"],
        jobType: "split_pdf_ranges",
        options: {
          ranges: "1-3",
        },
      }),
    } as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FILE_NOT_READY",
        message: "Uploaded file is not ready yet",
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid ranges", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });

    const { POST } = await import("@/app/api/jobs/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers({
        "content-type": "application/json",
      }),
      json: async () => ({
        inputKeys: ["uploads/file.pdf"],
        jobType: "split_pdf_ranges",
        options: {
          ranges: "3-1",
        },
      }),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_JOB_REQUEST",
        message: "Use page ranges like 1-3,5,8-10.",
      },
    });
  });

  it("returns 400 for non-pdf file objects", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue({
      guestId: null,
      id: "file-123",
      mimeType: "image/png",
      objectKey: "uploads/file.png",
      status: "READY",
      userId: "user-123",
    });

    const { POST } = await import("@/app/api/jobs/route");

    const response = await POST({
      cookies: {
        get: jest.fn(),
      },
      headers: new Headers({
        "content-type": "application/json",
      }),
      json: async () => ({
        inputKeys: ["uploads/file.png"],
        jobType: "split_pdf_ranges",
        options: {
          ranges: "1-3",
        },
      }),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FILE_INVALID_TYPE",
        message: "Only PDF files can be split.",
      },
    });
    expect(create).not.toHaveBeenCalled();
  });
});
