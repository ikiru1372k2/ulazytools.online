jest.mock("next/server", () => {
  class MockNextResponse {
    cookieCalls: unknown[];
    cookies: { set: (...args: unknown[]) => void };
    headers: Headers;
    request?: { headers: Headers };
    status: number;

    constructor(status: number, headers?: Headers, request?: { headers: Headers }) {
      this.cookieCalls = [];
      this.cookies = {
        set: (...args: unknown[]) => {
          this.cookieCalls.push(args);
        },
      };
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

const resolveGuestSession = jest.fn();
const serializeGuestCookie = jest.fn();

jest.mock("@/lib/guest", () => ({
  GUEST_ID_COOKIE: "guestId",
  INTERNAL_GUEST_ID_HEADER: "x-ulazytools-guest-id",
  getGuestCookieOptions: jest.fn(() => ({
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: false,
  })),
  resolveGuestSession: (...args: unknown[]) => resolveGuestSession(...args),
  serializeGuestCookie: (...args: unknown[]) => serializeGuestCookie(...args),
}));

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
      get(name: string) {
        const match = cookieHeader
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${name}=`));

        if (!match) {
          return undefined;
        }

        return {
          value: match.split("=").slice(1).join("="),
        };
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
  beforeEach(() => {
    resolveGuestSession.mockReset();
    serializeGuestCookie.mockReset();
    resolveGuestSession.mockResolvedValue({
      guestId: "guest-123",
      isNew: true,
      shouldSetCookie: true,
    });
    serializeGuestCookie.mockResolvedValue("guest-123.signature");
  });

  it("redirects unauthenticated dashboard requests, sets guest cookie, and adds a request ID", async () => {
    const response = (await middleware(createRequest("/dashboard") as never)) as any;

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://example.com/login?next=%2Fdashboard"
    );
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.cookieCalls).toHaveLength(1);
  });

  it("allows authenticated dashboard requests through and adds a request ID", async () => {
    const response = (await middleware(
      createRequest("/dashboard", {
        headers: {
          cookie: "authjs.session-token=test-session",
          "x-ulazytools-guest-id": "spoofed-guest-id",
        },
      }) as never
    )) as any;

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(resolveGuestSession).not.toHaveBeenCalled();
    expect(response.request?.headers.get("x-ulazytools-guest-id")).toBeNull();
  });

  it("preserves an incoming request ID for matched API requests", async () => {
    const response = (await middleware(
      createRequest("/api/health", {
        headers: {
          "x-request-id": "req-123",
        },
      }) as never
    )) as any;

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-123");
    expect(response.request?.headers.get("x-ulazytools-guest-id")).toBe(
      "guest-123"
    );
  });

  it("does not reset a valid guest cookie unnecessarily", async () => {
    resolveGuestSession.mockResolvedValue({
      guestId: "guest-123",
      isNew: false,
      shouldSetCookie: false,
    });

    const response = (await middleware(
      createRequest("/api/health", {
        headers: {
          cookie: "guestId=guest-123.signature",
        },
      }) as never
    )) as any;

    expect(response.cookieCalls).toHaveLength(0);
    expect(response.request?.headers.get("x-ulazytools-guest-id")).toBe(
      "guest-123"
    );
  });

  it("replaces an invalid guest cookie with a signed one", async () => {
    resolveGuestSession.mockResolvedValue({
      guestId: "guest-456",
      isNew: true,
      shouldSetCookie: true,
    });
    serializeGuestCookie.mockResolvedValue("guest-456.signature");

    const response = (await middleware(
      createRequest("/api/health", {
        headers: {
          cookie: "guestId=invalid-cookie-value",
        },
      }) as never
    )) as any;

    expect(resolveGuestSession).toHaveBeenCalledWith("invalid-cookie-value");
    expect(response.cookieCalls).toHaveLength(1);
    expect(response.cookieCalls[0]).toEqual([
      "guestId",
      "guest-456.signature",
      expect.objectContaining({
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      }),
    ]);
    expect(response.request?.headers.get("x-ulazytools-guest-id")).toBe(
      "guest-456"
    );
  });
});
