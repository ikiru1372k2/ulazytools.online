export {};

const auth = jest.fn();
const findUnique = jest.fn();
const info = jest.fn();
const warn = jest.fn();
const error = jest.fn();
const presignGet = jest.fn();
const assertJobStatusAllowed = jest.fn();

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

describe("/api/jobs/[jobId]", () => {
  beforeEach(() => {
    jest.resetModules();
    auth.mockReset();
    findUnique.mockReset();
    info.mockReset();
    warn.mockReset();
    error.mockReset();
    presignGet.mockReset();
    assertJobStatusAllowed.mockReset();

    jest.doMock("@/lib/auth", () => ({ auth }));
    jest.doMock("@/lib/db", () => ({
      prisma: {
        job: {
          findUnique,
        },
      },
    }));
    jest.doMock("@/lib/storage", () => ({
      presignGet,
    }));
    jest.doMock("@/server/jobs/rateLimit", () => ({
      assertJobStatusAllowed,
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
      completedAt: null,
      createdAt: new Date("2026-04-04T11:00:00.000Z"),
      errorCode: null,
      errorMessage: null,
      fileObject: {
        guestId: null,
      },
      id: "job-123",
      outputRef: null,
      status: "PENDING",
      updatedAt: new Date("2026-04-04T11:01:00.000Z"),
      userId: "user-123",
      ...overrides,
    };
  }

  it("returns pending for the owning authenticated user", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(buildJob());

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers({
          "x-forwarded-for": "203.0.113.10",
          "x-request-id": "req-123",
        }),
      } as never,
      {
        params: {
          jobId: "job-123",
        },
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "pending" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("ETag")).toBeTruthy();
    expect(assertJobStatusAllowed).toHaveBeenCalledWith({
      guestId: undefined,
      ip: "203.0.113.10",
      userId: "user-123",
    });
  });

  it("returns processing for a running job", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(buildJob({ status: "RUNNING" }));

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    await expect(response.json()).resolves.toEqual({ status: "processing" });
  });

  it("returns a signed download URL for succeeded jobs", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    presignGet.mockResolvedValue("https://example.com/download");
    findUnique.mockResolvedValue(
      buildJob({
        outputRef: "outputs/job-123/processed.pdf",
        status: "SUCCEEDED",
      })
    );

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    await expect(response.json()).resolves.toEqual({
      downloadUrl: "https://example.com/download",
      status: "done",
    });
    expect(response.headers.get("ETag")).toBeNull();
    expect(presignGet).toHaveBeenCalledWith(
      "outputs/job-123/processed.pdf",
      300
    );
  });

  it("returns failed jobs with safe error fields", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(
      buildJob({
        errorCode: "WorkerError",
        errorMessage: "PDF processing failed.",
        status: "FAILED",
      })
    );

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    await expect(response.json()).resolves.toEqual({
      errorCode: "WorkerError",
      status: "failed",
    });
  });

  it("returns canceled for canceled jobs", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(buildJob({ status: "CANCELED" }));

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    await expect(response.json()).resolves.toEqual({ status: "canceled" });
  });

  it("returns 404 for a different authenticated user", async () => {
    auth.mockResolvedValue({ user: { id: "user-999" } });
    findUnique.mockResolvedValue(buildJob());

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

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

  it("allows the matching guest owner", async () => {
    auth.mockResolvedValue(null);
    findUnique.mockResolvedValue(
      buildJob({
        fileObject: {
          guestId: "guest-123",
        },
        userId: null,
      })
    );

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(() => ({ value: "guest-123" })),
        },
        headers: new Headers({
          "x-real-ip": "198.51.100.20",
        }),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(200);
    expect(assertJobStatusAllowed).toHaveBeenCalledWith({
      guestId: "guest-123",
      ip: "198.51.100.20",
      userId: undefined,
    });
  });

  it("returns 404 for guest token mismatch", async () => {
    auth.mockResolvedValue(null);
    findUnique.mockResolvedValue(
      buildJob({
        fileObject: {
          guestId: "guest-123",
        },
        userId: null,
      })
    );

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(() => ({ value: "guest-999" })),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(404);
  });

  it("returns 404 when the job does not exist", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(null);

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

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

  it("returns 410 for an authorized expired job", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(
      buildJob({
        completedAt: new Date("2026-04-03T10:00:00.000Z"),
        status: "SUCCEEDED",
        updatedAt: new Date("2026-04-03T10:00:00.000Z"),
      })
    );

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

    const originalDateNow = Date.now;
    Date.now = jest.fn(() => new Date("2026-04-04T12:00:00.000Z").getTime());

    try {
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
        error: "JOB_EXPIRED",
      });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    } finally {
      Date.now = originalDateNow;
    }
  });

  it("returns 404 for a denied expired job", async () => {
    auth.mockResolvedValue({ user: { id: "user-999" } });
    findUnique.mockResolvedValue(
      buildJob({
        completedAt: new Date("2026-04-03T10:00:00.000Z"),
        status: "FAILED",
        updatedAt: new Date("2026-04-03T10:00:00.000Z"),
      })
    );

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

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

  it("never leaks internal outputRef fields in the succeeded payload", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    presignGet.mockResolvedValue("https://example.com/download");
    findUnique.mockResolvedValue(
      buildJob({
        outputRef: "outputs/job-123/processed.pdf",
        status: "SUCCEEDED",
      })
    );

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    const body = await response.json();
    expect(body).not.toHaveProperty("outputRef");
    expect(body).not.toHaveProperty("inputRef");
  });

  it("does not expire an old running job", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(
      buildJob({
        completedAt: null,
        createdAt: new Date("2026-04-01T10:00:00.000Z"),
        status: "RUNNING",
        updatedAt: new Date("2026-04-01T10:00:00.000Z"),
      })
    );

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

    const response = await GET(
      {
        cookies: {
          get: jest.fn(),
        },
        headers: new Headers(),
      } as never,
      { params: { jobId: "job-123" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "processing" });
  });

  it("returns a generic 500 when a succeeded job is missing outputRef", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    findUnique.mockResolvedValue(
      buildJob({
        outputRef: null,
        status: "SUCCEEDED",
      })
    );

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

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
      error: "Unable to load job status",
    });
  });

  it("returns a generic 500 when presignGet fails", async () => {
    auth.mockResolvedValue({ user: { id: "user-123" } });
    presignGet.mockRejectedValue(new Error("storage unavailable"));
    findUnique.mockResolvedValue(
      buildJob({
        outputRef: "outputs/job-123/processed.pdf",
        status: "SUCCEEDED",
      })
    );

    const { GET } = await import("@/app/api/jobs/[jobId]/route");

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
      error: "Unable to load job status",
    });
  });
});
