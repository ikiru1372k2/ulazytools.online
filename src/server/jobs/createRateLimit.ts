import "server-only";

import { getRateLimitEnv } from "@/lib/env";
import {
  assertRateLimitAllowed,
  type RateLimitIdentity,
} from "@/server/rateLimit";

export type JobCreateRateLimitIdentity = {
  guestId?: string;
  ip?: string;
  userId?: string;
};

export async function assertJobCreateAllowed(
  identity: JobCreateRateLimitIdentity
) {
  const env = getRateLimitEnv();

  await assertRateLimitAllowed(
    {
      action: "job_create",
      limit: env.RATE_LIMIT_JOB_CREATE_LIMIT,
      windowSeconds: env.RATE_LIMIT_JOB_CREATE_WINDOW_SECONDS,
    },
    identity satisfies RateLimitIdentity
  );
}
