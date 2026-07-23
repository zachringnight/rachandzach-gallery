/**
 * Guest login (packet 04). POST only, Node runtime (Argon2id verification
 * uses the native @node-rs/argon2 binding).
 *
 * Order of operations, pinned by the packet:
 *   1. Rate limit (per hashed IP and a global bucket) BEFORE any password
 *      verification. No database means no login: rate limiting fails closed.
 *   2. Argon2id verification against GALLERY_PASSWORD_HASH. Only the hash is
 *      ever configured or stored; the plain password is never logged.
 *   3. Mint the signed guest session cookie and redirect to the sanitized
 *      next path.
 *
 * Responses never reveal whether a password is configured or what it might
 * be: a wrong password and an unknown password state look identical to the
 * caller. Missing configuration is the one loud exception (HTTP 500 naming
 * the missing variable, value never included), per the fail-closed contract.
 */
import { NextResponse, type NextRequest } from "next/server";
import { verify } from "@node-rs/argon2";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  GUEST_SESSION_COOKIE,
  GalleryAccessConfigError,
  createGuestSession,
  guestSessionCookieOptions,
  sanitizeNextPath,
} from "@/lib/auth/guest-session";
import {
  LOGIN_GLOBAL_RATE_LIMIT,
  LOGIN_IP_RATE_LIMIT,
  consumeRateLimit,
  hashRateLimitKey,
} from "@/lib/auth/rate-limit";

export const runtime = "nodejs";

const DEFAULT_DESTINATION = "/photos";

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function enterRedirect(
  request: NextRequest,
  error: "invalid" | "slow",
  nextPath: string,
): NextResponse {
  const url = new URL("/enter", request.url);
  url.searchParams.set("error", error);
  if (nextPath !== DEFAULT_DESTINATION) {
    url.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(url, 303);
}

function configurationError(message: string): NextResponse {
  return NextResponse.json(
    { error: `Gallery login is not configured. ${message}` },
    { status: 500 },
  );
}

export async function POST(request: NextRequest) {
  // Same-origin guard for the credential form (SameSite=Lax plus CSP
  // form-action 'self' already help; this closes the cross-origin POST case).
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Cross-origin login rejected." }, { status: 403 });
  }

  let password = "";
  let nextPath = DEFAULT_DESTINATION;
  try {
    const formData = await request.formData();
    password = String(formData.get("password") ?? "");
    nextPath = sanitizeNextPath(
      String(formData.get("next") ?? ""),
      DEFAULT_DESTINATION,
    );
  } catch {
    return enterRedirect(request, "invalid", DEFAULT_DESTINATION);
  }

  const passwordHash = process.env.GALLERY_PASSWORD_HASH;
  if (!passwordHash || passwordHash.trim().length === 0) {
    // Fail closed at runtime with a clear configuration error. Never fall
    // back to a default password.
    return configurationError(
      "GALLERY_PASSWORD_HASH is not set. Store only an Argon2id hash of the shared guest password.",
    );
  }

  // Rate limit before password verification. The RPC seam (and therefore the
  // database) failing means the attempt is denied, never waved through.
  let allowed = false;
  try {
    const admin = createAdminClient();
    const [ipKey, globalKey] = await Promise.all([
      hashRateLimitKey(clientIp(request), LOGIN_IP_RATE_LIMIT.action),
      hashRateLimitKey(
        LOGIN_GLOBAL_RATE_LIMIT.subject,
        LOGIN_GLOBAL_RATE_LIMIT.action,
      ),
    ]);
    const [ipAllowed, globalAllowed] = await Promise.all([
      consumeRateLimit(admin, {
        keyHash: ipKey,
        action: LOGIN_IP_RATE_LIMIT.action,
        attemptLimit: LOGIN_IP_RATE_LIMIT.attemptLimit,
        windowSeconds: LOGIN_IP_RATE_LIMIT.windowSeconds,
      }),
      consumeRateLimit(admin, {
        keyHash: globalKey,
        action: LOGIN_GLOBAL_RATE_LIMIT.action,
        attemptLimit: LOGIN_GLOBAL_RATE_LIMIT.attemptLimit,
        windowSeconds: LOGIN_GLOBAL_RATE_LIMIT.windowSeconds,
      }),
    ]);
    allowed = ipAllowed && globalAllowed;
  } catch (error) {
    // createAdminClient and hashRateLimitKey throw only on missing
    // configuration; surface that clearly instead of a generic failure.
    const message =
      error instanceof GalleryAccessConfigError || error instanceof Error
        ? error.message
        : "Rate limiting is unavailable.";
    return configurationError(message);
  }
  if (!allowed) {
    return enterRedirect(request, "slow", nextPath);
  }

  let passwordOk = false;
  try {
    passwordOk = await verify(passwordHash, password);
  } catch {
    // @node-rs/argon2 throws when the stored hash is not a valid Argon2
    // string; that is a configuration problem, not a guest problem.
    return configurationError(
      "GALLERY_PASSWORD_HASH is not a valid Argon2id hash.",
    );
  }
  if (!passwordOk) {
    return enterRedirect(request, "invalid", nextPath);
  }

  const token = await createGuestSession();
  const response = NextResponse.redirect(new URL(nextPath, request.url), 303);
  response.cookies.set(GUEST_SESSION_COOKIE, token, guestSessionCookieOptions());
  return response;
}
