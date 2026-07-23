import { test, expect } from "@playwright/test";
import { addGuestSession } from "./support/session";

/**
 * Downloads (packet 12 / workstream A).
 *
 * Actually downloading bytes needs a live Supabase project with real
 * approved photo rows and Storage objects -- entirely out of reach here (no
 * Docker, no local Postgres). What IS real and worth proving without one:
 * the input-validation contract in src/lib/downloads/sign-originals.ts's
 * getSelectionDownloads() runs and can throw DownloadValidationError (mapped
 * to HTTP 400) BEFORE the route ever calls the data source, so malformed
 * requests fail fast and correctly even with the database unreachable.
 *
 * A syntactically valid id, once past that validation, does NOT surface a
 * generic 500: createSupabaseOriginalsDataSource.getPhotosByIds()
 * deliberately swallows the Supabase error and returns an empty array
 * (`if (error || !data) return [];`) rather than throwing, unlike the
 * gallery data source's listPhotos(), which explicitly re-throws. Verified
 * against the running server, not assumed: an unreachable database and a
 * genuinely nonexistent id are therefore indistinguishable at this
 * endpoint -- both look like "no matching photo," which is arguably the
 * more private outcome (see this file's own "never reveals not-found vs.
 * down" framing below), just achieved as a byproduct of the data source's
 * own error handling rather than deliberately in the route.
 *
 * Byte-for-byte original integrity (file_sha256 round-tripping) is proven by
 * scripts/verify-original-integrity.mjs against real storage, not by this
 * browser suite; that script is a different workstream's deliverable.
 */

test.describe("unauthenticated requests are rejected", () => {
  test("GET /api/downloads/photo/:id returns 401", async ({ request }) => {
    const response = await request.get(
      "/api/downloads/photo/00000000-0000-0000-0000-000000000000",
    );
    expect(response.status()).toBe(401);
  });

  test("POST /api/downloads/selection returns 401", async ({ request }) => {
    const response = await request.post("/api/downloads/selection", {
      data: { photoIds: ["00000000-0000-0000-0000-000000000000"] },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe("authenticated, no live database: validation runs, then fails closed", () => {
  // Playwright's bare `request` fixture is a separate APIRequestContext that
  // does NOT share cookies with `context`/`page`; `context.request` is the
  // one that does. Every test below reads it off `context` for that reason.
  test.beforeEach(async ({ context }) => {
    await addGuestSession(context);
  });

  test("an unknown photo id 404s the same way a down database would", async ({
    context,
  }) => {
    // getPhotosByIds() swallows the Supabase error and returns [] (see this
    // file's header comment), so getOriginalDownload() takes the same
    // DownloadNotFoundError path an unreachable database and a genuinely
    // nonexistent id both land on: never a stack trace, never a Supabase
    // URL, and never a way to tell "no such photo" apart from "can't check."
    const response = await context.request.get(
      "/api/downloads/photo/00000000-0000-0000-0000-000000000000",
    );
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Photo not found.");
    expect(JSON.stringify(body)).not.toMatch(/supabase|service_role|54329/i);
  });

  test("photoIds that is not an array 400s before touching the database", async ({
    context,
  }) => {
    const response = await context.request.post("/api/downloads/selection", {
      data: { photoIds: "not-an-array" },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("photoIds must be an array.");
  });

  test("an empty selection 400s before touching the database", async ({
    context,
  }) => {
    const response = await context.request.post("/api/downloads/selection", {
      data: { photoIds: [] },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("At least one photo id is required.");
  });

  test("a missing photoIds field is treated as empty and 400s the same way", async ({
    context,
  }) => {
    const response = await context.request.post("/api/downloads/selection", {
      data: {},
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("At least one photo id is required.");
  });

  test("a selection over 50 ids 400s before touching the database", async ({
    context,
  }) => {
    const ids = Array.from(
      { length: 51 },
      (_, index) => `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
    );
    const response = await context.request.post("/api/downloads/selection", {
      data: { photoIds: ids },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("A selection accepts at most 50 photos (received 51).");
  });

  test("malformed JSON body 400s cleanly", async ({ context }) => {
    const response = await context.request.post("/api/downloads/selection", {
      data: "{not json",
      headers: { "content-type": "application/json" },
    });
    expect(response.status()).toBe(400);
  });

  test("a syntactically valid selection passes validation, then silently yields nothing", async ({
    context,
  }) => {
    // Same getPhotosByIds() error-swallowing as the single-photo case above:
    // getSelectionDownloads() treats the unreachable database exactly like
    // "none of these ids matched," which is its documented behavior for
    // unknown/non-approved ids even with a live database (see this file's
    // header comment) -- so this 200s with an empty item list, not a 500.
    const response = await context.request.post("/api/downloads/selection", {
      data: { photoIds: ["00000000-0000-0000-0000-000000000000"] },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ items: [], maximumItems: 50, estimatedBytes: 0 });
    expect(JSON.stringify(body)).not.toMatch(/supabase|service_role|54329/i);
  });
});

test.describe("known gaps requiring a live database (out of scope here)", () => {
  test.fixme(
    "downloading a single approved original redirects to a working signed URL",
    async () => {
      // UNBLOCK: a live Supabase project with an approved photo row and its
      // original object actually present in the originals/guest-approved
      // bucket; no Docker/local Postgres in this environment. Then GET
      // /api/downloads/photo/:id and follow the 307 to a real signed URL.
    },
  );

  test.fixme(
    "a pending or rejected photo's id still 404s for a signed-in guest",
    async () => {
      // UNBLOCK: same live project, with a real non-approved row to probe;
      // the pure logic (isDownloadable in sign-originals.ts) is already
      // unit-tested with a fixture source in
      // tests/downloads/original-integrity.test.ts, but exercising the real
      // route needs the database this environment does not have.
    },
  );

  test.fixme(
    "a 50-item selection streams as one ZIP without Vercel carrying the bytes",
    async () => {
      // UNBLOCK: same live project with 50 real approved photos; verifies
      // src/lib/downloads/stream-zip.ts's client-side streaming path end to
      // end, including collision-safe filenames.
    },
  );
});
