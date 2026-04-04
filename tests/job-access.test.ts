describe("job access helpers", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("authorizes the owning authenticated user", async () => {
    const { canAccessJob } = await import("@/server/jobs/jobAccess");

    expect(
      canAccessJob(
        {
          guestId: null,
          userId: "user-123",
        },
        {
          userId: "user-123",
        }
      )
    ).toBe(true);
  });

  it("authorizes the matching guest through direct job guest ownership", async () => {
    const { canAccessJob } = await import("@/server/jobs/jobAccess");

    expect(
      canAccessJob(
        {
          guestId: "guest-123",
          userId: null,
        },
        {
          guestId: "guest-123",
        }
      )
    ).toBe(true);
  });

  it("rejects mismatched guest access", async () => {
    const { canAccessJob } = await import("@/server/jobs/jobAccess");

    expect(
      canAccessJob(
        {
          guestId: "guest-123",
          userId: null,
        },
        {
          guestId: "guest-999",
        }
      )
    ).toBe(false);
  });

  it("marks jobs older than 24 hours as expired", async () => {
    const { isJobExpired, JOB_RETENTION_MS } = await import(
      "@/server/jobs/jobAccess"
    );
    const now = new Date("2026-04-04T12:00:00.000Z");

    expect(
      isJobExpired(
        {
          completedAt: new Date(now.getTime() - JOB_RETENTION_MS - 1),
          status: "SUCCEEDED",
          updatedAt: new Date(now.getTime() - JOB_RETENTION_MS - 1),
        },
        now
      )
    ).toBe(true);
    expect(
      isJobExpired(
        {
          completedAt: new Date(now.getTime() - JOB_RETENTION_MS + 1),
          status: "FAILED",
          updatedAt: new Date(now.getTime() - JOB_RETENTION_MS + 1),
        },
        now
      )
    ).toBe(false);
  });

  it("does not expire active jobs based on age alone", async () => {
    const { isJobExpired, JOB_RETENTION_MS } = await import(
      "@/server/jobs/jobAccess"
    );
    const now = new Date("2026-04-04T12:00:00.000Z");

    expect(
      isJobExpired(
        {
          completedAt: null,
          status: "RUNNING",
          updatedAt: new Date(now.getTime() - JOB_RETENTION_MS - 1),
        },
        now
      )
    ).toBe(false);
  });

  it("maps succeeded jobs to a presigned done response", async () => {
    jest.doMock("@/lib/storage", () => ({
      presignGet: jest.fn(async () => "https://example.com/download"),
    }));

    const { toSafeJobProjection } = await import("@/server/jobs/jobAccess");

    await expect(
      toSafeJobProjection({
        completedAt: new Date("2026-04-04T11:01:00.000Z"),
        createdAt: new Date("2026-04-04T11:00:00.000Z"),
        errorCode: null,
        errorMessage: null,
        guestId: null,
        id: "job-123",
        outputRef: "outputs/job-123/processed.pdf",
        status: "SUCCEEDED",
        updatedAt: new Date("2026-04-04T11:01:00.000Z"),
        userId: "user-123",
      })
    ).resolves.toEqual({
      downloadUrl: "https://example.com/download",
      status: "done",
    });
  });

  it("maps failed jobs to a safe error projection", async () => {
    const { toSafeJobProjection } = await import("@/server/jobs/jobAccess");

    await expect(
      toSafeJobProjection({
        completedAt: new Date("2026-04-04T11:01:00.000Z"),
        createdAt: new Date("2026-04-04T11:00:00.000Z"),
        errorCode: "WorkerError",
        errorMessage: "PDF processing failed.",
        guestId: null,
        id: "job-123",
        outputRef: null,
        status: "FAILED",
        updatedAt: new Date("2026-04-04T11:01:00.000Z"),
        userId: "user-123",
      })
    ).resolves.toEqual({
      errorCode: "WorkerError",
      status: "failed",
    });
  });
});
