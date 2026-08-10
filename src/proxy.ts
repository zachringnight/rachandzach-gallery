/**
 * Edge-of-request work for the whole site. Next.js 16 proxy convention: this
 * file replaces middleware.ts, runs on the Node runtime (Web Crypto and node
 * built-ins available; the `runtime` option must not be set here).
 *
 * THIS IS NO LONGER A GATE FOR GUESTS (2026-08-09). The shared password, the
 * /enter door and the PUBLIC_ROUTES default-deny allowlist were removed: every
 * page and API of this site now answers an anonymous request. What is left
 * here is two things.
 *
 *   1. Security headers on every response (unchanged).
 *   2. Issuing the guest identity cookie. It is not a permission -- see
 *      src/lib/auth/guest-session.ts -- it is the key a guest's favorites and
 *      upload batches are filed under, so it is minted here, once, for any
 *      request that arrives without a valid one. Minting needs
 *      GALLERY_SESSION_SECRET; if that is missing the request is served
 *      anyway, because a misconfigured secret must cost a guest their
 *      favorites and not cost everyone the site.
 *
 * /admin and /api/admin are the exception and are still gated: they require a
 * Supabase auth cookie here, and the real requireAdmin() check in the admin
 * server layer. A guest cookie never grants admin access.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  GUEST_SESSION_COOKIE,
  GalleryAccessConfigError,
  createGuestSession,
  guestSessionCookieOptions,
  verifyGuestSession,
} from "@/lib/auth/guest-session";
import { applySecurityHeaders } from "@/lib/auth/security-headers";

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

function denyAdmin(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (isApiPath(pathname)) {
    return applySecurityHeaders(
      NextResponse.json({ error: "Authentication required." }, { status: 401 }),
    );
  }
  // No sign-in page of our own to send them to: admin arrives by magic link.
  return applySecurityHeaders(
    NextResponse.redirect(new URL("/", request.url)),
  );
}

/**
 * Returns the response to send, having ensured the caller carries a guest
 * identity cookie. A newly minted value is written onto `request.cookies` as
 * well as the response, so the server components rendering THIS request read
 * the same session id the browser will send on the next one -- without that,
 * a guest's first page load would file favorites under an id that is thrown
 * away a moment later.
 */
async function withGuestSession(request: NextRequest): Promise<NextResponse> {
  const existing = request.cookies.get(GUEST_SESSION_COOKIE)?.value;

  let token: string | null = null;
  try {
    if (!(await verifyGuestSession(existing))) {
      token = await createGuestSession();
    }
  } catch (error) {
    if (!(error instanceof GalleryAccessConfigError)) throw error;
    // Unconfigured secret: serve the page without an identity cookie.
    return applySecurityHeaders(NextResponse.next());
  }

  if (!token) {
    return applySecurityHeaders(NextResponse.next());
  }

  request.cookies.set(GUEST_SESSION_COOKIE, token);
  const response = NextResponse.next({ request });
  response.cookies.set(GUEST_SESSION_COOKIE, token, guestSessionCookieOptions());
  return applySecurityHeaders(response);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (isAdminPath(pathname)) {
    // Guest cookies are deliberately ignored here: a guest session never
    // grants admin access. This is only a cheap structural gate; the admin
    // server layer must call requireAdmin() on every request.
    const hasSupabaseAuthCookie = request.cookies
      .getAll()
      .some(
        (cookie) =>
          SUPABASE_AUTH_COOKIE.test(cookie.name) && cookie.value.length > 0,
      );
    if (!hasSupabaseAuthCookie) {
      return denyAdmin(request);
    }
    return applySecurityHeaders(NextResponse.next());
  }

  return withGuestSession(request);
}

export const config = {
  // Static build assets skip the proxy entirely; everything else, including
  // files under public/, flows through it for security headers and the guest
  // identity cookie. Must stay a literal.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
