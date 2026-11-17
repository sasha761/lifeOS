import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE_PREFIX } from "./lib/auth-cookie.ts";

/**
 * Optimistic guard (Next.js 16 Proxy): a guest without any session cookie gets a real 307 to sign-in
 * before the page starts streaming. It never reads the database and is not authorization — every
 * protected page still verifies the session server-side with requirePageUser().
 */
export function proxy(request: NextRequest): NextResponse {
  if (getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX })) return NextResponse.next();
  const signIn = new URL("/auth/sign-in", request.url);
  signIn.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/dashboard/:path*", "/goals/:path*", "/settings/:path*"],
};
