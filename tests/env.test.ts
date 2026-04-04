describe("server env schema", () => {
  const originalEnv = process.env;

  function buildBaseEnv() {
    return {
      ...originalEnv,
      AUTH_GOOGLE_ID: "test-google-client-id",
      AUTH_GOOGLE_SECRET: "test-google-client-secret",
      AUTH_SECRET: "test-auth-secret",
      GUEST_COOKIE_SECRET: "test-guest-cookie-secret",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/ulazytools",
      DIRECT_URL: "postgresql://user:pass@localhost:5432/ulazytools",
      NODE_ENV: "test",
      REDIS_URL: "redis://localhost:6379",
      MAX_UPLOAD_MB: "10",
      PRESIGN_EXPIRES_SECONDS: "60",
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_BUCKET: "test-bucket",
      S3_ENDPOINT: "http://localhost:9000",
      S3_FORCE_PATH_STYLE: "true",
      S3_REGION: "us-east-1",
      S3_SECRET_ACCESS_KEY: "test-secret-key",
    };
  }

  beforeEach(() => {
    jest.resetModules();
    process.env = buildBaseEnv() as NodeJS.ProcessEnv;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("parses the scoped env shapes", async () => {
    const { getAuthEnv, getGuestEnv, getQueueEnv, getStorageEnv, getUploadEnv } =
      await import("@/lib/env");

    expect(getAuthEnv().AUTH_GOOGLE_ID).toBe("test-google-client-id");
    expect(getGuestEnv().GUEST_COOKIE_SECRET).toBe("test-guest-cookie-secret");
    expect(getQueueEnv().REDIS_URL).toBe("redis://localhost:6379");
    expect(getStorageEnv().S3_FORCE_PATH_STYLE).toBe(true);
    expect(getUploadEnv().MAX_UPLOAD_MB).toBe(10);
  });

  it("normalizes optional URLs and boolean false values", async () => {
    process.env = {
      ...buildBaseEnv(),
      AUTH_URL: "",
      NEXTAUTH_URL: "",
      S3_ENDPOINT: "",
      S3_FORCE_PATH_STYLE: "false",
    } as NodeJS.ProcessEnv;

    const { getAuthEnv, getStorageEnv, getUploadEnv } =
      await import("@/lib/env");

    expect(getAuthEnv().AUTH_URL).toBeUndefined();
    expect(getStorageEnv().S3_ENDPOINT).toBeUndefined();
    expect(getStorageEnv().S3_FORCE_PATH_STYLE).toBe(false);
    expect(getUploadEnv().PRESIGN_EXPIRES_SECONDS).toBe(60);
  });

  it("supports NEXTAUTH secret aliasing", async () => {
    process.env = {
      ...buildBaseEnv(),
      AUTH_SECRET: undefined,
      NEXTAUTH_SECRET: "legacy-nextauth-secret",
    } as NodeJS.ProcessEnv;

    const { getAuthEnv } = await import("@/lib/env");

    expect(getAuthEnv().AUTH_SECRET).toBe("legacy-nextauth-secret");
  });

  it("throws a readable error when a required storage env is missing", async () => {
    delete process.env.S3_BUCKET;

    const { getStorageEnv } = await import("@/lib/env");

    expect(() => getStorageEnv()).toThrow(/invalid storage environment configuration/i);
    expect(() => getStorageEnv()).toThrow(/S3_BUCKET/i);
  });

  it("does not require auth vars for queue and storage access", async () => {
    delete process.env.AUTH_GOOGLE_ID;
    delete process.env.AUTH_GOOGLE_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;

    const { getAuthEnv, getGuestEnv, getQueueEnv, getStorageEnv } = await import("@/lib/env");

    expect(getQueueEnv().REDIS_URL).toBe("redis://localhost:6379");
    expect(getStorageEnv().S3_BUCKET).toBe("test-bucket");
    expect(getGuestEnv().GUEST_COOKIE_SECRET).toBe("test-guest-cookie-secret");
    expect(() => getAuthEnv()).toThrow(/invalid auth environment configuration/i);
  });
});
