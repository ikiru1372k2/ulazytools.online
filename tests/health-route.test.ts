jest.mock("next/server", () => ({
  NextResponse: {
    json(body: unknown) {
      return {
        async json() {
          return body;
        },
        status: 200,
      };
    },
  },
}));

describe("/api/health", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock(
      "pino",
      () => {
        const info = jest.fn();
        const instance = {
          child: jest.fn(),
          info,
        };
        instance.child.mockReturnValue(instance);
        const pino = jest.fn(() => instance);
        return { __esModule: true, default: pino };
      },
      { virtual: true }
    );
  });

  it("returns ok and echoes the request ID", async () => {
    const { GET } = await import("@/app/api/health/route");

    const response = await GET(
      {
        headers: new Headers({
          "x-request-id": "health-123",
        }),
      } as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      requestId: "health-123",
      status: "ok",
    });
  });
});
