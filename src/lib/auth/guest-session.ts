/**
 * Guest session layer for the gallery (packet 04).
 *
 * Signed, versioned guest sessions carried in the rz_gallery_session cookie.
 * Everything here fails closed: GALLERY_SESSION_SECRET must be set (at least
 * 32 random bytes) before any token can be minted or verified. There is no
 * fallback secret, no default password, and no dev bypass. Missing
 * configuration throws GalleryAccessConfigError at runtime; the build never
 * needs the secret because it is read lazily inside each call.
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

/** Configuration is missing or unusable. Surfaced loudly, never papered over. */
export class GalleryAccessConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GalleryAccessConfigError";
  }
}

/** The caller has no valid guest session. Route handlers map this to 401. */
export class GalleryAccessError extends Error {
  readonly status = 401;

  constructor(message = "Gallery access requires a valid guest session.") {
    super(message);
    this.name = "GalleryAccessError";
  }
}

/**
 * Default-deny allowlist. proxy.ts and the route tests consume this: any
 * route NOT matched here requires a valid guest session (admin routes are
 * carved out separately and require Supabase admin auth instead). Add a route
 * here only when it is deliberately public.
 */
export const PUBLIC_ROUTES = {
  /** Exact-match public paths. */
  exact: [
    "/",
    "/weekend",
    "/nyc",
    "/nyc/rachel-running.jpg",
    "/playlists",
    "/marathon",
    "/enter",
    "/robots.txt",
    "/sitemap.xml",
    "/favicon.ico",
  ],
  /** Prefix-match public paths (the prefix itself or prefix + "/..."). */
  prefixes: [
    "/api/access",
    "/auth/callback",
    "/brand",
    // The six curated story derivatives in public/story/ (see
    // src/content/story-photos.ts). Rendered on the public / and /weekend
    // pages, so they must be served without a guest session; the full
    // gallery media never lives under this path.
    "/story",
    "/_next/static",
    "/_next/image",
  ],
} as const;

export function isPublicRoute(pathname: string): boolean {
  if ((PUBLIC_ROUTES.exact as readonly string[]).includes(pathname)) {
    return true;
  }
  return PUBLIC_ROUTES.prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Redirect convention: next=/relative/path only. Absolute URLs,
 * protocol-relative URLs, backslashes, control characters, and /enter loops
 * all collapse to the fallback.
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
  if (raw === "/enter" || raw.startsWith("/enter/") || raw.startsWith("/enter?")) {
    return fallback;
  }
  return raw;
}

/** Cookie attributes pinned by the packet. */
export function guestSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_SESSION_MAX_AGE_SECONDS,
  };
}

// --- Secret handling (server-only, read lazily, fail closed) ---------------

/**
 * Reads and validates GALLERY_SESSION_SECRET. Exported for the rate-limit
 * module's key derivation only; never expose the return value to clients,
 * logs, or error messages.
 */
export function readSessionSecretBytes(): Uint8Array {
  const raw = process.env.GALLERY_SESSION_SECRET;
  if (!raw || raw.trim().length === 0) {
    throw new GalleryAccessConfigError(
      "GALLERY_SESSION_SECRET is not set. Guest sessions fail closed by design: " +
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

/**
 * Mints a signed guest session token: `v1.<base64url payload>.<base64url
 * HMAC-SHA256 signature>`. Throws GalleryAccessConfigError when the secret
 * is missing or too short.
 */
export async function createGuestSession(): Promise<string> {
  const key = await importSessionKey(["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const session: GallerySession = {
    sessionId: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: now + GUEST_SESSION_MAX_AGE_SECONDS,
    version: SESSION_TOKEN_VERSION,
  };
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
 * usable cookie never require configuration. Once a structurally plausible
 * token must actually be verified, a missing secret throws
 * GalleryAccessConfigError (fail closed, never fail open).
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
 * Server-side guard for Server Components, Route Handlers, and Server
 * Actions. The proxy already gates page navigation, but per the platform
 * spike, proxy matchers can silently exclude server functions, so every
 * data-touching code path must call this again. Throws GalleryAccessError
 * (401) when no valid session exists; configuration problems propagate as
 * GalleryAccessConfigError.
 */
export async function requireGalleryAccess(): Promise<GallerySession> {
  // Open-access mode (OPEN_ACCESS=1, Vercel Preview only): the guest password
  // is removed entirely, per Zach on 2026-07-26. The proxy is only the first
  // gate -- every guest page and API also calls this, by design -- so the flag
  // has to be honoured in both places or the archive stays locked.
  //
  // While this is on, the whole archive is public to anyone with a URL. It is
  // a flag rather than a deletion so it cannot ride a merge into production.
  if (process.env.OPEN_ACCESS === "1") {
    const now = Math.floor(Date.now() / 1000);
    return {
      sessionId: "open-access",
      issuedAt: now,
      expiresAt: now + 3600,
      version: SESSION_TOKEN_VERSION,
    };
  }

  // Dynamic import keeps next/headers out of proxy.ts's module graph
  // (request-scoped APIs are not available in the proxy runtime).
  const { cookies } = await import("next/headers");
  const token = (await cookies()).get(GUEST_SESSION_COOKIE)?.value;
  const session = await verifyGuestSession(token);
  if (!session) {
    throw new GalleryAccessError();
  }
  return session;
}
