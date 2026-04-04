describe("metrics module", () => {
  beforeEach(() => {
    jest.resetModules();
    delete (
      globalThis as typeof globalThis & {
        metricsMemoryState?: unknown;
        metricsRedis?: unknown;
        metricsStore?: unknown;
      }
    ).metricsMemoryState;
    delete (
      globalThis as typeof globalThis & {
        metricsMemoryState?: unknown;
        metricsRedis?: unknown;
        metricsStore?: unknown;
      }
    ).metricsRedis;
    delete (
      globalThis as typeof globalThis & {
        metricsMemoryState?: unknown;
        metricsRedis?: unknown;
        metricsStore?: unknown;
      }
    ).metricsStore;
    process.env = {
      ...process.env,
      METRICS_ENABLED: "false",
      NODE_ENV: "test",
    };
  });

  it("increments counters and renders prometheus text in memory mode", async () => {
    const {
      incrementJobsCreatedCount,
      incrementJobsFailedCount,
      incrementUploadPresignCount,
      observeJobLatencyMs,
      renderPrometheusMetrics,
      resetMetricsForTests,
    } = await import("@/lib/metrics");

    await resetMetricsForTests();
    await incrementUploadPresignCount();
    await incrementJobsCreatedCount();
    await incrementJobsFailedCount();
    await observeJobLatencyMs(320);
    await observeJobLatencyMs(820);

    const output = await renderPrometheusMetrics();

    expect(output).toContain("ulazy_upload_presign_total 1");
    expect(output).toContain("ulazy_jobs_created_total 1");
    expect(output).toContain("ulazy_jobs_failed_total 1");
    expect(output).toContain("# TYPE ulazy_job_latency_ms histogram");
    expect(output).toContain('ulazy_job_latency_ms_bucket{le="500"} 1');
    expect(output).toContain('ulazy_job_latency_ms_bucket{le="1000"} 2');
    expect(output).toContain('ulazy_job_latency_ms_bucket{le="+Inf"} 2');
    expect(output).toContain("ulazy_job_latency_ms_sum 1140");
    expect(output).toContain("ulazy_job_latency_ms_count 2");
    expect(output).not.toMatch(/userId|guestId|requestId|filename/);
  });

  it("uses redis-backed metrics in production when token auth enables scraping", async () => {
    const incrby = jest.fn().mockResolvedValue(1);
    const mget = jest
      .fn()
      .mockResolvedValue([
        "1",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
        "0",
      ]);

    process.env = {
      ...process.env,
      METRICS_ENABLED: "false",
      METRICS_TOKEN: "metrics-token",
      NODE_ENV: "production",
      REDIS_URL: "redis://localhost:6379",
      CLEANUP_BATCH_SIZE: "500",
      CLEANUP_REPEAT_EVERY_MS: "300000",
    };

    jest.doMock("ioredis", () =>
      jest.fn(() => ({
        incrby,
        mget,
      }))
    );

    const {
      incrementUploadPresignCount,
      renderPrometheusMetrics,
    } = await import("@/lib/metrics");

    await incrementUploadPresignCount();
    const output = await renderPrometheusMetrics();

    expect(incrby).toHaveBeenCalledWith(
      "metrics:counter:ulazy_upload_presign_total",
      1
    );
    expect(output).toContain("ulazy_upload_presign_total 1");
  });
});
