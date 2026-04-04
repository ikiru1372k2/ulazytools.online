export {};

const workerOn = jest.fn();
const workerClose = jest.fn();
const quit = jest.fn();
const processPdfJob = jest.fn();
const observeJobLatencyMs = jest.fn();
const incrementJobsFailedCount = jest.fn();
const updateMany = jest.fn();
const create = jest.fn();
const info = jest.fn();
const error = jest.fn();
const workerHandlers = new Map<string, (...args: unknown[]) => unknown>();

let capturedProcessor:
  | ((
      job: {
        data: { jobId: string; requestId?: string; type: "process" };
        id?: string;
        name: string;
      }
    ) => Promise<unknown>)
  | undefined;

describe("pdf worker metrics integration", () => {
  beforeEach(() => {
    jest.resetModules();
    workerOn.mockReset();
    workerClose.mockReset();
    quit.mockReset();
    processPdfJob.mockReset();
    observeJobLatencyMs.mockReset();
    incrementJobsFailedCount.mockReset();
    updateMany.mockReset();
    create.mockReset();
    info.mockReset();
    error.mockReset();
    capturedProcessor = undefined;
    workerHandlers.clear();

    updateMany.mockResolvedValue({ count: 1 });
    create.mockResolvedValue({});

    jest.doMock(
      "bullmq",
      () => ({
        Worker: jest.fn((_name, processor) => {
          capturedProcessor = processor;
          return {
            close: workerClose,
            on: jest.fn((event, handler) => {
              workerHandlers.set(event, handler);
              workerOn(event, handler);
            }),
          };
        }),
      }),
      { virtual: true }
    );
    jest.doMock("@/lib/queue", () => ({
      PDF_QUEUE_NAME: "pdf-jobs",
      createRedisConnection: jest.fn(() => ({
        quit,
      })),
    }));
    jest.doMock("@/lib/db", () => ({
      prisma: {
        $disconnect: jest.fn(),
        $transaction: jest.fn(async (callback) =>
          callback({
            job: {
              updateMany,
            },
            jobEvent: {
              create,
            },
          })
        ),
        job: {
          findUnique: jest.fn(),
        },
      },
    }));
    jest.doMock("@/server/jobs/processPdfJob", () => ({
      processPdfJob,
    }));
    jest.doMock("@/lib/metrics", () => ({
      incrementJobsFailedCount,
      observeJobLatencyMs,
    }));
    jest.doMock("@/lib/logger", () => ({
      createLogger: jest.fn(() => ({
        error,
        info,
      })),
    }));
  });

  it("records latency when a queue job reaches completed state", async () => {
    processPdfJob.mockResolvedValue({
      outputKey: "outputs/job-123/processed.pdf",
      userId: "user-123",
    });

    await import("@/workers/pdfWorker");

    await capturedProcessor?.({
      data: {
        jobId: "job-123",
        requestId: "req-123",
        type: "process",
      },
      id: "bull-1",
      name: "process",
    });

    const completedHandler = workerHandlers.get("completed");

    completedHandler?.({
      data: {
        jobId: "job-123",
        requestId: "req-123",
        type: "process",
      },
      finishedOn: 1750,
      id: "bull-1",
      name: "process",
      processedOn: 1000,
    });

    expect(observeJobLatencyMs).toHaveBeenCalledWith(750);
    expect(incrementJobsFailedCount).not.toHaveBeenCalled();
  });

  it("does not increment failed metrics for a retryable attempt failure", async () => {
    processPdfJob.mockRejectedValue(new Error("worker failure"));

    await import("@/workers/pdfWorker");

    await expect(
      capturedProcessor?.({
        data: {
          jobId: "job-123",
          requestId: "req-123",
          type: "process",
        },
        id: "bull-2",
        name: "process",
      })
    ).rejects.toThrow("worker failure");

    const failedHandler = workerHandlers.get("failed");

    failedHandler?.(
      {
        attemptsMade: 1,
        data: {
          jobId: "job-123",
          requestId: "req-123",
          type: "process",
        },
        finishedOn: 2600,
        id: "bull-2",
        name: "process",
        opts: {
          attempts: 3,
        },
        processedOn: 2000,
      },
      new Error("worker failure")
    );

    expect(incrementJobsFailedCount).not.toHaveBeenCalled();
    expect(observeJobLatencyMs).not.toHaveBeenCalled();
  });

  it("increments failed jobs and records latency on terminal failure", async () => {
    processPdfJob.mockRejectedValue(new Error("worker failure"));

    await import("@/workers/pdfWorker");

    await expect(
      capturedProcessor?.({
        data: {
          jobId: "job-123",
          requestId: "req-123",
          type: "process",
        },
        id: "bull-3",
        name: "process",
      })
    ).rejects.toThrow("worker failure");

    const failedHandler = workerHandlers.get("failed");

    failedHandler?.(
      {
        attemptsMade: 3,
        data: {
          jobId: "job-123",
          requestId: "req-123",
          type: "process",
        },
        finishedOn: 2600,
        id: "bull-3",
        name: "process",
        opts: {
          attempts: 3,
        },
        processedOn: 2000,
      },
      new Error("worker failure")
    );

    expect(incrementJobsFailedCount).toHaveBeenCalledTimes(1);
    expect(observeJobLatencyMs).toHaveBeenCalledWith(600);
  });
});
