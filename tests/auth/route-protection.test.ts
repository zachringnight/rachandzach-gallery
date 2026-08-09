/**
 * Proxy + admin tests.
 *
 * The default-deny contract these started life as is gone: the password gate
 * was removed on 2026-08-09, and the proxy no longer refuses anyone. What is
 * asserted now is what replaced it --
 *
 *   - every route answers an anonymous request, including the ones that used
 *     to redirect to /enter;
 *   - the guest identity cookie is issued on the way past, and an existing
 *     one is left alone;
 *   - a forged cookie is still not honoured (identity, not permission);
 *   - /admin and /api/admin are the exception and are still gated, and a
 *     guest cookie still grants nothing there;
 *   - the security headers ride every response.
 *
 * requireAdmin is proven against a mocked Supabase server client (no live
 * database exists locally).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";
import nextConfig from "../../next.config";
import {
  GUEST_SESSION_COOKIE,
  createGuestSession,
  verifyGuestSession,
} from "@/lib/auth/guest-session";
import {
  ADMIN_EMAIL_ALLOWLIST,
  AdminAccessError,
  requireAdmin,
} from "@/lib/auth/admin-session";
import {
  securityHeaderEntries,
  securityHeaders,
} from "@/lib/auth/security-headers";

const TEST_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

function makeRequest(
  path: string,
  cookies?: Record<string, string>,
): NextRequest {
  const headers = new Headers();
  if (cookies) {
    headers.set(
      "cookie",
      Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
    );
  }
  return new NextRequest(`https://gallery.test${path}`, { headers });
}

function expectPassThrough(response: Response, label: string) {
  expect(response.status, `${label} should pass through`).toBe(200);
  expect(response.headers.get("location"), label).toBeNull();
}

/** The session token the response tells the browser to keep, if any. */
function issuedToken(response: Response): string | null {
  const header = response.headers.get("set-cookie");
  if (!header) return null;
  const match = header.match(new RegExp(`${GUEST_SESSION_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function expectSecurityHeaders(response: Response) {
  const csp = response.headers.get("content-security-policy");
  expect(csp).not.toBeNull();
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("default-src 'self'");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("referrer-policy")).toBe(
    "strict-origin-when-cross-origin",
  );
  expect(response.headers.get("x-frame-options")).toBe("DENY");
}

beforeEach(() => {
  vi.stubEnv("GALLERY_SESSION_SECRET", TEST_SECRET);
  getUserMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy: the whole site answers anonymous requests", () => {
  // Everything below used to be behind the shared password. A diff that adds
  // a path here is not a security change any more; a diff that makes one of
  // these stop returning 200 is.
  const openPaths = [
    // The archive itself: this is the URL guests were given.
    "/",
    "/photos",
    "/my-weekend",
    "/add-yours",
    "/favorites",
    "/submissions",
    "/playlists",
    "/weekend",
    // The fundraiser, public all along.
    "/nyc",
    "/marathon",
    "/nyc/nyc-share.jpg",
    // Crawler files and brand collateral.
    "/robots.txt",
    "/sitemap.xml",
    "/brand/0719-co-outline.svg",
    // Story derivatives: the hero was public, the other five were not.
    "/story/hero-sunset-a6fa78bb.jpg",
    "/story/coast-1dc07dd8.jpg",
    "/story/after-party-e8e24926.jpg",
    // Photography that only a signed-in guest could reach before.
    "/gallery-assets/full/wedding-0001.jpg",
    // APIs, which used to answer 401 JSON.
    "/api/gallery",
    "/api/search",
    "/api/uploads",
    "/api/downloads",
    "/auth/callback",
    // A route nobody has listed: there is no allowlist left to be off.
    "/some-brand-new-route",
  ];

  for (const path of openPaths) {
    it(`serves ${path} with no session`, async () => {
      const response = await proxy(makeRequest(path));
      expectPassThrough(response, path);
      expectSecurityHeaders(response);
    });
  }

  it("no longer redirects anyone to the door that used to exist", async () => {
    for (const path of ["/", "/photos?event=wedding", "/api/gallery"]) {
      const response = await proxy(makeRequest(path));
      expect(response.status, path).toBe(200);
      expect(response.headers.get("location"), path).toBeNull();
    }
  });
});

describe("proxy: the guest identity cookie", () => {
  it("issues a valid session to a caller who arrives without one", async () => {
    const response = await proxy(makeRequest("/photos"));
    const token = issuedToken(response);
    expect(token).not.toBeNull();
    await expect(verifyGuestSession(token)).resolves.not.toBeNull();
  });

  it("marks the cookie httpOnly and same-site lax", async () => {
    const response = await proxy(makeRequest("/photos"));
    const header = response.headers.get("set-cookie") ?? "";
    expect(header.toLowerCase()).toContain("httponly");
    expect(header.toLowerCase()).toContain("samesite=lax");
  });

  it("leaves an existing valid session alone", async () => {
    const token = await createGuestSession();
    const response = await proxy(
      makeRequest("/photos", { [GUEST_SESSION_COOKIE]: token }),
    );
    expectPassThrough(response, "/photos with session");
    expect(issuedToken(response)).toBeNull();
  });

  it("replaces a tampered cookie instead of honouring it", async () => {
    const token = await createGuestSession();
    const real = await verifyGuestSession(token);
    const response = await proxy(
      makeRequest("/photos", { [GUEST_SESSION_COOKIE]: `${token}x` }),
    );
    expectPassThrough(response, "/photos with tampered cookie");
    const issued = issuedToken(response);
    expect(issued).not.toBeNull();
    const session = await verifyGuestSession(issued);
    expect(session!.sessionId).not.toBe(real!.sessionId);
  });

  it("serves the page anyway when the secret is missing, without a cookie", async () => {
    // Fail soft: an unconfigured secret costs favorites continuity, not the
    // site. This used to be a 500 on every gated route.
    vi.stubEnv("GALLERY_SESSION_SECRET", "");
    const response = await proxy(
      makeRequest("/photos", { [GUEST_SESSION_COOKIE]: "v1.payload.sig" }),
    );
    expectPassThrough(response, "/photos without a secret");
    expect(issuedToken(response)).toBeNull();
  });
});

describe("proxy: admin routes are still gated", () => {
  it("redirects /admin away, even with a valid guest cookie", async () => {
    const token = await createGuestSession();
    const response = await proxy(
      makeRequest("/admin", { [GUEST_SESSION_COOKIE]: token }),
    );
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") as string).pathname).toBe(
      "/",
    );
  });

  it("returns 401 for /api/admin even with a valid guest cookie", async () => {
    const token = await createGuestSession();
    const response = await proxy(
      makeRequest("/api/admin/moderation", { [GUEST_SESSION_COOKIE]: token }),
    );
    expect(response.status).toBe(401);
  });

  it("never hands an admin path a guest cookie on the way out", async () => {
    const response = await proxy(
      makeRequest("/admin", { "sb-rnfvmqflktghriqefatc-auth-token": "opaque" }),
    );
    expectPassThrough(response, "/admin with sb cookie");
    expect(issuedToken(response)).toBeNull();
  });

  it("recognizes chunked Supabase auth cookies", async () => {
    const response = await proxy(
      makeRequest("/admin", {
        "sb-rnfvmqflktghriqefatc-auth-token.0": "part0",
      }),
    );
    expectPassThrough(response, "/admin with chunked sb cookie");
  });
});

describe("requireAdmin", () => {
  it("returns the userId and email for the allowed admin", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-1", email: "wedding@rachandzach.com" } },
      error: null,
    });
    await expect(requireAdmin()).resolves.toEqual({
      userId: "user-1",
      email: "wedding@rachandzach.com",
    });
  });

  it("lowercases the email before the exact allowlist match", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-1", email: "Wedding@RachAndZach.com" } },
      error: null,
    });
    await expect(requireAdmin()).resolves.toEqual({
      userId: "user-1",
      email: "wedding@rachandzach.com",
    });
  });

  it("rejects any other authenticated user", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-2", email: "guest@example.com" } },
      error: null,
    });
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminAccessError);
  });

  it("rejects when no user is signed in", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminAccessError);
  });

  it("rejects when Supabase reports an auth error", async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid token" },
    });
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminAccessError);
  });

  it("never consults the guest session (a guest cookie grants nothing)", async () => {
    // Even with a mintable guest session in the environment, requireAdmin
    // only trusts the Supabase user.
    await createGuestSession();
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminAccessError);
  });

  it("pins the allowlist to exactly the wedding admin address", () => {
    expect(ADMIN_EMAIL_ALLOWLIST).toEqual(["wedding@rachandzach.com"]);
  });
});

describe("security headers", () => {
  it("omits provider origins until that provider is configured", () => {
    const prod = securityHeaders({
      dev: false,
      googleDriveEnabled: false,
      dropboxEnabled: false,
    })["Content-Security-Policy"];
    const dev = securityHeaders({
      dev: true,
      googleDriveEnabled: false,
      dropboxEnabled: false,
    })["Content-Security-Policy"];
    expect(prod).not.toContain("'unsafe-eval'");
    expect(dev).toContain("'unsafe-eval'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).not.toContain("https://accounts.google.com");
    expect(prod).not.toContain("https://www.googleapis.com");
    expect(prod).not.toContain("https://www.dropbox.com");
    expect(prod).not.toContain("https://api.dropboxapi.com");
    expect(prod).toContain("frame-src 'none'");
    expect(
      securityHeaders({
        dev: false,
        googleDriveEnabled: false,
        dropboxEnabled: false,
      })["Cross-Origin-Opener-Policy"],
    ).toBe("same-origin");
  });

  it("opens only Google origins when Drive is configured", () => {
    const headers = securityHeaders({
      dev: false,
      googleDriveEnabled: true,
      dropboxEnabled: false,
    });
    const csp = headers["Content-Security-Policy"];
    expect(csp).toContain("https://accounts.google.com/gsi/client");
    expect(csp).toContain("https://accounts.google.com/gsi/");
    expect(csp).toContain("https://www.googleapis.com");
    expect(csp).not.toContain("https://www.dropbox.com");
    expect(csp).not.toContain("https://api.dropboxapi.com");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe(
      "same-origin-allow-popups",
    );
  });

  it("pins Dropbox script access to Saver's exact path", () => {
    const headers = securityHeaders({
      dev: false,
      googleDriveEnabled: false,
      dropboxEnabled: true,
    });
    const csp = headers["Content-Security-Policy"];
    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' https://www.dropbox.com/static/api/2/dropins.js",
    );
    expect(csp).toContain("https://api.dropboxapi.com");
    expect(csp).not.toContain("https://accounts.google.com");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe(
      "same-origin-allow-popups",
    );
  });

  it("next.config.ts serves the same header set for every route", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const catchAll = rules.find((rule) => rule.source === "/(.*)");
    expect(catchAll).toBeDefined();
    expect(catchAll!.headers).toEqual(securityHeaderEntries());
  });
});
