describe("presign policy", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.MAX_UPLOAD_MB = "10";
    process.env.PRESIGN_EXPIRES_SECONDS = "60";
  });

  it("accepts a valid PDF upload request", async () => {
    const { parsePresignUploadInput, validateUpload } = await import(
      "@/server/uploads/presignPolicy"
    );

    const parsed = parsePresignUploadInput({
      contentType: "application/pdf",
      filename: "report.pdf",
      sizeBytes: 1024,
    });

    expect(() => validateUpload(parsed)).not.toThrow();
  });

  it("rejects non-PDF uploads", async () => {
    const { parsePresignUploadInput, validateUpload } = await import(
      "@/server/uploads/presignPolicy"
    );

    const parsed = parsePresignUploadInput({
      contentType: "image/png",
      filename: "image.png",
      sizeBytes: 1024,
    });

    expect(() => validateUpload(parsed)).toThrow(/only pdf uploads/i);
  });

  it("rejects oversized uploads", async () => {
    const { parsePresignUploadInput, validateUpload } = await import(
      "@/server/uploads/presignPolicy"
    );

    const parsed = parsePresignUploadInput({
      contentType: "application/pdf",
      filename: "large.pdf",
      sizeBytes: 11 * 1024 * 1024,
    });

    expect(() => validateUpload(parsed)).toThrow(/10MB upload limit/i);
  });
});
