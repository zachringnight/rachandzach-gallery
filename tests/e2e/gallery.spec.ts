import { test, expect } from "@playwright/test";
import { addGuestSession } from "./support/session";

/**
 * Gallery discovery (packet 12 / workstream A).
 *
 * The acceptance matrix's "Discovery" row (event, person, orientation,
 * source, favorites, My Weekend, URL deep links, pagination) is almost
 * entirely backed by live Supabase data: src/app/(guest)/photos/page.tsx and
 * src/app/(guest)/my-weekend/page.tsx both call createAdminClient() inline,
 * unguarded, so with no database they throw before rendering anything
 * (see access.spec.ts's "auth boundary opens" test, which proves the SESSION
 * gate is not the thing failing). Those flows are test.fixme'd below.
 *
 * Two slices ARE real and DB-free, and are covered for real here:
 *   - Query-string validation: normalizeGalleryQuery() in
 *     src/lib/gallery/query.ts runs and can throw GalleryQueryError BEFORE
 *     getGalleryPage() ever calls the data source (query.ts:539-540), so an
 *     invalid orientation/source/event/person/ids value 400s without ever
 *     touching Supabase. The pagination CURSOR is the one exception, verified
 *     against the running server: decodeCursor() only runs later, against
 *     already-fetched results (query.ts:571-572, after the
 *     dataSource.listPhotos() call on line 540), so with the database
 *     unreachable a malformed cursor never gets that far -- the generic
 *     500 from the failed fetch wins the race instead of a cursor-specific
 *     400.
 *   - The "favorites" discovery mode's empty state: favorites are stored
 *     entirely client-side (src/lib/favorites/store.ts), so /favorites with
 *     nothing favorited yet needs no server data at all.
 */

test.describe("deep links preserve destination through the auth gate", () => {
  test("/photos/:photoId redirects to /enter with the full path in next", async ({
    page,
  }) => {
    await page.goto("/photos/00000000-0000-0000-0000-000000000000");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/enter");
    expect(url.searchParams.get("next")).toBe(
      "/photos/00000000-0000-0000-0000-000000000000",
    );
  });
});

test.describe("gallery query validation runs before any database access", () => {
  // Playwright's bare `request` fixture is a separate APIRequestContext that
  // does NOT share cookies with `context`/`page`; `context.request` is the
  // one that does. Every test below reads it off `context` for that reason.
  test.beforeEach(async ({ context }) => {
    await addGuestSession(context);
  });

  test("an invalid orientation filter 400s instead of 500ing", async ({
    context,
  }) => {
    const response = await context.request.get("/api/gallery?orientation=bogus");
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Invalid orientation");
  });

  test("an invalid source filter 400s instead of 500ing", async ({ context }) => {
    const response = await context.request.get("/api/gallery?source=bogus");
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Invalid source");
  });

  test("a malformed cursor is masked by the database failure, not 400ed", async ({
    context,
  }) => {
    // Unlike orientation/source/ids (validated up front), the cursor is only
    // decoded after dataSource.listPhotos() already ran (see this file's
    // header comment) -- so with the database unreachable, the generic
    // fetch failure happens first and the cursor is never actually parsed.
    const response = await context.request.get("/api/gallery?cursor=not-valid-json");
    expect(response.status()).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("The gallery is unavailable right now.");
  });

  test("an oversized ids lookup 400s instead of 500ing", async ({ context }) => {
    const params = new URLSearchParams();
    for (let i = 0; i < 101; i += 1) params.append("ids", `id-${i}`);
    const response = await context.request.get(`/api/gallery?${params.toString()}`);
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("at most 100");
  });

  test("a syntactically valid query still fails closed (no live database)", async ({
    context,
  }) => {
    // Confirms the 400s above are genuinely about validation ordering, not
    // about every request 400ing regardless of content: a WELL-FORMED query
    // passes validation and only then hits the unreachable data source,
    // surfacing as the documented generic 500.
    const response = await context.request.get("/api/gallery?orientation=landscape");
    expect(response.status()).toBe(500);
  });
});

test.describe("favorites discovery mode: real, database-free empty state", () => {
  test.beforeEach(async ({ context }) => {
    await addGuestSession(context);
  });

  test("shows guidance and no data-dependent controls with nothing favorited", async ({
    page,
  }) => {
    // This test (and access.spec.ts's near-identical /favorites test)
    // caught a real mid-session bug: a non-memoized useSyncExternalStore
    // snapshot crashing this page with "Maximum update depth exceeded."
    // Fixed upstream in FavoritesGallery.tsx's useFavoriteIds(); see that
    // file's comment for the full explanation.
    await page.goto("/favorites");
    await expect(
      page.getByText("Tap the heart on any photograph and it lands here"),
    ).toBeVisible();
    // These only render once there is at least one favorited photo
    // (FavoritesGallery returns early on an empty list); their absence is
    // itself the contract for the zero-state.
    await expect(page.getByRole("button", { name: "Play slideshow" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: /download all favorites/i }),
    ).toHaveCount(0);
  });
});

test.describe("known gaps requiring a live database (out of scope here)", () => {
  test.fixme(
    "event, person, orientation, and source filters narrow real results on /photos",
    async () => {
      // UNBLOCK: a live Supabase project with the catalog imported
      // (npm run gallery:import against the read-only wedding master, then
      // scripts/sync-gallery-catalog.mjs / sync-gallery-storage.mjs into a
      // real project -- no Docker/local Postgres in this environment). Then
      // drive /photos?event=..., ?person=..., ?orientation=..., ?source=...
      // and assert the rendered grid narrows accordingly.
    },
  );

  test.fixme(
    "pagination / virtualized scrolling loads the full catalog",
    async () => {
      // UNBLOCK: same live catalog as above; scroll VirtualPhotoGrid and
      // assert cursor-based paging reaches all 1,721 photos without
      // duplicates or gaps.
    },
  );

  test.fixme("My Weekend returns confirmed photos for a chosen person", async () => {
    // UNBLOCK: live Supabase catalog with confirmed rachandzach_photo_people
    // rows; /my-weekend calls createAdminClient() inline and currently
    // 500s with no database (see access.spec.ts's DB-unavailable coverage
    // of the equivalent /photos case).
  });

  test.fixme(
    "Moment Search beta returns a passing relevance set",
    async () => {
      // UNBLOCK: live Supabase catalog PLUS local CLIP embeddings built via
      // `uv run --python 3.12 scripts/build-embeddings.py` (a separate
      // Python pipeline, not just Docker/Postgres). Compare against the
      // fixed relevance set in tests/fixtures/search/manifest.json.
    },
  );

  test.fixme(
    "a URL deep link (?photo=<id>) opens the matching photo in the lightbox",
    async () => {
      // UNBLOCK: live catalog with a real, known photo id to deep-link to;
      // /photos itself 500s with no database (access.spec.ts proves the
      // auth gate opens regardless).
    },
  );

  test.fixme(
    "favoriting a real photo from the gallery grid round-trips into /favorites",
    async () => {
      // UNBLOCK: live catalog so a real photo card with a FavoriteButton
      // exists to click; the store itself (client-side) is unit-tested in
      // tests/favorites/store.test.ts with no database needed.
    },
  );
});
