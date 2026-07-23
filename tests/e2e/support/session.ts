/**
 * Guest-session cookie minting for specs that need to reach an authenticated
 * route WITHOUT going through the real login form.
 *
 * Why this exists: POST /api/access/login rate-limits every attempt through
 * a Postgres RPC (src/lib/auth/rate-limit.ts) BEFORE it ever checks the
 * password. There is no live database in this environment (no Docker, no
 * local Postgres -- packet 12's hard gates), so that RPC call always fails
 * and the real login endpoint always denies with the "slow" error,
 * regardless of the password. access.spec.ts covers that real, documented
 * behavior directly by driving the actual form.
 *
 * Session MINTING itself has no database dependency at all --
 * createGuestSession() in src/lib/auth/guest-session.ts is a pure
 * HMAC-SHA256 signature over a random session id, keyed only by
 * GALLERY_SESSION_SECRET. It is the exact function the login route calls
 * once the RPC succeeds. Calling it directly here, with the same secret the
 * running server was started with (tests/e2e/support/env.ts), produces a
 * cookie byte-for-byte identical to what a real login would have issued. So
 * every spec that uses it is still exercising the real proxy.ts /
 * requireGalleryAccess() verification code on the server -- only the
 * DB-gated rate limiter is bypassed, not auth verification itself. This is
 * standard "programmatic login" e2e practice for a login flow with an infra
 * dependency the suite cannot provide (see
 * https://playwright.dev/docs/auth#basic-shared-account-in-all-tests for the
 * general pattern); it is not a faked pass, and every DB-backed page or
 * route this cookie subsequently reaches is still exercised for real,
 * including its real fail-closed behavior when Supabase is unreachable (see
 * gallery.spec.ts, downloads.spec.ts, uploads.spec.ts, admin.spec.ts).
 */
import type { BrowserContext } from "@playwright/test";
import {
  GUEST_SESSION_COOKIE,
  createGuestSession,
} from "../../../src/lib/auth/guest-session";
import { E2E_BASE_URL, SYNTHETIC_GALLERY_SESSION_SECRET } from "./env";

// The Playwright test runner is a separate Node process from the `next
// start` child process the webServer spawns; each needs its own copy of the
// secret in `process.env`. `??=` so a real value already present is never
// clobbered.
process.env.GALLERY_SESSION_SECRET ??= SYNTHETIC_GALLERY_SESSION_SECRET;

/** Mints a fresh, validly-signed guest session token. */
export async function mintGuestSessionToken(): Promise<string> {
  return createGuestSession();
}

/**
 * Adds a valid guest session cookie to a browser context, scoped to the
 * running e2e server. Call before navigating so the first request already
 * carries it.
 */
export async function addGuestSession(context: BrowserContext): Promise<void> {
  const token = await mintGuestSessionToken();
  await context.addCookies([
    {
      name: GUEST_SESSION_COOKIE,
      value: token,
      url: E2E_BASE_URL,
      httpOnly: true,
      sameSite: "Lax",
      // Plain HTTP in this suite; a `secure` cookie would depend on browsers'
      // "potentially trustworthy" 127.0.0.1 carve-out instead of testing
      // anything about session verification itself.
      secure: false,
    },
  ]);
}

/**
 * A structurally well-formed but unsigned/garbled cookie value: same
 * `v1.<payload>.<signature>` shape the app expects, so it reaches signature
 * verification, but can never actually verify.
 */
export const TAMPERED_SESSION_TOKEN = "v1.dGFtcGVyZWQ.dGFtcGVyZWQ";

/** Re-exported so specs never need to hardcode the cookie name. */
export { GUEST_SESSION_COOKIE };
