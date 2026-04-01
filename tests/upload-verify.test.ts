describe("upload verification helpers", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.S3_ACCESS_KEY_ID = "test-access-key";
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_ENDPOINT = "http://localhost:9000";
    process.env.S3_FORCE_PATH_STYLE = "true";
    process.env.S3_REGION = "us-east-1";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";

    jest.doMock("@aws-sdk/client-s3", () => {
      class HeadObjectCommand {
        constructor(_input: unknown) {}
      }

      class S3Client {
        constructor(_input: unknown) {}
      }

      return {
        HeadObjectCommand,
        S3Client,
      };
    });

    jest.doMock("@aws-sdk/s3-request-presigner", () => ({
      getSignedUrl: jest.fn(),
    }));
  });

  it("normalizes quoted etags", async () => {
    const { normalizeEtag } = await import("@/server/uploads/verify");

    expect(normalizeEtag('"etag-123"')).toBe("etag-123");
  });

  it("throws for missing completion payload values", async () => {
    const { parseCompleteUploadInput } = await import("@/server/uploads/verify");

    expect(() =>
      parseCompleteUploadInput({
        etag: "",
        fileId: "",
      })
    ).toThrow(/missing fileId or etag/i);
  });
});
