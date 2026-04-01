describe("logger helpers", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock(
      "pino",
      () => {
        const instance = {
          child: jest.fn(),
          info: jest.fn(),
        };
        instance.child.mockReturnValue(instance);
        const pino = jest.fn(() => instance);
        return { __esModule: true, default: pino };
      },
      { virtual: true }
    );
  });

  it("exports the expected redact paths", async () => {
    const { LOGGER_REDACT_PATHS } = await import("@/lib/logger");

    expect(LOGGER_REDACT_PATHS).toEqual(
      expect.arrayContaining([
        "req.headers.authorization",
        "req.headers.cookie",
        "body.password",
        "presignedUrl",
      ])
    );
  });

  it("normalizes request IDs by trimming and dropping blanks", async () => {
    const { normalizeRequestId } = await import("@/lib/request-id");

    expect(normalizeRequestId("  abc-123  ")).toBe("abc-123");
    expect(normalizeRequestId("   ")).toBeUndefined();
    expect(normalizeRequestId(undefined)).toBeUndefined();
  });
});
