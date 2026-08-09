/**
 * Guest-session cookie minting for specs that want a KNOWN session id.
 *
 * This used to exist because reaching any archive route meant going through
 * a login POST, which rate-limited through a Postgres RPC before it
 * ever checks the password -- and there is no live database in this
 * environment (no Docker, no local Postgres), so the real login endpoint
 * always denied. That gate, and that route, were removed on 2026-08-09: the
 * proxy now hands every visitor a session on the way in, so no spec needs
 * this helper merely to get through a door.
 *
 * It stays for the case it is still good at: pinning the exact session id a
 * spec runs under, so assertions about session-keyed data (favorites, upload
 * batches) are not racing a cookie the server minted a moment ago.
 *
 * Minting has no database dependency -- createGuestSession() in
 * src/lib/auth/guest-session.ts is a pure HMAC-SHA256 signature over a random
 * session id, keyed only by GALLERY_SESSION_SECRET. Called here with the same
 * secret the running server was started with (tests/e2e/support/env.ts), it
 * produces a cookie byte-for-byte identical to one the proxy would issue, so
 * the server still runs its real verification path over it.
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
