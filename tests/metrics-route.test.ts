const renderPrometheusMetrics = jest.fn();
const isMetricsActive = jest.fn();
const originalResponse = global.Response;

function buildRequest(headers?: HeadersInit) {
  return {
    headers: new Headers(headers),
  } as Request;
}

class MockResponse {
  readonly headers: Headers;
  readonly status: number;
  private readonly body: string;

  constructor(body: string, init?: ResponseInit) {
    this.body = body;
    this.headers = new Headers(init?.headers);
    this.status = init?.status ?? 200;
  }

  async text() {
    return this.body;
  }
}

describe("/api/metrics", () => {
  beforeEach(() => {
    jest.resetModules();
    renderPrometheusMetrics.mockReset();
    isMetricsActive.mockReset();
    process.env.METRICS_ENABLED = "false";
    delete process.env.METRICS_TOKEN;

    jest.doMock("@/lib/metrics", () => ({
      isMetricsActive,
      METRICS_CONTENT_TYPE: "text/plain; version=0.0.4; charset=utf-8",
      renderPrometheusMetrics,
    }));

    global.Response = MockResponse as unknown as typeof Response;
    isMetricsActive.mockReturnValue(false);
  });

  afterAll(() => {
    global.Response = originalResponse;
  });

  it("returns 404 when metrics are disabled", async () => {
    const { GET } = await import("@/app/api/metrics/route");

    const response = await GET(buildRequest());

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("metrics disabled\n");
  });

  it("returns metrics text when explicitly enabled", async () => {
    process.env.METRICS_ENABLED = "true";
    isMetricsActive.mockReturnValue(true);
    renderPrometheusMetrics.mockResolvedValue("ulazy_upload_presign_total 3\n");

    const { GET } = await import("@/app/api/metrics/route");

    const response = await GET(buildRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; version=0.0.4; charset=utf-8"
    );
    await expect(response.text()).resolves.toBe("ulazy_upload_presign_total 3\n");
  });

  it("requires bearer auth when METRICS_TOKEN is configured", async () => {
    process.env.METRICS_TOKEN = "secret-token";
    isMetricsActive.mockReturnValue(true);

    const { GET } = await import("@/app/api/metrics/route");

    const response = await GET(buildRequest());

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer realm="metrics"'
    );
    await expect(response.text()).resolves.toBe("unauthorized\n");
  });

  it("returns metrics text for a valid bearer token", async () => {
    process.env.METRICS_TOKEN = "secret-token";
    isMetricsActive.mockReturnValue(true);
    renderPrometheusMetrics.mockResolvedValue("ulazy_jobs_created_total 2\n");

    const { GET } = await import("@/app/api/metrics/route");

    const response = await GET(
      buildRequest({
        Authorization: "Bearer secret-token",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ulazy_jobs_created_total 2\n");
  });

  it("returns 503 text when metrics rendering fails", async () => {
    process.env.METRICS_ENABLED = "true";
    isMetricsActive.mockReturnValue(true);
    renderPrometheusMetrics.mockRejectedValue(new Error("redis unavailable"));

    const { GET } = await import("@/app/api/metrics/route");

    const response = await GET(buildRequest());

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("metrics unavailable\n");
  });
});
