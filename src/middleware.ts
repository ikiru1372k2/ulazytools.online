import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function hasSessionCookie(request: NextRequest) {
  return (
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token") ||
    request.cookies.has("next-auth.session-token") ||
    request.cookies.has("__Secure-next-auth.session-token")
  );
}

export default function middleware(req: NextRequest) {
  if (hasSessionCookie(req)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", req.nextUrl.origin);
  loginUrl.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Keep this matcher aligned with each clean-URL protected route we add.
  // The authoritative auth check still happens in the protected server layout.
  matcher: ["/dashboard/:path*"],
};
