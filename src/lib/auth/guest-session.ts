/**
 * Guest session layer for the gallery.
 *
 * THE PASSWORD GATE IS GONE (2026-08-09). Every page and API of this site is
 * now readable by anyone who has the URL; there is no shared password, no
 * /enter door, and no default-deny allowlist. What survives here is the part
 * that was never about access control: a signed, per-browser session id.
 *
 * That id is an identity, not a permission. It is the owner key for a guest's
 * favorites (src/lib/favorites/server.ts) and the key their upload batches are
 * filed under (src/lib/uploads/create-batch.ts), so hearts and submissions
 * still follow one browser across visits. Nothing is authorized by holding
 * one -- an anonymous caller gets a fresh session instead of a 401.
 *
 * Because of that, configuration now fails SOFT here and only here: a missing
 * GALLERY_SESSION_SECRET costs a guest the continuity of their favorites, and
 * it must not cost everyone the site. src/proxy.ts mints and sets the cookie
 * when it can and shrugs when it cannot; getGuestSession() hands back an
 * ephemeral session in that case. (Other consumers of the secret, notably the
 * rate limiter, still fail closed -- that is their call to make, not this
 * module's.) Admin authentication is entirely separate and still real: see
 * src/lib/auth/admin-session.ts.
 *
 * Signing uses Web Crypto (crypto.subtle HMAC-SHA256), which is available in
 * the Node runtime that proxy.ts and every route handler run on.
 */

export interface GallerySession {
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
  version: 1;
}

export const SESSION_TOKEN_VERSION = 1;
const TOKEN_PREFIX = "v1";

export const GUEST_SESSION_COOKIE = "rz_gallery_session";
export const GUEST_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Allowance for clock skew between the issuing and verifying hosts. */
const CLOCK_SKEW_SECONDS = 60;
const MIN_SECRET_BYTES = 32;

/**
 * GALLERY_SESSION_SECRET is missing or unusable. Callers that only need a
 * guest identity treat this as "no continuity this request" and carry on; see
 * the module header for why that is the right trade now that nothing is gated.
 */
export class GalleryAccessConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GalleryAccessConfigError";
  }
}

/**
 * Redirect convention: next=/relative/path only. Absolute URLs,
 * protocol-relative URLs, backslashes, and control characters all collapse to
 * the fallback. Used by the admin magic-link callback, which is the only
 * remaining route that takes a caller-supplied destination.
 */
export function sanitizeNextPath(
  raw: string | null | undefined,
  fallback = "/",
): string {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("\\")) return fallback;
  if (/[\r\n\u0000]/.test(raw)) return fallback;
  return raw;
}

/** Cookie attributes for the guest identity cookie. */
export function guestSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_SESSION_MAX_AGE_SECONDS,
  };
}

// --- Secret handling (server-only, read lazily) ----------------------------

/**
 * Reads and validates GALLERY_SESSION_SECRET. Exported for the rate-limit
 * module's key derivation only; never expose the return value to clients,
 * logs, or error messages.
 */
export function readSessionSecretBytes(): Uint8Array {
  const raw = process.env.GALLERY_SESSION_SECRET;
  if (!raw || raw.trim().length === 0) {
    throw new GalleryAccessConfigError(
      "GALLERY_SESSION_SECRET is not set. Guest sessions cannot be signed: " +
        "configure a random secret of at least 32 bytes. There is no fallback secret.",
    );
  }
  const bytes = new TextEncoder().encode(raw);
  if (bytes.length < MIN_SECRET_BYTES) {
    throw new GalleryAccessConfigError(
      "GALLERY_SESSION_SECRET is too short: it must be at least 32 random bytes.",
    );
  }
  return bytes;
}

async function importSessionKey(usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    readSessionSecretBytes() as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

// --- Encoding helpers ------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (text.length === 0 || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    return new Uint8Array(Buffer.from(text, "base64url"));
  } catch {
    return null;
  }
}

// --- Token mint / verify ---------------------------------------------------

/** A session object with a fresh id, not backed by any cookie. */
function newSession(): GallerySession {
  const now = Math.floor(Date.now() / 1000);
  return {
    sessionId: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: now + GUEST_SESSION_MAX_AGE_SECONDS,
    version: SESSION_TOKEN_VERSION,
  };
}

/**
 * Mints a signed guest session token: `v1.<base64url payload>.<base64url
 * HMAC-SHA256 signature>`. Throws GalleryAccessConfigError when the secret
 * is missing or too short.
 */
export async function createGuestSession(): Promise<string> {
  const key = await importSessionKey(["sign"]);
  const session = newSession();
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(session)));
  const signingInput = `${TOKEN_PREFIX}.${payload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

function parseGallerySession(value: unknown): GallerySession | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== SESSION_TOKEN_VERSION) return null;
  if (typeof candidate.sessionId !== "string" || candidate.sessionId.length === 0) {
    return null;
  }
  if (typeof candidate.issuedAt !== "number" || !Number.isFinite(candidate.issuedAt)) {
    return null;
  }
  if (typeof candidate.expiresAt !== "number" || !Number.isFinite(candidate.expiresAt)) {
    return null;
  }
  return {
    sessionId: candidate.sessionId,
    issuedAt: candidate.issuedAt,
    expiresAt: candidate.expiresAt,
    version: SESSION_TOKEN_VERSION,
  };
}

/**
 * Verifies a guest session token. Returns the session for a valid token and
 * null for missing, malformed, tampered, wrong-version, or expired tokens.
 *
 * Structural checks run before the secret is read, so requests without a
 * usable cookie never require configuration. A forged cookie is still
 * rejected: nothing here is a permission, but one guest must not be able to
 * hand themselves another guest's favorites by editing a cookie value.
 */
export async function verifyGuestSession(
  token: string | null | undefined,
): Promise<GallerySession | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [prefix, payload, signature] = parts;
  if (prefix !== TOKEN_PREFIX || !payload || !signature) return null;
  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return null;

  const key = await importSessionKey(["verify"]);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes as BufferSource,
    new TextEncoder().encode(`${prefix}.${payload}`),
  );
  if (!valid) return null;

  const payloadBytes = fromBase64Url(payload);
  if (!payloadBytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  const session = parseGallerySession(parsed);
  if (!session) return null;

  const now = Math.floor(Date.now() / 1000);
  if (session.issuedAt > now + CLOCK_SKEW_SECONDS) return null;
  if (session.expiresAt <= now) return null;
  if (session.expiresAt - session.issuedAt > GUEST_SESSION_MAX_AGE_SECONDS) {
    return null;
  }
  return session;
}

/**
 * The guest identity for the current request, for Server Components, Route
 * Handlers, and Server Actions. Never throws and never denies: a caller with
 * no cookie, a stale cookie, a forged cookie, or an unconfigured secret gets
 * a fresh ephemeral session instead.
 *
 * src/proxy.ts sets the cookie on the way in, so in practice the ephemeral
 * branch is only reached by a request that never passed through it. The cost
 * of landing there is continuity, not access: favorites written against an
 * ephemeral id are not findable on the next request.
 */
export async function getGuestSession(): Promise<GallerySession> {
  // Dynamic import keeps next/headers out of proxy.ts's module graph
  // (request-scoped APIs are not available in the proxy runtime).
  const { cookies } = await import("next/headers");
  const token = (await cookies()).get(GUEST_SESSION_COOKIE)?.value;
  try {
    const session = await verifyGuestSession(token);
    if (session) return session;
  } catch (error) {
    if (!(error instanceof GalleryAccessConfigError)) throw error;
  }
  return newSession();
}
