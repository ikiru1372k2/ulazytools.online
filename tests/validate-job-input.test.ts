export {};

const findMany = jest.fn();

describe("parseAndValidateMergeJobInput", () => {
  beforeEach(() => {
    jest.resetModules();
    findMany.mockReset();

    jest.doMock("@/lib/db", () => ({
      prisma: {
        fileObject: {
          findMany,
        },
      },
    }));
  });

  it("returns normalized files for a valid pdf.merge request", async () => {
    findMany.mockResolvedValue([
      { id: "file-1", objectKey: "uploads/first.pdf" },
      { id: "file-2", objectKey: "uploads/second.pdf" },
    ]);

    const { parseAndValidateMergeJobInput } = await import(
      "@/server/jobs/validateJobInput"
    );

    await expect(
      parseAndValidateMergeJobInput(
        {
          inputFileIds: ["file-2", "file-1"],
          jobType: "pdf.merge",
          options: {
            pageOrder: [1, 0],
          },
        },
        {
          userId: "user-123",
        }
      )
    ).resolves.toEqual({
      files: [
        { id: "file-2", objectKey: "uploads/second.pdf" },
        { id: "file-1", objectKey: "uploads/first.pdf" },
      ],
      inputFileIds: ["file-2", "file-1"],
      jobType: "pdf.merge",
      options: {
        pageOrder: [1, 0],
      },
    });
  });

  it("rejects duplicate file ids", async () => {
    const { parseAndValidateMergeJobInput } = await import(
      "@/server/jobs/validateJobInput"
    );

    await expect(
      parseAndValidateMergeJobInput(
        {
          inputFileIds: ["file-1", "file-1"],
          jobType: "pdf.merge",
          options: {
            pageOrder: [0, 1],
          },
        },
        {
          userId: "user-123",
        }
      )
    ).rejects.toMatchObject({
      code: "INVALID_JOB_REQUEST",
      userMessage: "Each uploaded PDF can only be included once.",
    });
  });

  it("rejects bad page order permutations", async () => {
    const { parseAndValidateMergeJobInput } = await import(
      "@/server/jobs/validateJobInput"
    );

    await expect(
      parseAndValidateMergeJobInput(
        {
          inputFileIds: ["file-1", "file-2"],
          jobType: "pdf.merge",
          options: {
            pageOrder: [0, 0],
          },
        },
        {
          userId: "user-123",
        }
      )
    ).rejects.toMatchObject({
      code: "INVALID_PAGE_ORDER",
      userMessage:
        "Page order must be a zero-based permutation of the uploaded PDFs.",
    });
  });
});
