describe("processPdfJob", () => {
  const findUnique = jest.fn();
  const uploadBuffer = jest.fn();
  const info = jest.fn();
  const error = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    findUnique.mockReset();
    uploadBuffer.mockReset();
    info.mockReset();
    error.mockReset();

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

    jest.doMock("@/lib/db", () => ({
      prisma: {
        job: {
          findUnique,
        },
      },
    }));
    jest.doMock("@/lib/storage", () => ({
      uploadBuffer,
    }));
  });

  it("logs structured job metadata when processing succeeds", async () => {
    findUnique.mockResolvedValue({
      guestId: null,
      id: "job-123",
      inputRef: "uploads/2026/04/job-123/input.pdf",
      type: "process",
      userId: "user-123",
    });

    const { processPdfJob } = await import("@/server/jobs/processPdfJob");
    uploadBuffer.mockResolvedValue({
      bucket: "test-bucket",
      contentType: "application/pdf",
      key: "outputs/job-123/processed.pdf",
      size: 0,
    });

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

    expect(uploadBuffer).toHaveBeenCalledWith(
      "outputs/job-123/processed.pdf",
      expect.any(Buffer),
      "application/pdf",
      {
        tags: {
          app: "ulazytoolsa",
          jobId: "job-123",
        },
      }
    );

    expect(info).toHaveBeenCalledWith(
      {
        hasInputRef: true,
        jobType: "process",
      },
      "Stub processing PDF job"
    );
  });
});
