describe("pdf queue payload normalization", () => {
  const add = jest.fn();
  const incrementJobsCreatedCount = jest.fn();
  const upsertJobScheduler = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.CLEANUP_BATCH_SIZE = "500";
    process.env.CLEANUP_REPEAT_EVERY_MS = "300000";
    process.env.FILE_RETENTION_HOURS = "168";
    process.env.METRICS_ENABLED = "false";
    add.mockReset();
    incrementJobsCreatedCount.mockReset();
    upsertJobScheduler.mockReset();
    jest.doMock(
      "bullmq",
      () => ({
        Queue: jest.fn(() => ({
          add,
          upsertJobScheduler,
        })),
      }),
      { virtual: true }
    );
    jest.doMock("ioredis", () => jest.fn(), { virtual: true });
    jest.doMock("@/lib/metrics", () => ({
      incrementJobsCreatedCount,
    }));
  });

  it("requires a non-empty job ID", async () => {
    const { normalizePdfJobPayload } = await import("@/lib/queue");

    expect(() =>
      normalizePdfJobPayload({
        jobId: "   ",
        type: "process",
      })
    ).toThrow(/non-empty jobId/i);
  });

  it("preserves a trimmed request ID when present", async () => {
    const { normalizePdfJobPayload } = await import("@/lib/queue");

    expect(
      normalizePdfJobPayload({
        jobId: " job-123 ",
        requestId: " req-123 ",
        type: "process",
      })
    ).toEqual({
      jobId: "job-123",
      requestId: "req-123",
      type: "process",
    });
  });

  it("registers the repeatable cleanup job using the configured schedule", async () => {
    const { CLEANUP_JOB_NAME, registerCleanupJob } = await import("@/lib/queue");

    await registerCleanupJob();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      CLEANUP_JOB_NAME,
      {
        every: 300000,
      },
      expect.objectContaining({
        data: {
          requestedAt: expect.any(String),
        },
        name: CLEANUP_JOB_NAME,
      })
    );
  });

  it("increments the jobs-created metric after enqueue succeeds", async () => {
    add.mockResolvedValue({
      id: "job-123",
      name: "process",
    });

    const { enqueuePdfJob } = await import("@/lib/queue");

    await enqueuePdfJob({
      jobId: "job-123",
      type: "process",
    });

    expect(incrementJobsCreatedCount).toHaveBeenCalledTimes(1);
  });
});
