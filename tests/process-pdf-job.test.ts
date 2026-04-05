describe("processPdfJob", () => {
  const findUnique = jest.fn();
  const findMany = jest.fn();
  const mergePdf = jest.fn();
  const uploadBuffer = jest.fn();
  const info = jest.fn();
  const error = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    findUnique.mockReset();
    findMany.mockReset();
    mergePdf.mockReset();
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
        fileObject: {
          findMany,
        },
        job: {
          findUnique,
        },
      },
    }));
    jest.doMock("@/server/pdf/mergePdf", () => ({
      mergePdf,
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

  it("preserves typed app errors from the output write path", async () => {
    findUnique.mockResolvedValue({
      guestId: null,
      id: "job-123",
      inputRef: "uploads/2026/04/job-123/input.pdf",
      type: "process",
      userId: "user-123",
    });

    const { ValidationError } = await import("@/lib/errors");
    const typedError = new ValidationError("Output object key is invalid", {
      code: "OUTPUT_KEY_INVALID",
      httpStatus: 409,
    });
    uploadBuffer.mockRejectedValue(typedError);

    const { processPdfJob } = await import("@/server/jobs/processPdfJob");

    await expect(
      processPdfJob({
        jobId: "job-123",
        requestId: "req-123",
        type: "process",
      })
    ).rejects.toMatchObject({
      code: "OUTPUT_KEY_INVALID",
      userMessage: "Output object key is invalid",
    });
  });

  it("dispatches pdf.merge jobs to the merge processor", async () => {
    findUnique.mockResolvedValue({
      guestId: null,
      id: "job-merge",
      inputRef: JSON.stringify({
        options: {
          pageOrder: [0, 1],
        },
        inputFileIds: ["file-1", "file-2"],
      }),
      type: "pdf.merge",
      userId: "user-123",
    });
    findMany.mockResolvedValue([
      { id: "file-1", objectKey: "uploads/first.pdf" },
      { id: "file-2", objectKey: "uploads/second.pdf" },
    ]);
    mergePdf.mockResolvedValue({
      outputKey: "outputs/job-merge/merged.pdf",
      userId: "user-123",
    });

    const { processPdfJob } = await import("@/server/jobs/processPdfJob");

    await expect(
      processPdfJob({
        jobId: "job-merge",
        requestId: "req-merge",
        type: "pdf.merge",
      })
    ).resolves.toEqual({
      outputKey: "outputs/job-merge/merged.pdf",
      userId: "user-123",
    });
    expect(mergePdf).toHaveBeenCalledWith({
      guestId: null,
      inputFiles: [
        { fileId: "file-1", objectKey: "uploads/first.pdf" },
        { fileId: "file-2", objectKey: "uploads/second.pdf" },
      ],
      jobId: "job-merge",
      pageOrder: [0, 1],
      requestId: "req-merge",
      userId: "user-123",
    });
    expect(findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        objectKey: true,
      },
      where: {
        id: {
          in: ["file-1", "file-2"],
        },
        mimeType: "application/pdf",
        status: "READY",
        userId: "user-123",
      },
    });
  });

  it("rejects persisted merge input with an invalid page order", async () => {
    findUnique.mockResolvedValue({
      guestId: null,
      id: "job-merge",
      inputRef: JSON.stringify({
        options: {
          pageOrder: [0, 0],
        },
        inputFileIds: ["file-1", "file-2"],
      }),
      type: "pdf.merge",
      userId: "user-123",
    });

    const { processPdfJob } = await import("@/server/jobs/processPdfJob");

    await expect(
      processPdfJob({
        jobId: "job-merge",
        requestId: "req-merge",
        type: "pdf.merge",
      })
    ).rejects.toMatchObject({
      code: "INVALID_PAGE_ORDER",
      userMessage: "Merge job page order is invalid.",
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("rejects merge jobs whose input files are no longer ready and owned", async () => {
    findUnique.mockResolvedValue({
      guestId: null,
      id: "job-merge",
      inputRef: JSON.stringify({
        options: {
          pageOrder: [0, 1],
        },
        inputFileIds: ["file-1", "file-2"],
      }),
      type: "pdf.merge",
      userId: "user-123",
    });
    findMany.mockResolvedValue([{ id: "file-1", objectKey: "uploads/first.pdf" }]);

    const { processPdfJob } = await import("@/server/jobs/processPdfJob");

    await expect(
      processPdfJob({
        jobId: "job-merge",
        requestId: "req-merge",
        type: "pdf.merge",
      })
    ).rejects.toMatchObject({
      code: "PDF_INPUT_NOT_FOUND",
      userMessage: "One or more PDFs are missing for this merge job.",
    });
  });
});
