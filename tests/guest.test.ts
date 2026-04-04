describe("guest session helpers", () => {
  const originalEnv = process.env;
  const originalCrypto = globalThis.crypto;

  beforeEach(() => {
    jest.resetModules();
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: require("crypto").webcrypto,
    });
    process.env = {
      ...originalEnv,
      GUEST_COOKIE_SECRET: "test-guest-cookie-secret",
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv;
  });

  afterAll(() => {
    process.env = originalEnv;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  });

  it("reuses an existing valid signed guest ID", async () => {
    const { resolveGuestSession, serializeGuestCookie } = await import(
      "@/lib/guest"
    );
    const signedValue = await serializeGuestCookie(
      "00000000-0000-4000-8000-000000000123"
    );

    await expect(resolveGuestSession(signedValue)).resolves.toEqual({
      guestId: "00000000-0000-4000-8000-000000000123",
      isNew: false,
      shouldSetCookie: false,
    });
  });

  it("generates a new guest ID when one does not exist", async () => {
    const { resolveGuestSession } = await import("@/lib/guest");

    const session = await resolveGuestSession(undefined);

    expect(session.isNew).toBe(true);
    expect(session.shouldSetCookie).toBe(true);
    expect(session.guestId).toBeTruthy();
  });

  it("rotates to a new guest ID when the cookie is tampered", async () => {
    const { resolveGuestSession, serializeGuestCookie } = await import(
      "@/lib/guest"
    );
    const signedValue = await serializeGuestCookie(
      "00000000-0000-4000-8000-000000000123"
    );
    const tamperedValue = signedValue.replace(
      "00000000-0000-4000-8000-000000000123",
      "00000000-0000-4000-8000-000000000999"
    );

    const session = await resolveGuestSession(tamperedValue);

    expect(session.isNew).toBe(true);
    expect(session.shouldSetCookie).toBe(true);
    expect(session.guestId).not.toBe("00000000-0000-4000-8000-000000000123");
  });

  it("rejects non-UUID guest IDs even if they look signed", async () => {
    const { verifyGuestCookieValue } = await import("@/lib/guest");

    await expect(
      verifyGuestCookieValue("not-a-uuid.deadbeef")
    ).resolves.toBeNull();
  });

  it("throws when attempting to sign a non-UUID guest ID", async () => {
    const { serializeGuestCookie } = await import("@/lib/guest");

    await expect(serializeGuestCookie("not-a-uuid")).rejects.toThrow(
      /uuid v4/i
    );
  });

  it("returns secure cookie options in production", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv;

    const { getGuestCookieOptions } = await import("@/lib/guest");

    expect(getGuestCookieOptions()).toEqual(
      expect.objectContaining({
        httpOnly: true,
        secure: true,
      })
    );
  });

  it("returns non-secure cookie options outside production", async () => {
    const { getGuestCookieOptions } = await import("@/lib/guest");

    expect(getGuestCookieOptions()).toEqual(
      expect.objectContaining({
        httpOnly: true,
        secure: false,
      })
    );
  });
});
