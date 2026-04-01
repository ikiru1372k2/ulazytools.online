describe("storage presign helpers", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.S3_ACCESS_KEY_ID = "test-access-key";
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_ENDPOINT = "http://localhost:9000";
    process.env.S3_FORCE_PATH_STYLE = "true";
    process.env.S3_REGION = "us-east-1";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.MAX_UPLOAD_MB = "10";
    process.env.PRESIGN_EXPIRES_SECONDS = "60";

    jest.doMock("@aws-sdk/client-s3", () => {
      class PutObjectCommand {
        input: unknown;

        constructor(input: unknown) {
          this.input = input;
        }
      }

      class S3Client {
        constructor(_input: unknown) {}
      }

      return {
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
    const { presignPut } = await import("@/lib/storage");

    await expect(
      presignPut("uploads/test.pdf", "application/pdf", 0)
    ).rejects.toThrow(/finite positive ttlSeconds/i);
  });
});
