describe("pdf queue payload normalization", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.REDIS_URL = "redis://localhost:6379";
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
});
