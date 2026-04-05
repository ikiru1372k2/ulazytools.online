describe("shared rate limiter", () => {
  const warn = jest.fn();
  const multi = jest.fn();
  const incr = jest.fn();
  const expire = jest.fn();
  const pttl = jest.fn();
  const exec = jest.fn();
  const getSharedRedis = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    warn.mockReset();
    multi.mockReset();
    incr.mockReset();
    expire.mockReset();
    pttl.mockReset();
    exec.mockReset();
    getSharedRedis.mockReset();

    incr.mockReturnValue({ expire, pttl, exec });
    expire.mockReturnValue({ pttl, exec });
    pttl.mockReturnValue({ exec });
    multi.mockReturnValue({ incr, expire, pttl, exec });
    getSharedRedis.mockReturnValue({ multi });

    jest.doMock("@/lib/redis", () => ({
      getSharedRedis,
    }));
    jest.doMock("@/lib/logger", () => ({
      createLogger: jest.fn(() => ({
        warn,
      })),
    }));
  });

  it("builds deterministic keys per action and identity", async () => {
    const { buildRateLimitKey } = await import("@/server/rateLimit");

    expect(
      buildRateLimitKey(
        { action: "job_create" },
        {
          ip: "203.0.113.10",
          userId: "user-123",
        }
      )
    ).toBe("rate_limit:job_create:user:dXNlci0xMjM:MjAzLjAuMTEzLjEw");
    expect(
      buildRateLimitKey(
        { action: "upload_presign" },
        {
          ip: "203.0.113.10",
          userId: "user-123",
        }
      )
    ).toBe("rate_limit:upload_presign:user:dXNlci0xMjM:MjAzLjAuMTEzLjEw");
    expect(
      buildRateLimitKey(
        { action: "job_status" },
        {
          guestId: "guest-123",
          ip: "198.51.100.5",
        }
      )
    ).toBe("rate_limit:job_status:guest:Z3Vlc3QtMTIz:MTk4LjUxLjEwMC41");
  });

  it("allows requests under the configured limit", async () => {
    exec.mockResolvedValue([
      [null, 1],
      [null, 1],
      [null, 60000],
    ]);

    const { assertRateLimitAllowed } = await import("@/server/rateLimit");

    await expect(
      assertRateLimitAllowed(
        {
          action: "upload_presign",
          limit: 2,
          windowSeconds: 60,
        },
        {
          ip: "203.0.113.10",
          userId: "user-123",
        }
      )
    ).resolves.toBeUndefined();

    expect(incr).toHaveBeenCalledWith(
      "rate_limit:upload_presign:user:dXNlci0xMjM:MjAzLjAuMTEzLjEw"
    );
    expect(expire).toHaveBeenCalledWith(
      "rate_limit:upload_presign:user:dXNlci0xMjM:MjAzLjAuMTEzLjEw",
      60,
      "NX"
    );
  });

  it("blocks once the limit is exceeded and returns Retry-After", async () => {
    exec.mockResolvedValue([
      [null, 3],
      [null, 1],
      [null, 2500],
    ]);

    const { assertRateLimitAllowed, RateLimitExceededError } = await import(
      "@/server/rateLimit"
    );

    await expect(
      assertRateLimitAllowed(
        {
          action: "job_status",
          limit: 2,
          windowSeconds: 60,
        },
        {
          guestId: "guest-123",
          ip: "198.51.100.5",
        }
      )
    ).rejects.toEqual(expect.any(RateLimitExceededError));
    await expect(
      assertRateLimitAllowed(
        {
          action: "job_status",
          limit: 2,
          windowSeconds: 60,
        },
        {
          guestId: "guest-123",
          ip: "198.51.100.5",
        }
      )
    ).rejects.toMatchObject({
      retryAfterSeconds: 3,
    });
  });

  it("uses ip-only identity when no user or guest exists", async () => {
    exec.mockResolvedValue([
      [null, 1],
      [null, 1],
      [null, 60000],
    ]);

    const { assertRateLimitAllowed } = await import("@/server/rateLimit");

    await assertRateLimitAllowed(
      {
        action: "upload_presign",
        limit: 1,
        windowSeconds: 60,
      },
      {
        ip: "2001:db8::1",
      }
    );

    expect(incr).toHaveBeenCalledWith(
      "rate_limit:upload_presign:ip:MjAwMTpkYjg6OjE:MjAwMTpkYjg6OjE"
    );
  });

  it("rethrows unexpected internal errors instead of silently failing open", async () => {
    exec.mockResolvedValue(null);

    const { assertRateLimitAllowed } = await import("@/server/rateLimit");

    await expect(
      assertRateLimitAllowed(
        {
          action: "job_status",
          limit: 2,
          windowSeconds: 60,
        },
        {
          ip: "203.0.113.10",
          userId: "user-123",
        }
      )
    ).rejects.toThrow(/transaction failed/i);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rethrows redis command-level transaction errors", async () => {
    exec.mockResolvedValue([
      [new Error("WRONGTYPE"), null],
      [null, 1],
      [null, 60000],
    ]);

    const { assertRateLimitAllowed } = await import("@/server/rateLimit");

    await expect(
      assertRateLimitAllowed(
        {
          action: "upload_presign",
          limit: 2,
          windowSeconds: 60,
        },
        {
          ip: "203.0.113.10",
        }
      )
    ).rejects.toThrow(/transaction failed/i);
  });

  it("fails open and logs when Redis is unavailable", async () => {
    exec.mockRejectedValue(new Error("redis unavailable"));

    const { assertRateLimitAllowed } = await import("@/server/rateLimit");

    await expect(
      assertRateLimitAllowed(
        {
          action: "job_status",
          limit: 2,
          windowSeconds: 60,
        },
        {
          ip: "203.0.113.10",
          userId: "user-123",
        }
      )
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "job_status",
        actorType: "user",
        hasIp: true,
      }),
      "Rate limiter unavailable, allowing request"
    );
  });
});
