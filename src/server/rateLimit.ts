import "server-only";

import { createLogger } from "@/lib/logger";
import { getSharedRedis } from "@/lib/redis";

export type RateLimitAction =
  | "job_create"
  | "job_status"
  | "upload_presign";

export type RateLimitIdentity = {
  guestId?: string;
  ip?: string;
  userId?: string;
};

export type RateLimitPolicy = {
  action: RateLimitAction;
  limit: number;
  windowSeconds: number;
};

export class RateLimitExceededError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("RATE_LIMITED");
    this.name = "RateLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isRedisAvailabilityError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /redis unavailable|connect|connection|socket|econn|timeout|read only|connection is closed|stream isn't writeable/i.test(
    error.message
  );
}

function normalizeIdentityPart(value?: string) {
  const normalized = value?.trim();
  return Buffer.from(normalized ? normalized : "none", "utf8").toString(
    "base64url"
  );
}

export function buildRateLimitKey(
  policy: Pick<RateLimitPolicy, "action">,
  identity: RateLimitIdentity
) {
  const actorType = identity.userId
    ? "user"
    : identity.guestId
      ? "guest"
      : "ip";
  const actorId = identity.userId ?? identity.guestId ?? identity.ip ?? "anonymous";

  return [
    "rate_limit",
    policy.action,
    actorType,
    normalizeIdentityPart(actorId),
    normalizeIdentityPart(identity.ip),
  ].join(":");
}

export async function assertRateLimitAllowed(
  policy: RateLimitPolicy,
  identity: RateLimitIdentity
) {
  const log = createLogger({
    requestId: undefined,
    userId: identity.userId ?? null,
  });
  const key = buildRateLimitKey(policy, identity);

  try {
    const redis = getSharedRedis();
    const results = await redis
      .multi()
      .incr(key)
      .expire(key, policy.windowSeconds, "NX")
      .pttl(key)
      .exec();

    if (
      !results ||
      results.length !== 3 ||
      results.some(([commandError]) => Boolean(commandError))
    ) {
      throw new Error("Rate limiter Redis transaction failed");
    }

    const count = Number(results[0][1]);
    const ttlMilliseconds = Number(results[2][1]);

    if (!Number.isFinite(count) || !Number.isFinite(ttlMilliseconds)) {
      throw new Error("Rate limiter Redis transaction returned invalid values");
    }

    if (count > policy.limit) {
      throw new RateLimitExceededError(
        ttlMilliseconds > 0
          ? Math.max(1, Math.ceil(ttlMilliseconds / 1000))
          : policy.windowSeconds
      );
    }
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      throw error;
    }

    if (!isRedisAvailabilityError(error)) {
      throw error;
    }

    log.warn(
      {
        action: policy.action,
        actorType: identity.userId
          ? "user"
          : identity.guestId
            ? "guest"
            : "ip",
        hasIp: Boolean(identity.ip),
      },
      "Rate limiter unavailable, allowing request"
    );
  }
}
