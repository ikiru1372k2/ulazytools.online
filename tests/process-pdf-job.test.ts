describe("processPdfJob", () => {
  const findUnique = jest.fn();
  const info = jest.fn();
  const error = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    findUnique.mockReset();
    info.mockReset();
    error.mockReset();

    jest.doMock(
      "pino",
      () => {
        const child = jest.fn(() => ({ child, error, info }));
        const instance = { child, error, info };
        const pino = jest.fn(() => instance);
        return { __esModule: true, default: pino };
      },
      { virtual: true }
    );

    jest.doMock("@/lib/db", () => ({
      prisma: {
        job: {
          findUnique,
        },
      },
    }));
  });

  it("logs structured job metadata when processing succeeds", async () => {
    findUnique.mockResolvedValue({
      id: "job-123",
      inputRef: "uploads/2026/04/job-123/input.pdf",
      type: "process",
      userId: "user-123",
    });

    const { processPdfJob } = await import("@/server/jobs/processPdfJob");

    await expect(
      processPdfJob({
        jobId: "job-123",
        requestId: "req-123",
        type: "process",
      })
    ).resolves.toEqual({
      outputKey: "outputs/job-123/processed.pdf",
      userId: "user-123",
    });

    expect(info).toHaveBeenCalledWith(
      {
        inputRef: "uploads/2026/04/job-123/input.pdf",
        jobType: "process",
      },
      "Stub processing PDF job"
    );
  });
});
