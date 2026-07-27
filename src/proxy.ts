/**
 * Route gate for the whole site (packet 04). Next.js 16 proxy convention:
 * this file replaces middleware.ts, runs on the Node runtime (Web Crypto and
 * node built-ins available; the `runtime` option must not be set here).
 *
 * Default deny: PUBLIC_ROUTES in src/lib/auth/guest-session.ts is the only
 * way a route skips the guest-session check. /admin and /api/admin never
 * accept a guest session; they require a Supabase auth cookie here and the
 * real requireAdmin() check in the admin server layer.
 *
 * Per the platform spike, server actions ride their page's matcher and
 * matchers can exclude them silently, so this proxy is deliberately NOT the
 * only auth layer: every route handler and server function that touches data
 * must call requireGalleryAccess() or requireAdmin() again.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  GUEST_SESSION_COOKIE,
  GalleryAccessConfigError,
  isPublicRoute,
  verifyGuestSession,
} from "@/lib/auth/guest-session";
import { applySecurityHeaders } from "@/lib/auth/security-headers";
import { isOpenAccess } from "@/lib/auth/open-access";

/** @supabase/ssr auth cookie: sb-<ref>-auth-token, possibly chunked (.0, .1). */
const SUPABASE_AUTH_COOKIE = /^sb-[^=]+-auth-token(\.\d+)?$/;

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isAdminPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/")
  );
}

function deny(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (isApiPath(pathname)) {
    return applySecurityHeaders(
      NextResponse.json({ error: "Authentication required." }, { status: 401 }),
    );
  }
  const enterUrl = new URL("/enter", request.url);
  enterUrl.searchParams.set("next", `${pathname}${search}`);
  return applySecurityHeaders(NextResponse.redirect(enterUrl));
}



export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (isOpenAccess()) {
    return applySecurityHeaders(NextResponse.next());
  }

  if (isPublicRoute(pathname)) {
    return applySecurityHeaders(NextResponse.next());
  }

  if (isAdminPath(pathname)) {
    // Guest cookies are deliberately ignored here: a valid guest session
    // never grants admin access. This is only a cheap structural gate; the
    // admin server layer must call requireAdmin() on every request.
    const hasSupabaseAuthCookie = request.cookies
      .getAll()
      .some(
        (cookie) =>
          SUPABASE_AUTH_COOKIE.test(cookie.name) && cookie.value.length > 0,
      );
    if (!hasSupabaseAuthCookie) {
      return deny(request);
    }
    return applySecurityHeaders(NextResponse.next());
  }

  const token = request.cookies.get(GUEST_SESSION_COOKIE)?.value;
  if (!token) {
    return deny(request);
  }

  try {
    const session = await verifyGuestSession(token);
    if (!session) {
      return deny(request);
    }
  } catch (error) {
    if (error instanceof GalleryAccessConfigError) {
      // Fail closed, loudly: a missing GALLERY_SESSION_SECRET must surface
      // as a configuration error, never as an open door or a silent redirect
      // loop. The message names the variable, never its value.
      return applySecurityHeaders(
        new NextResponse(`Gallery is not configured. ${error.message}`, {
          status: 500,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }) as NextResponse,
      );
    }
    throw error;
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  // Static build assets are served unauthenticated (they carry no gallery
  // media); everything else, including files under public/, flows through
  // the proxy so the default-deny allowlist decides. Must stay a literal.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
