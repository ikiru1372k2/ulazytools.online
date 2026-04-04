describe("storage presign helpers", () => {
  const capturedGetInputs: unknown[] = [];

  beforeEach(() => {
    jest.resetModules();
    capturedGetInputs.length = 0;
    process.env.S3_ACCESS_KEY_ID = "test-access-key";
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_ENDPOINT = "http://localhost:9000";
    process.env.S3_FORCE_PATH_STYLE = "true";
    process.env.S3_REGION = "us-east-1";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.MAX_UPLOAD_MB = "10";
    process.env.PRESIGN_EXPIRES_SECONDS = "60";

    jest.doMock("@aws-sdk/client-s3", () => {
      class HeadObjectCommand {
        input: unknown;

        constructor(input: unknown) {
          this.input = input;
        }
      }

      class GetObjectCommand {
        input: unknown;

        constructor(input: unknown) {
          this.input = input;
          capturedGetInputs.push(input);
        }
      }

      class PutObjectCommand {
        input: unknown;

        constructor(input: unknown) {
          this.input = input;
        }
      }

      class S3Client {
        send = jest.fn(async (command: unknown) => {
          if (command instanceof HeadObjectCommand) {
            return {
              ContentLength: 1234,
              ETag: '"etag-123"',
            };
          }

          return {};
        });

        constructor(_input: unknown) {}
      }

      return {
        GetObjectCommand,
        HeadObjectCommand,
        PutObjectCommand,
        S3Client,
      };
    });

    jest.doMock("@aws-sdk/s3-request-presigner", () => ({
      getSignedUrl: jest.fn(async () => "https://example.com/upload"),
    }));
  });

  it("returns a PUT presign payload with content-type headers", async () => {
    const { presignPut } = await import("@/lib/storage");

    await expect(
      presignPut("uploads/test.pdf", "application/pdf", 60)
    ).resolves.toEqual({
      headers: {
        "Content-Type": "application/pdf",
      },
      uploadUrl: "https://example.com/upload",
    });
  });

  it("rejects a non-positive presign TTL", async () => {
    const { presignGet, presignPut } = await import("@/lib/storage");

    await expect(
      presignPut("uploads/test.pdf", "application/pdf", 0)
    ).rejects.toThrow(/finite positive ttlSeconds/i);
    await expect(presignGet("uploads/test.pdf", 0)).rejects.toThrow(
      /finite positive ttlSeconds/i
    );
  });

  it("returns a GET presign URL without overrides by default", async () => {
    const { presignGet } = await import("@/lib/storage");

    await expect(presignGet("outputs/test.pdf", 300)).resolves.toBe(
      "https://example.com/upload"
    );
    expect(capturedGetInputs).toContainEqual(
      expect.objectContaining({
        Bucket: "test-bucket",
        Key: "outputs/test.pdf",
        ResponseContentDisposition: undefined,
      })
    );
  });

  it("includes response content disposition when a filename override is supplied", async () => {
    const { presignGet } = await import("@/lib/storage");

    await expect(
      presignGet("outputs/test.pdf", 300, {
        responseContentDisposition: 'attachment; filename="Report.pdf"',
      })
    ).resolves.toBe("https://example.com/upload");
    expect(capturedGetInputs).toContainEqual(
      expect.objectContaining({
        Bucket: "test-bucket",
        Key: "outputs/test.pdf",
        ResponseContentDisposition: 'attachment; filename="Report.pdf"',
      })
    );
  });

  it("returns normalized metadata from HEAD object", async () => {
    const { getObjectMetadata } = await import("@/lib/storage");

    await expect(getObjectMetadata("uploads/test.pdf")).resolves.toEqual({
      etag: "etag-123",
      size: BigInt(1234),
    });
  });
});
