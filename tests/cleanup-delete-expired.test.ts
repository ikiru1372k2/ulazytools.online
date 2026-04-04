export {};

const findMany = jest.fn();
const deleteJobMany = jest.fn();
const deleteFileObjectMany = jest.fn();
const transaction = jest.fn();
const remove = jest.fn();
const info = jest.fn();
const warn = jest.fn();
const error = jest.fn();

const MockStorageObjectNotFoundError = class StorageObjectNotFoundError extends Error {};

describe("deleteExpiredFileObjects", () => {
  beforeEach(() => {
    jest.resetModules();
    findMany.mockReset();
    deleteJobMany.mockReset();
    deleteFileObjectMany.mockReset();
    transaction.mockReset();
    remove.mockReset();
    info.mockReset();
    warn.mockReset();
    error.mockReset();

    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.CLEANUP_BATCH_SIZE = "2";
    process.env.CLEANUP_REPEAT_EVERY_MS = "300000";
    process.env.FILE_RETENTION_HOURS = "168";

    transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        fileObject: {
          deleteMany: deleteFileObjectMany,
        },
        job: {
          deleteMany: deleteJobMany,
        },
      })
    );

    jest.doMock("@/lib/db", () => ({
      prisma: {
        $transaction: transaction,
        fileObject: {
          findMany,
        },
      },
    }));
    jest.doMock("@/lib/storage", () => ({
      remove,
      StorageObjectNotFoundError: MockStorageObjectNotFoundError,
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

  it("deletes expired file objects and related jobs when storage deletes succeed", async () => {
    findMany.mockResolvedValueOnce([
      {
        expiresAt: new Date("2026-04-01T00:00:00.000Z"),
        id: "file-1",
        jobs: [
          {
            id: "job-1",
            outputRef: "outputs/job-1/result.pdf",
          },
        ],
        objectKey: "uploads/file-1.pdf",
      },
    ]);
    findMany.mockResolvedValueOnce([]);
    deleteJobMany.mockResolvedValue({ count: 1 });
    deleteFileObjectMany.mockResolvedValue({ count: 1 });

    const { deleteExpiredFileObjects } = await import(
      "@/server/cleanup/deleteExpired"
    );

    const result = await deleteExpiredFileObjects({
      batchSize: 10,
      now: new Date("2026-04-04T00:00:00.000Z"),
    });

    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenNthCalledWith(1, "uploads/file-1.pdf");
    expect(remove).toHaveBeenNthCalledWith(2, "outputs/job-1/result.pdf");
    expect(deleteJobMany).toHaveBeenCalledWith({
      where: {
        fileObjectId: "file-1",
      },
    });
    expect(deleteFileObjectMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          lte: new Date("2026-04-04T00:00:00.000Z"),
        },
        id: "file-1",
      },
    });
    expect(result).toEqual({
      batchesProcessed: 1,
      deletedJobs: 1,
      deletedObjects: 2,
      deletedRows: 1,
      failed: 0,
      scanned: 1,
      skippedMissingObjects: 0,
    });
  });

  it("treats missing storage objects as idempotent success and still deletes rows", async () => {
    findMany.mockResolvedValueOnce([
      {
        expiresAt: new Date("2026-04-01T00:00:00.000Z"),
        id: "file-2",
        jobs: [],
        objectKey: "uploads/file-2.pdf",
      },
    ]);
    findMany.mockResolvedValueOnce([]);
    remove.mockRejectedValueOnce(new MockStorageObjectNotFoundError("missing"));
    deleteJobMany.mockResolvedValue({ count: 0 });
    deleteFileObjectMany.mockResolvedValue({ count: 1 });

    const { deleteExpiredFileObjects } = await import(
      "@/server/cleanup/deleteExpired"
    );

    const result = await deleteExpiredFileObjects({
      batchSize: 10,
      now: new Date("2026-04-04T00:00:00.000Z"),
    });

    expect(transaction).toHaveBeenCalled();
    expect(result.skippedMissingObjects).toBe(1);
    expect(result.deletedRows).toBe(1);
  });

  it("does not delete database rows when storage deletion fails unexpectedly", async () => {
    findMany.mockResolvedValueOnce([
      {
        expiresAt: new Date("2026-04-01T00:00:00.000Z"),
        id: "file-3",
        jobs: [],
        objectKey: "uploads/file-3.pdf",
      },
    ]);
    findMany.mockResolvedValueOnce([]);
    remove.mockRejectedValueOnce(new Error("s3 unavailable"));

    const { deleteExpiredFileObjects } = await import(
      "@/server/cleanup/deleteExpired"
    );

    const result = await deleteExpiredFileObjects({
      batchSize: 10,
      now: new Date("2026-04-04T00:00:00.000Z"),
    });

    expect(transaction).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.deletedRows).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        fileObjectId: "file-3",
        storageKey: "uploads/file-3.pdf",
      }),
      "Failed to delete expired storage object"
    );
  });

  it("processes expired files in multiple batches and leaves unexpired rows untouched", async () => {
    findMany
      .mockResolvedValueOnce([
        {
          expiresAt: new Date("2026-04-01T00:00:00.000Z"),
          id: "file-4",
          jobs: [],
          objectKey: "uploads/file-4.pdf",
        },
        {
          expiresAt: new Date("2026-04-01T00:00:01.000Z"),
          id: "file-5",
          jobs: [],
          objectKey: "uploads/file-5.pdf",
        },
      ])
      .mockResolvedValueOnce([
        {
          expiresAt: new Date("2026-04-01T00:00:02.000Z"),
          id: "file-6",
          jobs: [],
          objectKey: "uploads/file-6.pdf",
        },
      ])
      .mockResolvedValueOnce([]);
    deleteJobMany.mockResolvedValue({ count: 0 });
    deleteFileObjectMany.mockResolvedValue({ count: 1 });

    const { deleteExpiredFileObjects } = await import(
      "@/server/cleanup/deleteExpired"
    );

    const result = await deleteExpiredFileObjects({
      batchSize: 2,
      now: new Date("2026-04-04T00:00:00.000Z"),
    });

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        take: 2,
        where: {
          expiresAt: {
            lte: new Date("2026-04-04T00:00:00.000Z"),
          },
          id: undefined,
        },
      })
    );
    expect(findMany.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          id: {
            notIn: ["file-4", "file-5"],
          },
        }),
      })
    );
    expect(result.batchesProcessed).toBe(2);
    expect(result.scanned).toBe(3);
    expect(result.deletedRows).toBe(3);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        batchNumber: 2,
        deletedRows: 3,
        scanned: 3,
      }),
      "Expired file cleanup batch summary"
    );
  });
});
