jest.mock("next/server", () => {
  class MockNextResponse {
    headers: Headers;
    request?: { headers: Headers };
    status: number;

    constructor(status: number, headers?: Headers, request?: { headers: Headers }) {
      this.headers = headers ?? new Headers();
      this.request = request;
      this.status = status;
    }

    static next(init?: { request?: { headers: Headers } }) {
      return new MockNextResponse(200, new Headers(), init?.request);
    }

    static redirect(url: URL) {
      const headers = new Headers();
      headers.set("location", url.toString());
      return new MockNextResponse(307, headers);
    }
  }

  return {
    NextResponse: MockNextResponse,
  };
});

import middleware from "@/middleware";

function createRequest(pathname: string, options?: { headers?: HeadersInit }) {
  const headers = new Headers(options?.headers);
  const cookieHeader = headers.get("cookie") ?? "";
  const cookieNames = new Set(
    cookieHeader
      .split(";")
      .map((part) => part.trim().split("=")[0])
      .filter(Boolean)
  );

  return {
    cookies: {
      has(name: string) {
        return cookieNames.has(name);
      },
    },
    headers,
    nextUrl: {
      origin: "https://example.com",
      pathname,
    },
  };
}

describe("middleware", () => {
  it("redirects unauthenticated dashboard requests and adds a request ID", () => {
    const response = middleware(createRequest("/dashboard") as never);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://example.com/login?next=%2Fdashboard"
    );
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("allows authenticated dashboard requests through and adds a request ID", () => {
    const response = middleware(
      createRequest("/dashboard", {
        headers: {
          cookie: "authjs.session-token=test-session",
        },
      }) as never
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("preserves an incoming request ID for matched API requests", () => {
    const response = middleware(
      createRequest("/api/health", {
        headers: {
          "x-request-id": "req-123",
        },
      }) as never
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-123");
  });
});
