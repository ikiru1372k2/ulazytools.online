import "server-only";

import { createHash } from "crypto";

const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export type JobAccessContext = {
  guestId?: string;
  userId?: string;
};

export type JobStatusRecord = {
  completedAt: Date | null;
  createdAt: Date;
  errorCode: string | null;
  errorMessage: string | null;
  fileObject: {
    guestId: string | null;
  } | null;
  id: string;
  outputRef: string | null;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  updatedAt: Date;
  userId: string | null;
};

export type SafeJobProjection =
  | { status: "pending" }
  | { status: "processing" }
  | { downloadUrl: string; status: "done" }
  | { errorCode?: string; status: "failed" }
  | { status: "canceled" };

export function canAccessJob(
  job: Pick<JobStatusRecord, "fileObject" | "userId">,
  access: JobAccessContext
) {
  const isAuthorizedUser = Boolean(access.userId && job.userId === access.userId);
  const isAuthorizedGuest = Boolean(
    !job.userId &&
      access.guestId &&
      job.fileObject?.guestId &&
      job.fileObject.guestId === access.guestId
  );

  return isAuthorizedUser || isAuthorizedGuest;
}

export function isJobExpired(
  job: Pick<JobStatusRecord, "completedAt" | "status" | "updatedAt">,
  now = new Date()
) {
  if (job.status === "PENDING" || job.status === "RUNNING") {
    return false;
  }

  const referenceTime = job.completedAt ?? job.updatedAt;

  return now.getTime() - referenceTime.getTime() > JOB_RETENTION_MS;
}

export function buildJobStatusEtag(
  job: Pick<JobStatusRecord, "errorCode" | "id" | "outputRef" | "status" | "updatedAt">
) {
  const raw = [
    job.id,
    job.status,
    job.updatedAt.toISOString(),
    job.outputRef ?? "",
    job.errorCode ?? "",
  ].join(":");

  return `"${createHash("sha1").update(raw).digest("hex")}"`;
}

export async function toSafeJobProjection(
  job: JobStatusRecord
): Promise<SafeJobProjection> {
  switch (job.status) {
    case "PENDING":
      return { status: "pending" };
    case "RUNNING":
      return { status: "processing" };
    case "FAILED":
        return {
          errorCode: job.errorCode ?? undefined,
          status: "failed",
        };
    case "CANCELED":
      return { status: "canceled" };
    case "SUCCEEDED":
      if (!job.outputRef) {
        throw new Error(`Job "${job.id}" is missing outputRef`);
      }

      const { presignGet } = await import("@/lib/storage");

      return {
        downloadUrl: await presignGet(job.outputRef, DOWNLOAD_URL_TTL_SECONDS),
        status: "done",
      };
  }
}

export { DOWNLOAD_URL_TTL_SECONDS, JOB_RETENTION_MS };
