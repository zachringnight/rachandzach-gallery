/**
 * Guest session unit tests (packet 04).
 *
 * Covers the packet-required cases: valid, expired, tampered, wrong-version,
 * and missing-secret tokens, plus the redirect sanitizer, the PUBLIC_ROUTES
 * allowlist shape, and the rate-limit helpers with the Supabase RPC boundary
 * mocked at the client seam (no live database exists locally).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GUEST_SESSION_COOKIE,
  GUEST_SESSION_MAX_AGE_SECONDS,
  GalleryAccessConfigError,
  GalleryAccessError,
  PUBLIC_ROUTES,
  createGuestSession,
  isPublicRoute,
  requireGalleryAccess,
  sanitizeNextPath,
  verifyGuestSession,
} from "@/lib/auth/guest-session";
import {
  LOGIN_GLOBAL_RATE_LIMIT,
  LOGIN_IP_RATE_LIMIT,
  RATE_LIMIT_RPC,
  consumeRateLimit,
  hashRateLimitKey,
  type RateLimitClient,
} from "@/lib/auth/rate-limit";

const TEST_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// Cookie holder for the next/headers mock used by requireGalleryAccess tests.
const cookieJar = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "rz_gallery_session" && cookieJar.value !== undefined
        ? { name, value: cookieJar.value }
        : undefined,
  }),
}));

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64url"));
}

async function hmacSign(signingInput: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput),
  );
  return toBase64Url(new Uint8Array(signature));
}

async function craftToken(
  prefix: string,
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const encoded = toBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signingInput = `${prefix}.${encoded}`;
  return `${signingInput}.${await hmacSign(signingInput, secret)}`;
}

beforeEach(() => {
  vi.stubEnv("GALLERY_SESSION_SECRET", TEST_SECRET);
  cookieJar.value = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("createGuestSession / verifyGuestSession", () => {
  it("round-trips a valid token", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await createGuestSession();
    const after = Math.floor(Date.now() / 1000);

    expect(token.startsWith("v1.")).toBe(true);
    expect(token.split(".")).toHaveLength(3);

    const session = await verifyGuestSession(token);
    expect(session).not.toBeNull();
    expect(session?.version).toBe(1);
    expect(typeof session?.sessionId).toBe("string");
    expect(session?.sessionId.length).toBeGreaterThan(0);
    expect(session?.issuedAt).toBeGreaterThanOrEqual(before);
    expect(session?.issuedAt).toBeLessThanOrEqual(after + 1);
    expect(session!.expiresAt - session!.issuedAt).toBe(
      GUEST_SESSION_MAX_AGE_SECONDS,
    );
  });

  it("mints a distinct sessionId per session", async () => {
    const a = await verifyGuestSession(await createGuestSession());
    const b = await verifyGuestSession(await createGuestSession());
    expect(a?.sessionId).not.toBe(b?.sessionId);
  });

  it("rejects an expired token", async () => {
    const token = await createGuestSession();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (GUEST_SESSION_MAX_AGE_SECONDS + 60) * 1000);
    await expect(verifyGuestSession(token)).resolves.toBeNull();
  });

  it("still accepts a token just inside its expiry window", async () => {
    const token = await createGuestSession();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (GUEST_SESSION_MAX_AGE_SECONDS - 60) * 1000);
    await expect(verifyGuestSession(token)).resolves.not.toBeNull();
  });

  it("rejects a token with a tampered payload", async () => {
    const token = await createGuestSession();
    const [prefix, payload, signature] = token.split(".");
    const decoded = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payload)),
    ) as Record<string, unknown>;
    decoded.expiresAt = (decoded.expiresAt as number) + 999_999;
    const tamperedPayload = toBase64Url(
      new TextEncoder().encode(JSON.stringify(decoded)),
    );
    await expect(
      verifyGuestSession(`${prefix}.${tamperedPayload}.${signature}`),
    ).resolves.toBeNull();
  });

  it("rejects a token with a tampered signature", async () => {
    const token = await createGuestSession();
    const [prefix, payload, signature] = token.split(".");
    const flipped =
      (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    await expect(
      verifyGuestSession(`${prefix}.${payload}.${flipped}`),
    ).resolves.toBeNull();
  });

  it("rejects a correctly signed token with an unknown version prefix", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await craftToken(
      "v2",
      { sessionId: "abc", issuedAt: now, expiresAt: now + 3600, version: 2 },
      TEST_SECRET,
    );
    await expect(verifyGuestSession(token)).resolves.toBeNull();
  });

  it("rejects a v1-prefixed token whose payload claims a different version", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await craftToken(
      "v1",
      { sessionId: "abc", issuedAt: now, expiresAt: now + 3600, version: 2 },
      TEST_SECRET,
    );
    await expect(verifyGuestSession(token)).resolves.toBeNull();
  });

  it("rejects a token that claims a longer life than the policy allows", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await craftToken(
      "v1",
      {
        sessionId: "abc",
        issuedAt: now,
        expiresAt: now + GUEST_SESSION_MAX_AGE_SECONDS * 10,
        version: 1,
      },
      TEST_SECRET,
    );
    await expect(verifyGuestSession(token)).resolves.toBeNull();
  });

  it("returns null for missing and malformed tokens without needing the secret", async () => {
    vi.stubEnv("GALLERY_SESSION_SECRET", "");
    await expect(verifyGuestSession(undefined)).resolves.toBeNull();
    await expect(verifyGuestSession("")).resolves.toBeNull();
    await expect(verifyGuestSession("garbage")).resolves.toBeNull();
    await expect(verifyGuestSession("v1.only-two")).resolves.toBeNull();
    await expect(verifyGuestSession("a.b.c.d")).resolves.toBeNull();
    await expect(verifyGuestSession("v2.abc.def")).resolves.toBeNull();
  });

  it("fails closed with a configuration error when the secret is missing", async () => {
    const token = await createGuestSession();
    vi.stubEnv("GALLERY_SESSION_SECRET", "");
    await expect(createGuestSession()).rejects.toBeInstanceOf(
      GalleryAccessConfigError,
    );
    await expect(createGuestSession()).rejects.toThrow(
      /GALLERY_SESSION_SECRET/,
    );
    await expect(verifyGuestSession(token)).rejects.toBeInstanceOf(
      GalleryAccessConfigError,
    );
  });

  it("fails closed when the secret is shorter than 32 bytes", async () => {
    vi.stubEnv("GALLERY_SESSION_SECRET", "too-short");
    await expect(createGuestSession()).rejects.toThrow(/32/);
  });
});

describe("requireGalleryAccess", () => {
  it("returns the session for a valid cookie", async () => {
    cookieJar.value = await createGuestSession();
    const session = await requireGalleryAccess();
    expect(session.version).toBe(1);
  });

  it("throws GalleryAccessError when the cookie is missing", async () => {
    cookieJar.value = undefined;
    await expect(requireGalleryAccess()).rejects.toBeInstanceOf(
      GalleryAccessError,
    );
  });

  it("throws GalleryAccessError for a tampered cookie", async () => {
    const token = await createGuestSession();
    cookieJar.value = `${token}x`;
    await expect(requireGalleryAccess()).rejects.toBeInstanceOf(
      GalleryAccessError,
    );
  });
});

describe("sanitizeNextPath", () => {
  it("accepts plain relative paths, preserving query strings", () => {
    expect(sanitizeNextPath("/photos")).toBe("/photos");
    expect(sanitizeNextPath("/photos?event=wedding")).toBe(
      "/photos?event=wedding",
    );
    expect(sanitizeNextPath("/my-weekend", "/x")).toBe("/my-weekend");
  });

  it("rejects absolute URLs", () => {
    expect(sanitizeNextPath("https://evil.example/steal")).toBe("/");
    expect(sanitizeNextPath("http://evil.example")).toBe("/");
    expect(sanitizeNextPath("javascript:alert(1)")).toBe("/");
  });

  it("rejects protocol-relative URLs", () => {
    expect(sanitizeNextPath("//evil.example")).toBe("/");
    expect(sanitizeNextPath("//evil.example/photos")).toBe("/");
  });

  it("rejects backslash and control-character tricks", () => {
    expect(sanitizeNextPath("/\\evil.example")).toBe("/");
    expect(sanitizeNextPath("/photos\\..\\admin")).toBe("/");
    expect(sanitizeNextPath("/photos\r\nSet-Cookie: x=1")).toBe("/");
  });

  it("rejects paths without a leading slash and empty input", () => {
    expect(sanitizeNextPath("photos")).toBe("/");
    expect(sanitizeNextPath("")).toBe("/");
    expect(sanitizeNextPath(undefined)).toBe("/");
    expect(sanitizeNextPath(null)).toBe("/");
  });

  it("avoids /enter redirect loops", () => {
    expect(sanitizeNextPath("/enter", "/photos")).toBe("/photos");
    expect(sanitizeNextPath("/enter?next=/enter", "/photos")).toBe("/photos");
  });

  it("honors the provided fallback", () => {
    expect(sanitizeNextPath("https://evil.example", "/photos")).toBe("/photos");
  });
});

describe("PUBLIC_ROUTES / isPublicRoute", () => {
  it("keeps the packet's public list open", () => {
    for (const path of [
      "/",
      "/weekend",
      "/nyc",
      "/nyc/rachel-running.jpg",
      "/playlists",
      "/marathon",
      "/enter",
      "/robots.txt",
      "/sitemap.xml",
      "/api/access/login",
      "/api/access/logout",
      "/auth/callback",
      "/brand/0719-co-outline.svg",
    ]) {
      expect(isPublicRoute(path), path).toBe(true);
    }
  });

  it("defaults to protected for everything else", () => {
    for (const path of [
      "/photos",
      "/my-weekend",
      "/add-yours",
      "/favorites",
      "/submissions",
      "/api/gallery",
      "/api/search",
      "/api/uploads",
      "/api/downloads",
      "/admin",
      "/api/admin",
      "/gallery-assets/full/wedding-1.jpg",
      "/some-brand-new-route",
    ]) {
      expect(isPublicRoute(path), path).toBe(false);
    }
  });

  it("does not leak protection through prefix-shaped names", () => {
    // Exact entries must not act as prefixes and prefixes must respect
    // segment boundaries.
    expect(isPublicRoute("/enterprise")).toBe(false);
    expect(isPublicRoute("/weekend-recap")).toBe(false);
    expect(isPublicRoute("/brandnew")).toBe(false);
    expect(isPublicRoute("/api/access-logs")).toBe(false);
  });

  it("exports the allowlist for the proxy and route tests", () => {
    expect(PUBLIC_ROUTES.exact).toContain("/");
    expect(PUBLIC_ROUTES.exact).toContain("/enter");
    expect(PUBLIC_ROUTES.prefixes).toContain("/api/access");
    // The cookie name is pinned by the packet.
    expect(GUEST_SESSION_COOKIE).toBe("rz_gallery_session");
  });
});

describe("hashRateLimitKey", () => {
  it("is deterministic for the same inputs", async () => {
    const a = await hashRateLimitKey("203.0.113.9", "guest_login_ip");
    const b = await hashRateLimitKey("203.0.113.9", "guest_login_ip");
    expect(a).toBe(b);
  });

  it("produces lowercase hex output, never the raw identifier", async () => {
    const hash = await hashRateLimitKey("203.0.113.9", "guest_login_ip");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("203.0.113.9");
  });

  it("differs by ip and by action", async () => {
    const base = await hashRateLimitKey("203.0.113.9", "guest_login_ip");
    expect(await hashRateLimitKey("203.0.113.10", "guest_login_ip")).not.toBe(
      base,
    );
    expect(await hashRateLimitKey("203.0.113.9", "other_action")).not.toBe(
      base,
    );
  });

  it("fails closed without the secret", async () => {
    vi.stubEnv("GALLERY_SESSION_SECRET", "");
    await expect(
      hashRateLimitKey("203.0.113.9", "guest_login_ip"),
    ).rejects.toBeInstanceOf(GalleryAccessConfigError);
  });
});

describe("consumeRateLimit", () => {
  const input = {
    keyHash: "a".repeat(64),
    action: LOGIN_IP_RATE_LIMIT.action,
    attemptLimit: LOGIN_IP_RATE_LIMIT.attemptLimit,
    windowSeconds: LOGIN_IP_RATE_LIMIT.windowSeconds,
  };

  function clientReturning(result: { data: unknown; error: unknown }) {
    const rpc = vi.fn(async () => result);
    return { client: { rpc } as unknown as RateLimitClient, rpc };
  }

  it("allows when the RPC returns true and passes the renamed RPC and args", async () => {
    const { client, rpc } = clientReturning({ data: true, error: null });
    await expect(consumeRateLimit(client, input)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(RATE_LIMIT_RPC, {
      key_hash: input.keyHash,
      action: input.action,
      attempt_limit: input.attemptLimit,
      window_seconds: input.windowSeconds,
    });
    expect(RATE_LIMIT_RPC).toBe("rachandzach_consume_rate_limit");
  });

  it("denies when the RPC returns false", async () => {
    const { client } = clientReturning({ data: false, error: null });
    await expect(consumeRateLimit(client, input)).resolves.toBe(false);
  });

  it("fails closed on an RPC error", async () => {
    const { client } = clientReturning({
      data: null,
      error: { message: "boom" },
    });
    await expect(consumeRateLimit(client, input)).resolves.toBe(false);
  });

  it("fails closed when the RPC throws", async () => {
    const rpc = vi.fn(async () => {
      throw new Error("network down");
    });
    const client = { rpc } as unknown as RateLimitClient;
    await expect(consumeRateLimit(client, input)).resolves.toBe(false);
  });

  it("fails closed on a non-boolean response", async () => {
    const { client } = clientReturning({ data: "true", error: null });
    await expect(consumeRateLimit(client, input)).resolves.toBe(false);
  });

  it("pins the packet's login limits", () => {
    expect(LOGIN_IP_RATE_LIMIT.attemptLimit).toBe(5);
    expect(LOGIN_IP_RATE_LIMIT.windowSeconds).toBe(15 * 60);
    expect(LOGIN_GLOBAL_RATE_LIMIT.windowSeconds).toBe(15 * 60);
    expect(LOGIN_GLOBAL_RATE_LIMIT.attemptLimit).toBeGreaterThan(
      LOGIN_IP_RATE_LIMIT.attemptLimit,
    );
  });
});
