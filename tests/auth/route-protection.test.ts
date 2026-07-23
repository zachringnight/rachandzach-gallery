/**
 * Route-protection tests (packet 04).
 *
 * Proves the default-deny contract at the proxy layer: public routes stay
 * open, guest routes redirect to /enter, API routes return 401 JSON, admin
 * routes never accept a guest cookie, unlisted routes are protected, and the
 * security headers ride every response. requireAdmin is proven against a
 * mocked Supabase server client (no live database exists locally).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";
import nextConfig from "../../next.config";
import {
  GUEST_SESSION_COOKIE,
  createGuestSession,
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

function expectRedirectToEnter(response: Response, expectedNext: string) {
  expect(response.status).toBe(307);
  const location = response.headers.get("location");
  expect(location).not.toBeNull();
  const url = new URL(location as string);
  expect(url.pathname).toBe("/enter");
  expect(url.searchParams.get("next")).toBe(expectedNext);
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

describe("proxy: public routes stay open", () => {
  const publicPaths = [
    "/",
    "/weekend",
    "/playlists",
    "/marathon",
    "/enter",
    "/robots.txt",
    "/sitemap.xml",
    "/api/access/login",
    "/api/access/logout",
    "/auth/callback",
    "/brand/0719-co-outline.svg",
  ];

  for (const path of publicPaths) {
    it(`lets ${path} through with no session`, async () => {
      const response = await proxy(makeRequest(path));
      expectPassThrough(response, path);
      expectSecurityHeaders(response);
    });
  }

  it("works even when no secret is configured (public pages never verify)", async () => {
    vi.stubEnv("GALLERY_SESSION_SECRET", "");
    const response = await proxy(makeRequest("/weekend"));
    expectPassThrough(response, "/weekend");
  });
});

describe("proxy: guest routes require a session", () => {
  const guestPages = [
    "/photos",
    "/my-weekend",
    "/add-yours",
    "/favorites",
    "/submissions",
  ];

  for (const path of guestPages) {
    it(`redirects ${path} to /enter without a session`, async () => {
      const response = await proxy(makeRequest(path));
      expectRedirectToEnter(response, path);
      expectSecurityHeaders(response);
    });
  }

  it("preserves the query string in the next parameter", async () => {
    const response = await proxy(makeRequest("/photos?event=wedding"));
    expectRedirectToEnter(response, "/photos?event=wedding");
  });

  it("defaults to protected for a route nobody has listed", async () => {
    const response = await proxy(makeRequest("/some-brand-new-route"));
    expectRedirectToEnter(response, "/some-brand-new-route");
  });

  it("keeps legacy static gallery assets protected", async () => {
    const response = await proxy(
      makeRequest("/gallery-assets/full/wedding-0001.jpg"),
    );
    expect(response.status).toBe(307);
  });

  it("returns 401 JSON for protected API routes instead of redirecting", async () => {
    for (const path of [
      "/api/gallery",
      "/api/search",
      "/api/uploads",
      "/api/downloads",
    ]) {
      const response = await proxy(makeRequest(path));
      expect(response.status, path).toBe(401);
      expect(response.headers.get("location"), path).toBeNull();
      expect(response.headers.get("content-type"), path).toContain("json");
      expectSecurityHeaders(response);
    }
  });

  it("lets a valid guest session through to pages and APIs", async () => {
    const token = await createGuestSession();
    const page = await proxy(
      makeRequest("/photos", { [GUEST_SESSION_COOKIE]: token }),
    );
    expectPassThrough(page, "/photos with session");
    expectSecurityHeaders(page);

    const api = await proxy(
      makeRequest("/api/gallery", { [GUEST_SESSION_COOKIE]: token }),
    );
    expectPassThrough(api, "/api/gallery with session");
  });

  it("rejects a tampered guest cookie", async () => {
    const token = await createGuestSession();
    const response = await proxy(
      makeRequest("/photos", { [GUEST_SESSION_COOKIE]: `${token}x` }),
    );
    expectRedirectToEnter(response, "/photos");
  });

  it("fails closed with a clear configuration error when the secret is missing at verify time", async () => {
    vi.stubEnv("GALLERY_SESSION_SECRET", "");
    const response = await proxy(
      makeRequest("/photos", { [GUEST_SESSION_COOKIE]: "v1.payload.sig" }),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("GALLERY_SESSION_SECRET");
  });
});

describe("proxy: admin routes never accept a guest session", () => {
  it("redirects /admin even with a valid guest cookie", async () => {
    const token = await createGuestSession();
    const response = await proxy(
      makeRequest("/admin", { [GUEST_SESSION_COOKIE]: token }),
    );
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") as string).pathname).toBe(
      "/enter",
    );
  });

  it("returns 401 for /api/admin even with a valid guest cookie", async () => {
    const token = await createGuestSession();
    const response = await proxy(
      makeRequest("/api/admin/moderation", { [GUEST_SESSION_COOKIE]: token }),
    );
    expect(response.status).toBe(401);
  });

  it("passes /admin through to server-side requireAdmin when a Supabase auth cookie exists", async () => {
    const response = await proxy(
      makeRequest("/admin", { "sb-rnfvmqflktghriqefatc-auth-token": "opaque" }),
    );
    expectPassThrough(response, "/admin with sb cookie");
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
  it("omits unsafe-eval in production CSP and includes it in dev", () => {
    const prod = securityHeaders({ dev: false })["Content-Security-Policy"];
    const dev = securityHeaders({ dev: true })["Content-Security-Policy"];
    expect(prod).not.toContain("'unsafe-eval'");
    expect(dev).toContain("'unsafe-eval'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("form-action 'self'");
  });

  it("next.config.ts serves the same header set for every route", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const catchAll = rules.find((rule) => rule.source === "/(.*)");
    expect(catchAll).toBeDefined();
    expect(catchAll!.headers).toEqual(securityHeaderEntries());
  });
});
