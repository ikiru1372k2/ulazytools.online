import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getOrCreateRequestId,
  normalizeRequestId,
  REQUEST_ID_HEADER,
} from "@/lib/request-id";

function hasSessionCookie(request: NextRequest) {
  return (
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token") ||
    request.cookies.has("next-auth.session-token") ||
    request.cookies.has("__Secure-next-auth.session-token")
  );
}

export default function middleware(req: NextRequest) {
  const requestId = getOrCreateRequestId(
    normalizeRequestId(req.headers.get(REQUEST_ID_HEADER))
  );
  const headers = new Headers(req.headers);
  headers.set(REQUEST_ID_HEADER, requestId);

  if (!req.nextUrl.pathname.startsWith("/dashboard")) {
    const response = NextResponse.next({
      request: {
        headers,
      },
    });

    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  }

  if (hasSessionCookie(req)) {
    const response = NextResponse.next({
      request: {
        headers,
      },
    });

    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  }

  const loginUrl = new URL("/login", req.nextUrl.origin);
  loginUrl.searchParams.set("next", req.nextUrl.pathname);
  const response = NextResponse.redirect(loginUrl);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.[^/]+$).*)",
  ],
};
