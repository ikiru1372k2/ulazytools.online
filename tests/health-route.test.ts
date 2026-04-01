describe("/api/health", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock(
      "pino",
      () => {
        const info = jest.fn();
        const child = jest.fn(() => ({ child, info }));
        const instance = { child, info };
        const pino = jest.fn(() => instance);
        return { __esModule: true, default: pino };
      },
      { virtual: true }
    );
  });

  it("returns ok and echoes the request ID", async () => {
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/health/route");

    const response = await GET(
      new NextRequest(
        new Request("https://example.com/api/health", {
          headers: {
            "x-request-id": "health-123",
          },
        })
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      requestId: "health-123",
      status: "ok",
    });
  });
});
