import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DOMAIN_KEYS } from "@lifeos/contracts";
import { AUTH_COOKIE_PREFIX } from "./lib/auth-cookie.ts";

const SPHERE_PAGE = /^\/domains\/([^/]+)\/?$/;

/**
 * Optimistic guard (Next.js 16 Proxy): a guest without any session cookie gets a real 307 to sign-in
 * before the page starts streaming. It never reads the database and is not authorization — every
 * protected page still verifies the session server-side with requirePageUser().
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname === "/domains" || pathname.startsWith("/domains/")) {
    // Sphere pages are public and render per request (LFS-213). A key outside the registry gets a real 404 before the
    // page starts streaming, by rewriting to a path no route serves (Next.js renders not-found.tsx with 404);
    // other /domains paths have no route and 404 by themselves.
    const sphere = SPHERE_PAGE.exec(pathname);
    if (!sphere || (DOMAIN_KEYS as readonly string[]).includes(sphere[1]!)) return NextResponse.next();
    return NextResponse.rewrite(new URL("/domains/_unknown/_", request.url));
  }
  if (getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX })) return NextResponse.next();
  const signIn = new URL("/auth/sign-in", request.url);
  signIn.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/dashboard/:path*", "/goals/:path*", "/settings/:path*", "/domains/:path*", "/onboarding/:path*"],
};
