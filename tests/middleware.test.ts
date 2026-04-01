import { NextRequest } from "next/server";

import middleware from "@/middleware";

function createRequest(pathname: string, options?: { headers?: HeadersInit }) {
  return new NextRequest(new Request(`https://example.com${pathname}`, options));
}

describe("middleware", () => {
  it("redirects unauthenticated dashboard requests and adds a request ID", () => {
    const response = middleware(createRequest("/dashboard"));

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
      })
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
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-123");
  });
});
