import "server-only";

import { getRateLimitEnv } from "@/lib/env";
import {
  assertRateLimitAllowed,
  type RateLimitIdentity,
} from "@/server/rateLimit";

export type JobStatusRateLimitIdentity = {
  guestId?: string;
  ip?: string;
  userId?: string;
};

export async function assertJobStatusAllowed(
  identity: JobStatusRateLimitIdentity
) {
  const env = getRateLimitEnv();

  await assertRateLimitAllowed(
    {
      action: "job_status",
      limit: env.RATE_LIMIT_JOB_STATUS_LIMIT,
      windowSeconds: env.RATE_LIMIT_JOB_STATUS_WINDOW_SECONDS,
    },
    identity satisfies RateLimitIdentity
  );
}
