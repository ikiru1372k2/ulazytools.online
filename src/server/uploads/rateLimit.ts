import "server-only";

import { getRateLimitEnv } from "@/lib/env";
import {
  assertRateLimitAllowed,
  type RateLimitIdentity,
} from "@/server/rateLimit";

export type UploadRateLimitIdentity = {
  guestId?: string;
  ip?: string;
  userId?: string;
};

export async function assertUploadPresignAllowed(
  identity: UploadRateLimitIdentity
) {
  const env = getRateLimitEnv();

  await assertRateLimitAllowed(
    {
      action: "upload_presign",
      limit: env.RATE_LIMIT_UPLOAD_PRESIGN_LIMIT,
      windowSeconds: env.RATE_LIMIT_UPLOAD_PRESIGN_WINDOW_SECONDS,
    },
    identity satisfies RateLimitIdentity
  );
}
