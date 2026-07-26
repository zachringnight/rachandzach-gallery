import { test, expect } from "@playwright/test";
import {
  SYNTHETIC_GALLERY_PASSWORD,
} from "./support/env";
import {
  GUEST_SESSION_COOKIE,
  TAMPERED_SESSION_TOKEN,
  addGuestSession,
} from "./support/session";

/**
 * The app's own error/status paragraphs are always `<p role="alert">`
 * (AccessForm.tsx, UploadClient.tsx). Next.js also renders its own empty
 * `<div role="alert" aria-live="assertive" id="__next-route-announcer__">`
 * on every page for screen-reader route-change announcements, so a bare
 * `page.getByRole("alert")` is ambiguous (matches both). Scope to the app's
 * own element instead of the framework's.
 */
function appAlert(page: import("@playwright/test").Page) {
  return page.locator('p[role="alert"]');
}

/**
 * Access control (packet 12 / workstream A).
 *
 * This suite runs against a real production build with no live database
 * (see playwright.config.ts and tests/e2e/support/env.ts). Two layers are
 * exercised for real, end to end, over real HTTP against the real proxy:
 *
 *   1. The guest/admin session boundary itself (proxy.ts,
 *      requireGalleryAccess, requireAdmin's structural gate). This has no
 *      database dependency, so it is tested for real in full, including
 *      with a validly-signed session cookie (minted directly -- see
 *      tests/e2e/support/session.ts for exactly what that does and does not
 *      bypass).
 *   2. The real login endpoint's fail-closed behavior when its rate-limit
 *      RPC cannot reach a database: it must deny, never silently allow.
 *
 * What this suite does NOT claim: that a guest can complete the real
 * password-entry login flow, or that an admin can complete a magic-link
 * sign-in. Both require a live Supabase project (a working
 * rachandzach_consume_rate_limit RPC for guest login; real Auth + email for
 * admin). Those are test.fixme'd below with the exact unblock steps.
 */

const GUEST_ROUTES = ["/photos", "/my-weekend", "/add-yours", "/favorites"];

test.describe("public routes stay open with no session", () => {
  for (const path of ["/", "/enter", "/robots.txt", "/sitemap.xml"]) {
    test(`GET ${path} does not redirect anywhere`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status(), path).toBeLessThan(400);
      // Asserting equality (not just "not /enter") also correctly covers the
      // /enter case itself, where staying at /enter IS the expected, public,
      // non-redirected outcome.
      expect(new URL(page.url()).pathname, path).toBe(path);
    });
  }

  test("the retired weekend route opens the protected photo archive", async ({ page }) => {
    await page.goto("/weekend");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/enter");
    expect(url.searchParams.get("next")).toBe("/photos");
  });
});

test.describe("guest routes require a session", () => {
  for (const path of GUEST_ROUTES) {
    test(`${path} redirects to /enter with next preserved, unauthenticated`, async ({
      page,
    }) => {
      await page.goto(path);
      const url = new URL(page.url());
      expect(url.pathname).toBe("/enter");
      expect(url.searchParams.get("next")).toBe(path);
    });
  }

  test("a query string on the guest route survives the redirect's next param", async ({
    page,
  }) => {
    await page.goto("/photos?event=welcome-party");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/enter");
    expect(url.searchParams.get("next")).toBe("/photos?event=welcome-party");
  });

  test("an unlisted route defaults to protected", async ({ page }) => {
    await page.goto("/some-route-nobody-listed");
    expect(new URL(page.url()).pathname).toBe("/enter");
  });

  test("the legacy static gallery-assets path stays protected", async ({
    request,
    baseURL,
  }) => {
    // public/gallery-assets is the pre-rebuild static gallery; proxy.ts's
    // matcher only excludes _next/static and _next/image, so this real
    // static file must still flow through the default-deny gate.
    const response = await request.get("/gallery-assets/full/does-not-matter.jpg", {
      maxRedirects: 0,
    });
    expect([307, 308]).toContain(response.status());
    // proxy.ts issues a relative Location header (e.g. "/enter?next=...");
    // new URL() needs a base to parse that.
    const location = response.headers()["location"] ?? "";
    expect(new URL(location, baseURL).pathname).toBe("/enter");
  });

  for (const path of ["/api/gallery", "/api/search", "/api/uploads/batches"]) {
    test(`${path} returns 401 JSON instead of redirecting, unauthenticated`, async ({
      request,
    }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(401);
      expect(response.headers()["content-type"]).toContain("json");
      const body = await response.json();
      expect(body).not.toHaveProperty("stack");
      expect(JSON.stringify(body)).not.toMatch(/supabase|service_role|postgres/i);
    });
  }
});

test.describe("a validly-signed guest session opens the guest gate", () => {
  test.beforeEach(async ({ context }) => {
    await addGuestSession(context);
  });

  test("/photos no longer redirects to /enter (auth boundary opens)", async ({
    page,
  }) => {
    // The page itself still needs live Supabase data and is out of scope
    // here (see gallery.spec.ts); this asserts only that the SESSION gate
    // opened -- the browser stays on /photos rather than bouncing to /enter.
    const response = await page.goto("/photos");
    expect(new URL(page.url()).pathname).toBe("/photos");
    expect(response?.status()).not.toBe(401);
  });

  test("/favorites renders its real, database-free empty state", async ({ page }) => {
    // This test caught a real bug mid-session: FavoritesGallery.tsx's
    // useFavoriteIds() originally passed favoriteStore.list() (which
    // returns a fresh array every call) straight through as
    // useSyncExternalStore's getSnapshot, which requires a referentially
    // stable value and crashed React with "Maximum update depth exceeded"
    // on every /favorites visit. Fixed upstream (packet 09) by memoizing
    // the snapshot; see the comment on useFavoriteIds() in
    // FavoritesGallery.tsx for the full explanation.
    await page.goto("/favorites");
    expect(new URL(page.url()).pathname).toBe("/favorites");
    await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
    await expect(
      page.getByText("You have not favorited any photos yet"),
    ).toBeVisible();
  });

  test("/add-yours renders the real upload form", async ({ page }) => {
    await page.goto("/add-yours");
    expect(new URL(page.url()).pathname).toBe("/add-yours");
    await expect(
      page.getByRole("heading", { name: "Add your photos" }),
    ).toBeVisible();
    await expect(page.getByText("Drag your photos here")).toBeVisible();
  });

  test("GET /api/gallery is authenticated (not 401) even though data is unavailable", async ({
    context,
  }) => {
    // Playwright's bare `request` fixture is a separate APIRequestContext
    // that does NOT share cookies with `context`/`page`; `context.request`
    // is the one that does (it's the same context addGuestSession just
    // added the cookie to).
    const response = await context.request.get("/api/gallery");
    expect(response.status()).not.toBe(401);
    // No live Supabase in this environment: the route's own catch-all maps
    // the resulting error to a generic 500 and must not leak internals.
    expect(response.status()).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/supabase|service_role|postgres|54329/i);
  });
});

test.describe("admin routes never accept a guest session", () => {
  test("/admin redirects to /enter with no session", async ({ page }) => {
    await page.goto("/admin");
    expect(new URL(page.url()).pathname).toBe("/enter");
  });

  test("/admin redirects to /enter even with a valid GUEST session", async ({
    context,
    page,
  }) => {
    await addGuestSession(context);
    await page.goto("/admin");
    expect(new URL(page.url()).pathname).toBe("/enter");
  });

  test("/api/admin/* returns 401 with a valid guest session", async ({
    context,
  }) => {
    await addGuestSession(context);
    const response = await context.request.get("/api/admin/batches");
    expect(response.status()).toBe(401);
  });
});

test.describe("tampered or invalid sessions are rejected", () => {
  test("a garbled session cookie redirects to /enter", async ({
    context,
    page,
    baseURL,
  }) => {
    await context.addCookies([
      {
        name: GUEST_SESSION_COOKIE,
        value: TAMPERED_SESSION_TOKEN,
        url: baseURL,
      },
    ]);
    await page.goto("/photos");
    expect(new URL(page.url()).pathname).toBe("/enter");
  });

  test("appending garbage to a valid session's signature is rejected", async ({
    context,
    page,
    baseURL,
  }) => {
    await addGuestSession(context);
    const cookies = await context.cookies(baseURL);
    const valid = cookies.find((c) => c.name === GUEST_SESSION_COOKIE);
    expect(valid).toBeDefined();
    // Clear before re-adding: WebKit's cookie jar does not reliably treat a
    // same name+domain+path addCookies() call as a replacement the way
    // Chromium's does, so without this the browser can end up holding both
    // the original valid cookie and the tampered one, and send the valid
    // one, defeating the test (verified against the running server, not
    // assumed).
    await context.clearCookies();
    await context.addCookies([
      {
        name: GUEST_SESSION_COOKIE,
        value: `${valid!.value}x`,
        url: baseURL,
      },
    ]);
    await page.goto("/photos");
    expect(new URL(page.url()).pathname).toBe("/enter");
  });
});

test.describe("security headers", () => {
  for (const path of ["/", "/enter"]) {
    test(`${path} carries the pinned security header set`, async ({ request }) => {
      const response = await request.get(path);
      const headers = response.headers();
      expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(headers["content-security-policy"]).toContain("default-src 'self'");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    });
  }

  test("a 401 API response still carries the security header set", async ({
    request,
  }) => {
    const response = await request.get("/api/gallery");
    expect(response.status()).toBe(401);
    expect(response.headers()["x-frame-options"]).toBe("DENY");
  });
});

test.describe("the real login endpoint, database unreachable", () => {
  test("submitting the real form fails closed instead of granting access", async ({
    page,
  }) => {
    // No live database: POST /api/access/login rate-limits through a
    // Postgres RPC BEFORE it ever checks the password
    // (src/lib/auth/rate-limit.ts). With that RPC unreachable, EVERY
    // attempt -- correct password or not -- is denied the same way. This is
    // the documented fail-closed contract ("no database, no login"), proven
    // here against the real endpoint rather than assumed.
    await page.goto("/enter");
    await page.getByLabel("Password").fill(SYNTHETIC_GALLERY_PASSWORD);
    await page.getByRole("button", { name: /come on in|checking/i }).click();

    // Not page.waitForURL(/\/enter/): we already start on /enter, so that
    // regex would match the PRE-click URL too. Waiting on the alert text
    // instead naturally waits through the POST -> 303 redirect navigation.
    await expect(appAlert(page)).toContainText("A few too many tries in a row");
    const url = new URL(page.url());
    expect(url.searchParams.get("error")).toBe("slow");
    // No guest session was minted.
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === GUEST_SESSION_COOKIE)).toBeUndefined();
  });

  test("the login page itself renders labeled, accessible form controls", async ({
    page,
  }) => {
    await page.goto("/enter");
    const passwordField = page.getByLabel("Password");
    await expect(passwordField).toBeVisible();
    await expect(passwordField).toHaveAttribute("type", "password");
    await expect(passwordField).toHaveAttribute("required", "");
    await expect(
      page.getByRole("button", { name: "Come on in" }),
    ).toBeVisible();
  });

  test("an unknown error code falls back to the generic invalid-password copy", async ({
    page,
  }) => {
    await page.goto("/enter?error=invalid");
    await expect(appAlert(page)).toContainText("that is not the password we sent");
  });
});

test.describe("known gaps requiring a live database (out of scope here)", () => {
  test.fixme(
    "a correct password logs a guest in via the real UI and lands on /photos",
    async () => {
      // UNBLOCK: provide a real Supabase project (or `supabase start`, which
      // needs Docker -- unavailable in this environment) with
      // supabase/migrations/202607220001_gallery_core.sql applied so
      // rachandzach_consume_rate_limit exists, point SUPABASE_URL /
      // SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_* at it, set
      // GALLERY_PASSWORD_HASH to a hash of a known test password, then
      // drive POST /api/access/login with that password and assert the
      // redirect lands on /photos with a rz_gallery_session cookie set.
    },
  );

  test.fixme(
    "an admin magic-link sign-in reaches /admin/review",
    async () => {
      // UNBLOCK: same live Supabase project as above, with Auth enabled and
      // a real magic-link email loop for wedding@rachandzach.com (or a
      // Supabase test helper that mints a session directly against a real
      // auth.users row). Not reproducible in a fully local, no-network
      // suite; see admin.spec.ts for what IS covered without one.
    },
  );
});
