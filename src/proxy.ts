/**
 * Edge-of-request work for the whole site. Next.js 16 proxy convention: this
 * file replaces middleware.ts, runs on the Node runtime (Web Crypto and node
 * built-ins available; the `runtime` option must not be set here).
 *
 * THIS IS NO LONGER A GATE FOR GUESTS (2026-08-09). The shared password, the
 * /enter door and the PUBLIC_ROUTES default-deny allowlist were removed: every
 * page and API of this site now answers an anonymous request. What is left
 * here is three things.
 *
 *   1. Security headers on every response (unchanged).
 *   2. Issuing the guest identity cookie. It is not a permission -- see
 *      src/lib/auth/guest-session.ts -- it is the key a guest's favorites and
 *      upload batches are filed under, so it is minted here, once, for any
 *      request that arrives without a valid one. Minting needs
 *      GALLERY_SESSION_SECRET; if that is missing the request is served
 *      anyway, because a misconfigured secret must cost a guest their
 *      favorites and not cost everyone the site.
 *   3. Refreshing Supabase Auth cookies. Admin sessions rotate; the server
 *      client cannot persist that rotation from a Server Component, so this
 *      proxy calls getUser() and writes the new cookies onto the response.
 *
 * /admin and /api/admin are the exception and are still gated: they require a
 * live Supabase user here (not merely a cookie whose name matches), and the
 * real requireAdmin() check in the admin server layer. A guest cookie never
 * grants admin access. OPEN_ACCESS remains a Preview-only bypass until the
 * magic-link redirect allowlist is confirmed.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  GUEST_SESSION_COOKIE,
  GalleryAccessConfigError,
  createGuestSession,
  guestSessionCookieOptions,
  verifyGuestSession,
} from "@/lib/auth/guest-session";
import { isOpenAccess } from "@/lib/auth/open-access";
import { applySecurityHeaders } from "@/lib/auth/security-headers";
import {
  applySupabaseAuthRefresh,
  copyResponseCookies,
} from "@/lib/auth/supabase-auth-refresh";

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
 *
 * Starts from `authResponse` so a Supabase refresh on the same request is
 * not discarded when a guest cookie is minted.
 */
async function withGuestSession(
  request: NextRequest,
  authResponse: NextResponse,
): Promise<NextResponse> {
  const existing = request.cookies.get(GUEST_SESSION_COOKIE)?.value;

  let token: string | null = null;
  try {
    if (!(await verifyGuestSession(existing))) {
      token = await createGuestSession();
    }
  } catch (error) {
    if (!(error instanceof GalleryAccessConfigError)) throw error;
    // Unconfigured secret: serve the page without an identity cookie.
    return applySecurityHeaders(authResponse);
  }

  if (!token) {
    return applySecurityHeaders(authResponse);
  }

  request.cookies.set(GUEST_SESSION_COOKIE, token);
  const response = copyResponseCookies(
    authResponse,
    NextResponse.next({ request }),
  );
  response.cookies.set(GUEST_SESSION_COOKIE, token, guestSessionCookieOptions());
  return applySecurityHeaders(response);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const { response: authResponse, hasUser } =
    await applySupabaseAuthRefresh(request);

  if (isAdminPath(pathname)) {
    // Guest cookies are deliberately ignored here: a guest session never
    // grants admin access. A cookie whose name merely looks like a Supabase
    // auth token is not enough; getUser() has to succeed, unless the
    // Preview-only open-access bypass is on.
    if (!hasUser && !isOpenAccess()) {
      return denyAdmin(request);
    }
    return applySecurityHeaders(authResponse);
  }

  return withGuestSession(request, authResponse);
}

export const config = {
  // Static build assets skip the proxy entirely; everything else, including
  // files under public/, flows through it for security headers and the guest
  // identity cookie. Must stay a literal.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
