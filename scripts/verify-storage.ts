import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  buildUploadKey,
  exists,
  getObjectStream,
  presignGet,
  remove,
  uploadBuffer,
} from "../src/lib/storage-core";

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function createSdkClient() {
  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;

  return new S3Client({
    credentials: {
      accessKeyId: getRequiredEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: getRequiredEnv("S3_SECRET_ACCESS_KEY"),
    },
    endpoint,
    forcePathStyle:
      process.env.S3_FORCE_PATH_STYLE === "true" || Boolean(endpoint),
    region: getRequiredEnv("S3_REGION"),
  });
}

async function ensureBucket(client: S3Client, bucket: string) {
  if (!process.env.S3_ENDPOINT?.trim()) {
    return;
  }

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    throw new Error("Expected storage body to exist");
  }

  if (
    typeof body === "object" &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];

    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported storage body type");
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const bucket = getRequiredEnv("S3_BUCKET");
  const client = createSdkClient();

  await ensureBucket(client, bucket);

  const payload = Buffer.from(
    `ulazytools-storage-roundtrip:${new Date().toISOString()}`,
    "utf8"
  );
  const expectedDigest = sha256(payload);
  const jobId = `storage-smoke-${Date.now()}`;
  const key = buildUploadKey(jobId, "roundtrip.txt");

  console.log(`Uploading to ${bucket}/${key}`);
  await uploadBuffer(key, payload, "text/plain; charset=utf-8");

  const storedObject = await getObjectStream(key);
  const roundtrip = await bodyToBuffer(storedObject.body);

  if (sha256(roundtrip) !== expectedDigest) {
    throw new Error("Stream roundtrip digest mismatch");
  }

  const presignedUrl = await presignGet(key, 3);
  const presignedResponse = await fetch(presignedUrl);

  if (!presignedResponse.ok) {
    throw new Error(
      `Presigned GET failed before expiry with status ${presignedResponse.status}`
    );
  }

  const presignedPayload = Buffer.from(await presignedResponse.arrayBuffer());
  if (sha256(presignedPayload) !== expectedDigest) {
    throw new Error("Presigned GET digest mismatch");
  }

  await sleep(4000);

  const expiredResponse = await fetch(presignedUrl);
  if (expiredResponse.ok) {
    throw new Error("Presigned GET still succeeded after TTL expiry");
  }

  await remove(key);

  if (await exists(key)) {
    throw new Error("Object still exists after remove()");
  }

  console.log("Storage verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
