export {};

const info = jest.fn();
const warn = jest.fn();
const error = jest.fn();
const close = jest.fn();
const quit = jest.fn();
const disconnect = jest.fn();
const registerCleanupJob = jest.fn();
const deleteExpiredFileObjects = jest.fn();

let workerHandler: ((job: unknown) => Promise<unknown>) | undefined;

describe("cleanup worker", () => {
  beforeEach(() => {
    jest.resetModules();
    info.mockReset();
    warn.mockReset();
    error.mockReset();
    close.mockReset();
    quit.mockReset();
    disconnect.mockReset();
    registerCleanupJob.mockReset();
    deleteExpiredFileObjects.mockReset();
    workerHandler = undefined;

    registerCleanupJob.mockResolvedValue(undefined);
    deleteExpiredFileObjects.mockResolvedValue({
      batchesProcessed: 1,
      deletedJobs: 2,
      deletedObjects: 3,
      deletedRows: 1,
      failed: 0,
      scanned: 1,
      skippedMissingObjects: 0,
    });

    jest.doMock("@/lib/db", () => ({
      prisma: {
        $disconnect: disconnect,
      },
    }));
    jest.doMock("@/lib/queue", () => ({
      CLEANUP_JOB_NAME: "delete-expired-file-objects",
      CLEANUP_QUEUE_NAME: "cleanup-jobs",
      createRedisConnection: jest.fn(() => ({
        quit,
      })),
      registerCleanupJob,
    }));
    jest.doMock("@/server/cleanup/deleteExpired", () => ({
      deleteExpiredFileObjects,
    }));
    jest.doMock(
      "bullmq",
      () => ({
        Worker: jest.fn((_queueName, handler) => {
          workerHandler = handler;
          return {
            close,
            on: jest.fn(),
          };
        }),
      }),
      { virtual: true }
    );
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

  it("registers the repeatable cleanup job on startup", async () => {
    await import("@/workers/cleanupWorker");
    await Promise.resolve();

    expect(registerCleanupJob).toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      {
        jobName: "delete-expired-file-objects",
      },
      "Registered repeatable cleanup job"
    );
  });

  it("runs the cleanup handler and logs the batch summary", async () => {
    const { processCleanupJob } = await import("@/workers/cleanupWorker");

    const result = await processCleanupJob({} as never);

    expect(deleteExpiredFileObjects).toHaveBeenCalled();
    expect(result).toEqual({
      batchesProcessed: 1,
      deletedJobs: 2,
      deletedObjects: 3,
      deletedRows: 1,
      failed: 0,
      scanned: 1,
      skippedMissingObjects: 0,
    });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        batchesProcessed: 1,
        deletedJobs: 2,
        deletedObjects: 3,
        deletedRows: 1,
      }),
      "Completed expired file cleanup run"
    );
    expect(workerHandler).toBeDefined();
  });

  it("shuts down the worker when cleanup schedule registration fails", async () => {
    registerCleanupJob.mockRejectedValueOnce(new Error("redis unavailable"));

    await import("@/workers/cleanupWorker");
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        signal: "startup",
      }),
      "Cleanup worker cannot start safely"
    );
    expect(close).toHaveBeenCalled();
    expect(quit).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });
});
