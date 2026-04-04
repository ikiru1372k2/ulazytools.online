import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getStorageEnv } from "@/lib/env";

const storageEnv = getStorageEnv();

type UploadBody = Buffer | Uint8Array;
type ObjectTags = Record<string, string>;

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

export type PresignedUploadResult = {
  headers: {
    "Content-Type": string;
  };
  uploadUrl: string;
};

export type PresignedGetOptions = {
  responseContentDisposition?: string;
};

export type PresignedPutOptions = {
  tags?: ObjectTags;
};

export type UploadBufferOptions = {
  tags?: ObjectTags;
};

export type StoredObject = {
  body: NonNullable<GetObjectCommandOutput["Body"]>;
  contentLength?: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
};

export type ObjectMetadata = {
  etag?: string;
  size?: bigint;
};

export class StorageObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Storage object "${key}" was not found`);
    this.name = "StorageObjectNotFoundError";
  }
}

function getStorageConfig(): StorageConfig {
  const endpoint = storageEnv.S3_ENDPOINT;
  const forcePathStyle = storageEnv.S3_FORCE_PATH_STYLE || Boolean(endpoint);

  return {
    bucket: storageEnv.S3_BUCKET,
    endpoint,
    forcePathStyle,
    region: storageEnv.S3_REGION,
  };
}

const storageConfig = getStorageConfig();

// MinIO is the default local target, but this stays AWS S3-compatible via env config.
const storageClient = new S3Client({
  credentials: {
    accessKeyId: storageEnv.S3_ACCESS_KEY_ID,
    secretAccessKey: storageEnv.S3_SECRET_ACCESS_KEY,
  },
  endpoint: storageConfig.endpoint,
  forcePathStyle: storageConfig.forcePathStyle,
  region: storageConfig.region,
});

function encodeTags(tags?: ObjectTags) {
  if (!tags) {
    return undefined;
  }

  const entries = Object.entries(tags)
    .map(([key, value]) => [key.trim(), value.trim()] as [string, string])
    .filter(([key, value]) => key && value);

  if (!entries.length) {
    return undefined;
  }

  return new URLSearchParams(entries).toString();
}

export async function uploadBuffer(
  key: string,
  body: UploadBody,
  contentType: string,
  options?: UploadBufferOptions
): Promise<UploadResult> {
  const response = await storageClient.send(
    new PutObjectCommand({
      Body: body,
      Bucket: storageConfig.bucket,
      ContentType: contentType,
      Key: key,
      // S3-compatible tag support is best-effort; some MinIO setups may not surface tags locally.
      Tagging: encodeTags(options?.tags),
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

export async function presignGet(
  key: string,
  ttlSeconds: number,
  options?: PresignedGetOptions
) {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("presignGet requires a finite positive ttlSeconds");
  }

  const expiresIn = Math.min(Math.floor(ttlSeconds), 7 * 24 * 60 * 60);

  return getSignedUrl(
    storageClient,
    new GetObjectCommand({
      Bucket: storageConfig.bucket,
      Key: key,
      ResponseContentDisposition: options?.responseContentDisposition,
    }),
    { expiresIn }
  );
}

export async function presignPut(
  key: string,
  contentType: string,
  ttlSeconds: number,
  options?: PresignedPutOptions
): Promise<PresignedUploadResult> {
  const normalizedContentType = contentType.trim();

  if (!normalizedContentType) {
    throw new Error("presignPut requires a non-empty contentType");
  }

  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("presignPut requires a finite positive ttlSeconds");
  }

  const expiresIn = Math.min(Math.floor(ttlSeconds), 7 * 24 * 60 * 60);
  const uploadUrl = await getSignedUrl(
    storageClient,
    new PutObjectCommand({
      Bucket: storageConfig.bucket,
      ContentType: normalizedContentType,
      Key: key,
      // S3-compatible tag support is best-effort; some MinIO setups may not surface tags locally.
      Tagging: encodeTags(options?.tags),
    }),
    { expiresIn }
  );

  return {
    headers: {
      "Content-Type": normalizedContentType,
    },
    uploadUrl,
  };
}

export function getStorageBucket() {
  return storageConfig.bucket;
}

function isNotFoundStorageError(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    ("name" in error || "$metadata" in error)
  ) {
    const maybeError = error as {
      $metadata?: { httpStatusCode?: number };
      name?: string;
    };

    return (
      maybeError.name === "NotFound" ||
      maybeError.name === "NoSuchKey" ||
      maybeError.$metadata?.httpStatusCode === 404
    );
  }

  return false;
}

export async function getObjectMetadata(key: string): Promise<ObjectMetadata> {
  try {
    const response = await storageClient.send(
      new HeadObjectCommand({
        Bucket: storageConfig.bucket,
        Key: key,
      })
    );

    return {
      etag: response.ETag?.replace(/"/g, ""),
      size:
        typeof response.ContentLength === "number"
          ? BigInt(response.ContentLength)
          : undefined,
    };
  } catch (error) {
    if (isNotFoundStorageError(error)) {
      throw new StorageObjectNotFoundError(key);
    }

    throw error;
  }
}

export async function remove(key: string) {
  try {
    await storageClient.send(
      new DeleteObjectCommand({
        Bucket: storageConfig.bucket,
        Key: key,
      })
    );
  } catch (error) {
    if (isNotFoundStorageError(error)) {
      throw new StorageObjectNotFoundError(key);
    }

    throw error;
  }
}

export async function exists(key: string) {
  try {
    await getObjectMetadata(key);
    return true;
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      return false;
    }
    throw error;
  }
}
