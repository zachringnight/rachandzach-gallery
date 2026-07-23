import { test, expect } from "@playwright/test";
import { addGuestSession } from "./support/session";

/**
 * Admin (packet 12 / workstream A).
 *
 * Admin sign-in rides a real Supabase magic link (packet 04); there is no
 * local bypass for it (by design -- see src/lib/auth/admin-session.ts's
 * header comment) and no live Supabase project exists in this environment.
 * So every moderation flow (approve, reject, partial approve, metadata edit,
 * audit, visibility isolation) is test.fixme'd below.
 *
 * What IS real and database-free: the structural admin gate.
 *   - proxy.ts denies /admin and /api/admin/* outright with no Supabase auth
 *     cookie present, and NEVER accepts a guest session cookie in their
 *     place (isAdminPath() ignores GUEST_SESSION_COOKIE entirely) -- pure
 *     cookie-shape logic, no database.
 *   - requireAdmin() (src/lib/auth/admin-session.ts) is the real
 *     second-layer check every /admin page and /api/admin route calls
 *     itself; this suite proves it denies gracefully rather than crashing
 *     when Supabase auth is unreachable.
 */

test.describe("the structural gate denies with no admin session", () => {
  test("/admin redirects to /enter", async ({ page }) => {
    await page.goto("/admin");
    expect(new URL(page.url()).pathname).toBe("/enter");
  });

  test("/admin/review redirects to /enter", async ({ page }) => {
    await page.goto("/admin/review");
    expect(new URL(page.url()).pathname).toBe("/enter");
  });

  test("/api/admin/batches returns 401 JSON, not a redirect", async ({ request }) => {
    const response = await request.get("/api/admin/batches");
    expect(response.status()).toBe(401);
    expect(response.headers()["content-type"]).toContain("json");
  });
});

test.describe("a guest session never substitutes for an admin session", () => {
  test.beforeEach(async ({ context }) => {
    await addGuestSession(context);
  });

  test("/admin still redirects to /enter with a valid guest cookie", async ({
    page,
  }) => {
    await page.goto("/admin");
    expect(new URL(page.url()).pathname).toBe("/enter");
  });

  test("/api/admin/batches still returns 401 with a valid guest cookie", async ({
    context,
  }) => {
    // context.request (not the bare `request` fixture) shares cookies with
    // `context`, which is what addGuestSession in beforeEach set the cookie
    // on.
    const response = await context.request.get("/api/admin/batches");
    expect(response.status()).toBe(401);
  });
});

test.describe("a structurally-shaped but unusable Supabase session", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    // Matches proxy.ts's SUPABASE_AUTH_COOKIE pattern (sb-*-auth-token) so
    // the cheap structural gate lets the request through to the real
    // requireAdmin() check -- which then has no live Supabase project to
    // confirm anything against.
    await context.addCookies([
      {
        name: "sb-e2e-fake-auth-token",
        value: "opaque-e2e-value",
        url: baseURL,
      },
    ]);
  });

  test("/admin never renders the review queue; it denies without leaking internals", async ({
    page,
  }) => {
    const response = await page.goto("/admin");
    // Whichever fail-closed shape this takes (a rendered "access required"
    // denial, or a generic framework error page for the unreachable auth
    // call), it must never be the review queue, and must never leak
    // Supabase configuration.
    await expect(page.getByRole("heading", { name: "Review queue" })).toHaveCount(
      0,
    );
    const body = await page.content();
    expect(body).not.toMatch(/54329|service_role|synthetic-service-role-key/i);
    expect(response?.status()).not.toBe(200);
  });

  test("/api/admin/batches never returns admin data", async ({ context }) => {
    const response = await context.request.get("/api/admin/batches");
    expect(response.status()).not.toBe(200);
    const body = await response.text();
    expect(body).not.toMatch(/54329|service_role|synthetic-service-role-key/i);
  });
});

test.describe("known gaps requiring a live database (out of scope here)", () => {
  test.fixme(
    "an admin magic-link sign-in reaches /admin/review and lists the real queue",
    async () => {
      // UNBLOCK: a live Supabase project (no Docker/local Postgres here)
      // with Auth enabled and a real magic-link loop for
      // wedding@rachandzach.com; see access.spec.ts's equivalent fixme.
    },
  );

  test.fixme("approve, partial-approve, and reject act on a real batch", async () => {
    // UNBLOCK: same live project with a real submitted
    // rachandzach_upload_batches row (packet 08's flow, itself
    // test.fixme'd in uploads.spec.ts for the same reason) to moderate.
  });

  test.fixme("a metadata edit persists and shows up in the audit trail", async () => {
    // UNBLOCK: same live project; src/lib/moderation/audit.ts writes real
    // rows this suite has no database to read back.
  });

  test.fixme(
    "rejected and pending items stay invisible to guest and public routes",
    async () => {
      // UNBLOCK: same live project with one approved, one pending, and one
      // rejected item, then probe /photos, /api/gallery, and the download
      // routes as a guest to confirm only the approved item is ever visible.
      // The pure visibility rule is already unit-tested with a fixture
      // source in tests/moderation/visibility.test.ts; this would be the
      // real end-to-end confirmation over HTTP.
    },
  );
});
