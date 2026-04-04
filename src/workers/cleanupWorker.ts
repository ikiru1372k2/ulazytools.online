import { Worker, type Job as BullJob } from "bullmq";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import {
  CLEANUP_JOB_NAME,
  CLEANUP_QUEUE_NAME,
  createRedisConnection,
  registerCleanupJob,
  type CleanupJobPayload,
} from "@/lib/queue";
import { deleteExpiredFileObjects } from "@/server/cleanup/deleteExpired";

type ManagedResource = {
  close: () => Promise<unknown>;
  name: string;
};

const workerConnection = createRedisConnection();
let isShuttingDown = false;
const workerLogger = createLogger({
  queue: CLEANUP_QUEUE_NAME,
});

export async function processCleanupJob(_job: BullJob<CleanupJobPayload>) {
  const result = await deleteExpiredFileObjects();

  workerLogger.info(
    {
      batchesProcessed: result.batchesProcessed,
      deletedJobs: result.deletedJobs,
      deletedObjects: result.deletedObjects,
      deletedRows: result.deletedRows,
      failed: result.failed,
      scanned: result.scanned,
      skippedMissingObjects: result.skippedMissingObjects,
    },
    "Completed expired file cleanup run"
  );

  return result;
}

const worker = new Worker<CleanupJobPayload>(CLEANUP_QUEUE_NAME, processCleanupJob, {
  connection: workerConnection,
  concurrency: 1,
});

worker.on("ready", () => {
  workerLogger.info("Listening for cleanup jobs");
});

worker.on("failed", (job, error) => {
  workerLogger.error(
    {
      err: error,
      queueJobName: job?.name,
    },
    "Cleanup job failed"
  );
});

async function shutdown(resources: ManagedResource[], signal: string) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  workerLogger.info({ signal }, "Shutting down cleanup worker");

  for (const resource of resources) {
    try {
      await resource.close();
    } catch (error) {
      workerLogger.error(
        {
          err: error,
          resource: resource.name,
        },
        "Failed to close cleanup worker resource cleanly"
      );
    }
  }

  process.exit(0);
}

async function shutdownWithFailure(
  resources: ManagedResource[],
  signal: string,
  startupError: unknown
) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  workerLogger.error(
    {
      err: startupError,
      signal,
    },
    "Cleanup worker cannot start safely"
  );

  for (const resource of resources) {
    try {
      await resource.close();
    } catch (error) {
      workerLogger.error(
        {
          err: error,
          resource: resource.name,
        },
        "Failed to close cleanup worker resource cleanly"
      );
    }
  }

  if (process.env.NODE_ENV !== "test") {
    process.exit(1);
  }
}

function registerShutdown(resources: ManagedResource[]) {
  const handleSignal = (signal: string) => {
    void shutdown(resources, signal);
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
}

const managedResources: ManagedResource[] = [
  {
    name: "worker",
    close: () => worker.close(),
  },
  {
    name: "redis connection",
    close: () => workerConnection.quit(),
  },
  {
    name: "prisma",
    close: () => prisma.$disconnect(),
  },
];

registerShutdown(managedResources);

void registerCleanupJob()
  .then(() => {
    workerLogger.info(
      {
        jobName: CLEANUP_JOB_NAME,
      },
      "Registered repeatable cleanup job"
    );
  })
  .catch((error) => shutdownWithFailure(managedResources, "startup", error));
