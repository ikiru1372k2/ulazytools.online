import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getGuestCookieOptions,
  GUEST_ID_COOKIE,
  INTERNAL_GUEST_ID_HEADER,
  INTERNAL_GUEST_ID_TRUST_HEADER,
  resolveGuestSession,
  serializeGuestCookie,
} from "@/lib/guest";
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

export default async function middleware(req: NextRequest) {
  const requestId = getOrCreateRequestId(
    normalizeRequestId(req.headers.get(REQUEST_ID_HEADER))
  );
  const headers = new Headers(req.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.delete(INTERNAL_GUEST_ID_HEADER);
  headers.delete(INTERNAL_GUEST_ID_TRUST_HEADER);
  const shouldEnsureGuestCookie = !hasSessionCookie(req);
  const guestSession = shouldEnsureGuestCookie
    ? await resolveGuestSession(req.cookies.get(GUEST_ID_COOKIE)?.value)
    : null;

  if (guestSession) {
    headers.set(INTERNAL_GUEST_ID_HEADER, guestSession.guestId);
    headers.set(INTERNAL_GUEST_ID_TRUST_HEADER, "1");
  } else {
    headers.delete(INTERNAL_GUEST_ID_HEADER);
    headers.delete(INTERNAL_GUEST_ID_TRUST_HEADER);
  }

  const applyCommonHeadersAndCookies = async (
    response: NextResponse | {
      cookies?: { set: (...args: unknown[]) => void };
      headers: Headers;
      status: number;
    }
  ) => {
    response.headers.set(REQUEST_ID_HEADER, requestId);

    if (guestSession?.shouldSetCookie && response.cookies) {
      response.cookies.set(
        GUEST_ID_COOKIE,
        await serializeGuestCookie(guestSession.guestId),
        getGuestCookieOptions()
      );
    }

    return response;
  };

  if (!req.nextUrl.pathname.startsWith("/dashboard")) {
    return applyCommonHeadersAndCookies(
      NextResponse.next({
        request: {
          headers,
        },
      })
    );
  }

  if (hasSessionCookie(req)) {
    return applyCommonHeadersAndCookies(
      NextResponse.next({
        request: {
          headers,
        },
      })
    );
  }

  const loginUrl = new URL("/login", req.nextUrl.origin);
  loginUrl.searchParams.set("next", req.nextUrl.pathname);

  return applyCommonHeadersAndCookies(NextResponse.redirect(loginUrl));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.[^/]+$).*)",
  ],
};
