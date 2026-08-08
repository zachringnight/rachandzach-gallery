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

import { isOpenAccess } from "@/lib/auth/open-access";

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
 *
 * WHOLE-SITE GATE (2026-07-30). This list used to carry the marketing pages
 * too: "/", "/weekend" and "/playlists" were all readable by anyone. Zach
 * asked for the whole site behind the password, with the fundraiser as the
 * single deliberate exception, so those three moved behind the gate along
 * with the four story derivatives only they rendered. What remains here is
 * exactly three things: the fundraiser, the door, and the files a browser or
 * crawler must fetch anonymously before it can reach the door.
 */
export const PUBLIC_ROUTES = {
  /** Exact-match public paths. */
  exact: [
    // THE EXCEPTION. /nyc is a fundraiser with a deadline and its whole job
    // is to be findable and shareable; a password on it raises nothing.
    // Kept public knowingly, on the owner's call. /marathon is its 308 alias
    // (see legacyRedirects) and is listed so the redirect resolves without a
    // detour through /enter.
    "/nyc",
    "/marathon",
    // Public collateral for /nyc (see src/content/nyc.ts). These are the only
    // files in public/nyc/, and every one of them is deliberately servable
    // without a guest session: the hero photo, the 1200x630 link-preview card
    // that social apps fetch anonymously, and the optional saved still of
    // Rachel's Instagram post. A new asset under public/nyc/ that is not
    // listed here 404s behind the password gate.
    "/nyc/rachel-running.jpg",
    "/nyc/nyc-share.jpg",
    "/nyc/instagram-post.jpg",
    // The door, and the two crawler files that are worthless if they answer
    // an anonymous request with a redirect to the door.
    "/enter",
    "/robots.txt",
    "/sitemap.xml",
    "/favicon.ico",
    // The hero derivative /enter renders beside its password form, in both
    // its desktop and mobile sources (src/app/(access)/enter/page.tsx). Named
    // files, not the old "/story" prefix: the other four picks are only used
    // by the now-gated home page, and naming them one by one means a new
    // derivative dropped into public/story/ is private by default instead of
    // public by accident. story-photos.ts stamps each filename with the first
    // 8 chars of its image hash, so re-exporting the hero changes this path --
    // tests/auth/route-protection.test.ts asserts these against the live
    // storyPhotos value so that drift fails CI instead of 404ing on /enter.
    "/story/hero-sunset-a6fa78bb.jpg",
    "/story/hero-sunset-mobile-adobe.png",
  ],
  /** Prefix-match public paths (the prefix itself or prefix + "/..."). */
  prefixes: [
    "/api/access",
    "/auth/callback",
    // The 0719 + co. mark, rendered by /enter's own header and by /nyc.
    // public/brand/ holds one outline SVG and no photography.
    "/brand",
    "/_next/static",
    "/_next/image",
    // Vercel Analytics and Speed Insights, mounted in the root layout on
    // every page including public /nyc. These are first-party paths served by
    // the platform, not routes of ours, and they carry no gallery media. Left
    // out of the allowlist they were default-denied like anything else: an
    // anonymous visitor to the fundraiser page fetched the script, received a
    // 307 to /enter, and recorded no pageview or vitals -- so the field
    // instrumentation added in #15 measured nothing on the one page whose
    // traffic is the point.
    "/_vercel",
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
  // Open-access mode: see src/lib/auth/open-access.ts. The proxy is only the
  // first gate -- every guest page and API also calls this, by design -- so
  // the check has to live in both places or the archive stays locked.
  if (isOpenAccess()) {
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
