import "server-only";

import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const optionalUrl = z
  .union([z.string().trim().url(), z.literal(""), z.undefined()])
  .transform((value) => (value ? value : undefined));

const booleanString = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((value) => value === true || value === "true");

function formatZodErrors(error: z.ZodError) {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".") || "unknown";
      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
}

function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  label: string,
  source: unknown = process.env
): z.infer<T> {
  const result = schema.safeParse(source);

  if (!result.success) {
    throw new Error(
      `Invalid ${label} environment configuration:\n${formatZodErrors(
        result.error
      )}`
    );
  }

  return result.data;
}

const appEnvSchema = z.object({
  DATABASE_URL: nonEmptyString,
  DIRECT_URL: nonEmptyString,
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .optional()
    .default("development"),
});

const queueEnvSchema = z.object({
  CLEANUP_BATCH_SIZE: z.coerce.number().int().positive(),
  CLEANUP_REPEAT_EVERY_MS: z.coerce.number().int().positive(),
  REDIS_URL: nonEmptyString,
});

const retentionEnvSchema = z.object({
  FILE_RETENTION_HOURS: z.coerce.number().int().positive(),
});

const rateLimitEnvSchema = z.object({
  RATE_LIMIT_JOB_STATUS_LIMIT: z.coerce.number().int().positive(),
  RATE_LIMIT_JOB_STATUS_WINDOW_SECONDS: z.coerce.number().int().positive(),
  RATE_LIMIT_UPLOAD_PRESIGN_LIMIT: z.coerce.number().int().positive(),
  RATE_LIMIT_UPLOAD_PRESIGN_WINDOW_SECONDS: z.coerce.number()
    .int()
    .positive(),
});

const storageEnvSchema = z.object({
  S3_ACCESS_KEY_ID: nonEmptyString,
  S3_BUCKET: nonEmptyString,
  S3_ENDPOINT: optionalUrl,
  S3_FORCE_PATH_STYLE: booleanString.default(false),
  S3_REGION: nonEmptyString,
  S3_SECRET_ACCESS_KEY: nonEmptyString,
});

const uploadEnvSchema = z.object({
  MAX_UPLOAD_MB: z.coerce.number().positive(),
  PRESIGN_EXPIRES_SECONDS: z.coerce.number().int().positive(),
});

const guestEnvSchema = z.object({
  GUEST_COOKIE_SECRET: nonEmptyString,
});

const authEnvSchema = z.object({
  authGoogleId: nonEmptyString,
  authGoogleSecret: nonEmptyString,
  authSecret: nonEmptyString,
  authUrl: optionalUrl,
});

type AppEnv = z.infer<typeof appEnvSchema>;
type QueueEnv = z.infer<typeof queueEnvSchema>;
type RetentionEnv = z.infer<typeof retentionEnvSchema>;
type RateLimitEnv = z.infer<typeof rateLimitEnvSchema>;
type StorageEnv = z.infer<typeof storageEnvSchema>;
type UploadEnv = z.infer<typeof uploadEnvSchema>;
type GuestEnv = z.infer<typeof guestEnvSchema>;
type AuthEnv = {
  AUTH_GOOGLE_ID: string;
  AUTH_GOOGLE_SECRET: string;
  AUTH_SECRET: string;
  AUTH_URL?: string;
  NEXTAUTH_SECRET?: string;
  NEXTAUTH_URL?: string;
};

let appEnvCache: AppEnv | undefined;
let queueEnvCache: QueueEnv | undefined;
let retentionEnvCache: RetentionEnv | undefined;
let rateLimitEnvCache: RateLimitEnv | undefined;
let storageEnvCache: StorageEnv | undefined;
let uploadEnvCache: UploadEnv | undefined;
let guestEnvCache: GuestEnv | undefined;
let authEnvCache: AuthEnv | undefined;

export function getAppEnv() {
  appEnvCache ??= parseEnv(appEnvSchema, "app");
  return appEnvCache;
}

export function getQueueEnv() {
  queueEnvCache ??= parseEnv(queueEnvSchema, "queue");
  return queueEnvCache;
}

export function getRetentionEnv() {
  retentionEnvCache ??= parseEnv(retentionEnvSchema, "retention");
  return retentionEnvCache;
}

export function getRateLimitEnv() {
  rateLimitEnvCache ??= parseEnv(rateLimitEnvSchema, "rate limit");
  return rateLimitEnvCache;
}

export function getStorageEnv() {
  storageEnvCache ??= parseEnv(storageEnvSchema, "storage");
  return storageEnvCache;
}

export function getUploadEnv() {
  uploadEnvCache ??= parseEnv(uploadEnvSchema, "upload");
  return uploadEnvCache;
}

export function getGuestEnv() {
  guestEnvCache ??= parseEnv(guestEnvSchema, "guest");
  return guestEnvCache;
}

export function getAuthEnv() {
  if (authEnvCache) {
    return authEnvCache;
  }

  const normalizedAuthEnv = {
    authGoogleId: process.env.AUTH_GOOGLE_ID,
    authGoogleSecret: process.env.AUTH_GOOGLE_SECRET,
    authSecret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    authUrl: process.env.AUTH_URL ?? process.env.NEXTAUTH_URL,
  };

  const normalizedParsed = parseEnv(authEnvSchema, "auth", normalizedAuthEnv);

  authEnvCache = {
    AUTH_GOOGLE_ID: normalizedParsed.authGoogleId,
    AUTH_GOOGLE_SECRET: normalizedParsed.authGoogleSecret,
    AUTH_SECRET: normalizedParsed.authSecret,
    AUTH_URL: normalizedParsed.authUrl,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET?.trim() || undefined,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL?.trim() || undefined,
  };

  return authEnvCache;
}

export type {
  AppEnv,
  AuthEnv,
  GuestEnv,
  QueueEnv,
  RateLimitEnv,
  RetentionEnv,
  StorageEnv,
  UploadEnv,
};
