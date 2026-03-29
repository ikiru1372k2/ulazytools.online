import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type UploadBody = Buffer | Uint8Array;

type StorageConfig = {
  bucket: string;
  endpoint?: string;
  forcePathStyle: boolean;
  region: string;
};

export type UploadResult = {
  bucket: string;
  contentType: string;
  etag?: string;
  key: string;
  size: number;
};

export type StoredObject = {
  body: NonNullable<GetObjectCommandOutput["Body"]>;
  contentLength?: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
};

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required storage environment variable: ${name}`);
  }

  return value;
}

function getStorageConfig(): StorageConfig {
  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  const forcePathStyle =
    process.env.S3_FORCE_PATH_STYLE === "true" || Boolean(endpoint);

  return {
    bucket: getRequiredEnv("S3_BUCKET"),
    endpoint,
    forcePathStyle,
    region: getRequiredEnv("S3_REGION"),
  };
}

const storageConfig = getStorageConfig();

// MinIO is the default local target, but this stays AWS S3-compatible via env config.
const storageClient = new S3Client({
  credentials: {
    accessKeyId: getRequiredEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: getRequiredEnv("S3_SECRET_ACCESS_KEY"),
  },
  endpoint: storageConfig.endpoint,
  forcePathStyle: storageConfig.forcePathStyle,
  region: storageConfig.region,
});

function getMonth(date: Date) {
  return String(date.getUTCMonth() + 1).padStart(2, "0");
}

function sanitizeFilename(filename: string) {
  const trimmed = filename.trim().toLowerCase();

  if (!trimmed) {
    return "payload.bin";
  }

  const safe = trimmed
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return safe || "payload.bin";
}

function sanitizeJobId(jobId: string) {
  const trimmed = jobId.trim();

  if (!trimmed) {
    throw new Error("buildUploadKey requires a non-empty jobId");
  }

  const safe = trimmed
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!safe) {
    throw new Error("buildUploadKey requires a safe jobId");
  }

  return safe;
}

export function buildUploadKey(
  jobId: string,
  filename?: string,
  date = new Date()
) {
  const normalizedJobId = sanitizeJobId(jobId);
  const year = String(date.getUTCFullYear());
  const month = getMonth(date);
  const objectName = sanitizeFilename(filename ?? "payload.bin");

  return `uploads/${year}/${month}/${normalizedJobId}/${objectName}`;
}

export async function uploadBuffer(
  key: string,
  body: UploadBody,
  contentType: string
): Promise<UploadResult> {
  const response = await storageClient.send(
    new PutObjectCommand({
      Body: body,
      Bucket: storageConfig.bucket,
      ContentType: contentType,
      Key: key,
    })
  );

  return {
    bucket: storageConfig.bucket,
    contentType,
    etag: response.ETag,
    key,
    size: body.byteLength,
  };
}

export async function getObjectStream(key: string): Promise<StoredObject> {
  const response = await storageClient.send(
    new GetObjectCommand({
      Bucket: storageConfig.bucket,
      Key: key,
    })
  );

  if (!response.Body) {
    throw new Error(`Storage object "${key}" returned no body`);
  }

  return {
    body: response.Body,
    contentLength: response.ContentLength,
    contentType: response.ContentType,
    etag: response.ETag,
    lastModified: response.LastModified,
  };
}

export async function presignGet(key: string, ttlSeconds: number) {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("presignGet requires a finite positive ttlSeconds");
  }

  const expiresIn = Math.min(Math.floor(ttlSeconds), 7 * 24 * 60 * 60);

  return getSignedUrl(
    storageClient,
    new GetObjectCommand({
      Bucket: storageConfig.bucket,
      Key: key,
    }),
    { expiresIn }
  );
}

export async function remove(key: string) {
  await storageClient.send(
    new DeleteObjectCommand({
      Bucket: storageConfig.bucket,
      Key: key,
    })
  );
}

export async function exists(key: string) {
  try {
    await storageClient.send(
      new HeadObjectCommand({
        Bucket: storageConfig.bucket,
        Key: key,
      })
    );
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      ("name" in error || "$metadata" in error)
    ) {
      const maybeError = error as {
        $metadata?: { httpStatusCode?: number };
        name?: string;
      };

      if (
        maybeError.name === "NotFound" ||
        maybeError.name === "NoSuchKey" ||
        maybeError.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
    }

    throw error;
  }
}
