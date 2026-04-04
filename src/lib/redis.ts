import "server-only";

import IORedis, { type RedisOptions } from "ioredis";

import { getQueueEnv } from "@/lib/env";

const globalForRedis = globalThis as typeof globalThis & {
  apiRedis?: IORedis;
};

export function getRedisOptions(): RedisOptions {
  return {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  };
}

export function getRedisUrl() {
  return getQueueEnv().REDIS_URL;
}

export function createRedisClient() {
  return new IORedis(getRedisUrl(), getRedisOptions());
}

export function getSharedRedis() {
  if (!globalForRedis.apiRedis) {
    globalForRedis.apiRedis = createRedisClient();
  }

  return globalForRedis.apiRedis;
}
