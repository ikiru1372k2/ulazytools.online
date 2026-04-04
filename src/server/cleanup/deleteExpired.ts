import "server-only";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { getQueueEnv } from "@/lib/env";
import { remove, StorageObjectNotFoundError } from "@/lib/storage";

export type DeleteExpiredFileObjectsOptions = {
  batchSize?: number;
  now?: Date;
};

export type DeleteExpiredFileObjectsResult = {
  batchesProcessed: number;
  deletedJobs: number;
  deletedObjects: number;
  deletedRows: number;
  failed: number;
  scanned: number;
  skippedMissingObjects: number;
};

type ExpiredFileObjectRecord = {
  expiresAt: Date | null;
  id: string;
  jobs: Array<{
    id: string;
    outputRef: string | null;
  }>;
  objectKey: string;
};

function dedupeKeys(keys: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      keys
        .map((key) => key?.trim())
        .filter((key): key is string => Boolean(key))
    )
  );
}

export async function deleteExpiredFileObjects(
  options: DeleteExpiredFileObjectsOptions = {}
): Promise<DeleteExpiredFileObjectsResult> {
  const queueEnv = getQueueEnv();
  const batchSize = options.batchSize ?? queueEnv.CLEANUP_BATCH_SIZE;
  const now = options.now ?? new Date();
  const log = createLogger();
  const attemptedIds = new Set<string>();
  const result: DeleteExpiredFileObjectsResult = {
    batchesProcessed: 0,
    deletedJobs: 0,
    deletedObjects: 0,
    deletedRows: 0,
    failed: 0,
    scanned: 0,
    skippedMissingObjects: 0,
  };

  while (true) {
    const expiredFileObjects = (await prisma.fileObject.findMany({
      orderBy: [
        {
          expiresAt: "asc",
        },
        {
          id: "asc",
        },
      ],
      select: {
        expiresAt: true,
        id: true,
        jobs: {
          select: {
            id: true,
            outputRef: true,
          },
        },
        objectKey: true,
      },
      take: batchSize,
      where: {
        expiresAt: {
          lte: now,
        },
        id: attemptedIds.size
          ? {
              notIn: Array.from(attemptedIds),
            }
          : undefined,
      },
    })) as ExpiredFileObjectRecord[];

    if (!expiredFileObjects.length) {
      break;
    }

    result.batchesProcessed += 1;
    result.scanned += expiredFileObjects.length;

    for (const fileObject of expiredFileObjects) {
      attemptedIds.add(fileObject.id);

      const keysToDelete = dedupeKeys([
        fileObject.objectKey,
        ...fileObject.jobs.map((job) => job.outputRef),
      ]);
      let canDeleteRows = true;

      for (const storageKey of keysToDelete) {
        try {
          await remove(storageKey);
          result.deletedObjects += 1;
        } catch (error) {
          if (error instanceof StorageObjectNotFoundError) {
            result.skippedMissingObjects += 1;
            continue;
          }

          canDeleteRows = false;
          result.failed += 1;
          log.warn(
            {
              err: error,
              fileObjectId: fileObject.id,
              storageKey,
            },
            "Failed to delete expired storage object"
          );
          break;
        }
      }

      if (!canDeleteRows) {
        continue;
      }

      const deletedJobs = await prisma.$transaction(async (tx) => {
        const deletedJobResult = await tx.job.deleteMany({
          where: {
            fileObjectId: fileObject.id,
          },
        });

        const deletedFileObjectResult = await tx.fileObject.deleteMany({
          where: {
            expiresAt: {
              lte: now,
            },
            id: fileObject.id,
          },
        });

        return {
          deletedFileObjects: deletedFileObjectResult.count,
          deletedJobs: deletedJobResult.count,
        };
      });

      result.deletedJobs += deletedJobs.deletedJobs;
      result.deletedRows += deletedJobs.deletedFileObjects;
    }

    log.info(
      {
        batchNumber: result.batchesProcessed,
        deletedJobs: result.deletedJobs,
        deletedObjects: result.deletedObjects,
        deletedRows: result.deletedRows,
        failed: result.failed,
        scanned: result.scanned,
        skippedMissingObjects: result.skippedMissingObjects,
      },
      "Expired file cleanup batch summary"
    );

    if (expiredFileObjects.length < batchSize) {
      break;
    }
  }

  return result;
}
