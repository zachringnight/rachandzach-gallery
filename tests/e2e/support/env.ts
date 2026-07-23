/**
 * Synthetic environment for the Playwright e2e suite (packet 12, workstream A).
 *
 * Single source of truth for the SYNTHETIC BUILD ENV: playwright.config.ts
 * passes these values to the `next start` child process it spawns as the
 * webServer, and tests/e2e/support/session.ts uses the SAME session secret
 * to mint guest cookies directly (see that file's header comment for why).
 * Keeping both reads from this one module is what guarantees they can never
 * drift apart mid-run.
 *
 * Nothing here is a real secret and nothing here is reachable. This
 * environment has no Docker and no local Postgres, so:
 *   - GALLERY_PASSWORD_HASH is a REAL Argon2id hash (produced by the same
 *     @node-rs/argon2 the app uses) of the synthetic password below, so the
 *     server's verify() call behaves exactly like production would. The
 *     password itself is never a real guest's password.
 *   - The Supabase URL points at a port nothing listens on, so every
 *     Supabase call the running app makes fails fast with a connection
 *     error instead of hanging. That is what lets DB-dependent routes be
 *     tested for their documented fail-closed behavior without a live
 *     database: build succeeds without secrets, runtime fails closed, by
 *     design (see next.config.ts / src/lib/auth/guest-session.ts).
 *
 * Regeneration commands (only needed if these are ever rotated):
 *   node -e "require('@node-rs/argon2').hash('test-password-0719').then(console.log)"
 *   openssl rand -hex 32
 */

/** Plaintext only for documentation and for driving the real login FORM in
 *  tests; only ever sent in that one POST body, never treated as a secret. */
export const SYNTHETIC_GALLERY_PASSWORD = "test-password-0719";

/** Argon2id hash of SYNTHETIC_GALLERY_PASSWORD. */
export const SYNTHETIC_GALLERY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$ZlWMad6EStM4sNnxWDeu9g$c507JzlRlyB6y87+8nP8dTo2+VGZuU5IQvTyjnOvc1g";

/**
 * 64 synthetic hex chars (32 random bytes). Must stay byte-identical between
 * the server process and the test process for an entire run -- both read it
 * from this module, neither generates its own.
 */
export const SYNTHETIC_GALLERY_SESSION_SECRET =
  "2f5d4b704e008d71d178b75581ea1c1d6ef4e4ca604f46940bdaddb4301c0d06";

/**
 * Deliberately NOT Supabase CLI's real local default of 54321, so this can
 * never coincidentally hit a developer's own local stack if one happened to
 * be running. Every Supabase call the app makes during this suite fails
 * with a connection error, on purpose.
 */
export const SYNTHETIC_SUPABASE_URL = "http://127.0.0.1:54329";
export const SYNTHETIC_SUPABASE_ANON_KEY = "synthetic-anon-key-e2e-only";
export const SYNTHETIC_SUPABASE_SERVICE_ROLE_KEY =
  "synthetic-service-role-key-e2e-only";

/** Port the production server listens on for this suite. */
export const E2E_PORT = 4310;
/**
 * "localhost", deliberately not "127.0.0.1". Verified against the running
 * server: `next start` (no explicit -H/--hostname) resolves
 * `request.nextUrl.origin` to `http://localhost:<port>` regardless of which
 * literal address a client connects through. src/app/api/access/login's
 * same-origin guard compares the browser's real `Origin` header (which
 * mirrors whatever host the suite actually navigated to) against that
 * value, so navigating this suite through 127.0.0.1 makes every real login
 * POST 403 with "Cross-origin login rejected" even though it is, in every
 * practical sense, the same origin. Using "localhost" throughout makes the
 * browser's Origin header match what the server expects.
 */
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/**
 * Full env block for the `next start` child process Playwright's webServer
 * spawns. Starts from process.env (so PATH and friends survive) with
 * undefined values dropped, then overlays the synthetic values.
 */
export function syntheticServerEnv(): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) inherited[key] = value;
  }
  return {
    ...inherited,
    NEXT_PUBLIC_SUPABASE_URL: SYNTHETIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: SYNTHETIC_SUPABASE_ANON_KEY,
    SUPABASE_URL: SYNTHETIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SYNTHETIC_SUPABASE_SERVICE_ROLE_KEY,
    GALLERY_PASSWORD_HASH: SYNTHETIC_GALLERY_PASSWORD_HASH,
    GALLERY_SESSION_SECRET: SYNTHETIC_GALLERY_SESSION_SECRET,
    PORT: String(E2E_PORT),
    NODE_ENV: "production",
  };
}
