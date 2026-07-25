/**
 * Tests for packet 07's Moment Search.
 *
 * Two layers, mirroring tests/database/schema.test.ts's split for packet 03:
 *
 * 1. Static layer (always runs): parses supabase/migrations/
 *    202607220003_moment_search.sql for the same non-negotiables 001/002
 *    enforce -- default deny, per-object (never schema-wide) grants/revokes,
 *    a pinned search_path on the new function, and APPROVED-only photo
 *    status isolation baked into the RPC's own join. This migration cannot
 *    be applied locally (no Docker; see tests/database/schema.test.ts's
 *    header for why), so this is the only layer available for it.
 *
 * 2. Logic layer: src/lib/search/moment-search.ts exercised directly via
 *    searchMomentsWith's injectable deps -- a deterministic in-memory vector
 *    fixture and an in-memory GalleryDataSource, no live model and no live
 *    database. Covers event filtering, low-similarity rejection, disabled-
 *    flag behavior, pending-photo isolation, and embedding/RPC-failure
 *    fallback.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type {
  GalleryDataSource,
  GalleryEventMeta,
  GalleryPersonLink,
  GalleryPersonMeta,
  GalleryPhotoSource,
} from "@/lib/gallery/query";
import {
  MOMENT_SEARCH_DEFAULT_LIMIT,
  MOMENT_SEARCH_MAX_LIMIT,
  MOMENT_SEARCH_MAX_QUERY_LENGTH,
  MOMENT_SEARCH_MIN_QUERY_LENGTH,
  MOMENT_SEARCH_MIN_SIMILARITY,
  MomentSearchValidationError,
  normalizeMomentSearchInput,
  searchMomentsWith,
  serializeMomentResults,
  type MomentSearchDeps,
  type MomentVectorMatch,
} from "@/lib/search/moment-search";

// ---------------------------------------------------------------------------
// Static: supabase/migrations/202607220003_moment_search.sql
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(__dirname, "..", "..");
const migrationPath = path.join(
  repoRoot,
  "supabase",
  "migrations",
  "202607220003_moment_search.sql",
);

function mustRead(filePath: string): string {
  expect(existsSync(filePath), `expected file to exist: ${filePath}`).toBe(true);
  return readFileSync(filePath, "utf8");
}

function stripSqlComments(sqlText: string): string {
  return sqlText.replace(/--[^\n]*/g, "");
}

describe("static: moment_search migration exists and is additive", () => {
  it("exists as its own file, separate from the core catalog migrations", () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it("installs pgvector additively (create extension if not exists)", () => {
    const sql = mustRead(migrationPath);
    expect(sql).toContain("create extension if not exists vector with schema extensions;");
  });
});

describe("static: rachandzach_photo_embeddings table", () => {
  const sql = () => mustRead(migrationPath);

  it("matches the packet's pinned column shape", () => {
    const text = sql();
    expect(text).toContain("create table public.rachandzach_photo_embeddings (");
    expect(text).toMatch(/photo_id uuid primary key references public\.rachandzach_photos/);
    expect(text).toMatch(/model text not null/);
    expect(text).toMatch(/model_version text not null/);
    expect(text).toMatch(/embedding extensions\.vector\(512\) not null/);
    expect(text).toMatch(/generated_at timestamptz not null default now\(\)/);
  });

  it("cascades on photo delete (no orphaned embeddings)", () => {
    const text = sql();
    expect(text).toMatch(
      /photo_id uuid primary key references public\.rachandzach_photos \(id\) on delete cascade/,
    );
  });

  it("indexes the embedding column for cosine similarity search", () => {
    const text = sql();
    expect(text).toMatch(/using hnsw \(embedding extensions\.vector_cosine_ops\)/);
  });

  it("enables row level security with no permissive policies (default deny)", () => {
    const text = sql();
    expect(text).toContain(
      "alter table public.rachandzach_photo_embeddings enable row level security;",
    );
    expect(stripSqlComments(text)).not.toMatch(/create\s+policy/i);
  });

  it("revokes public/anon/authenticated and grants only service_role, per object", () => {
    const text = sql();
    expect(text).toContain(
      "revoke all on table public.rachandzach_photo_embeddings from public, anon, authenticated;",
    );
    expect(text).toContain(
      "grant all on table public.rachandzach_photo_embeddings to service_role;",
    );
  });

  it("never uses a schema-wide grant/revoke statement (shared PrizmLounge project)", () => {
    const statements = stripSqlComments(sql());
    expect(statements).not.toMatch(/on\s+all\s+tables\s+in\s+schema/i);
    expect(statements).not.toMatch(/on\s+all\s+functions\s+in\s+schema/i);
    expect(statements).not.toMatch(/alter\s+default\s+privileges/i);
    expect(statements).not.toMatch(/create\s+event\s+trigger/i);
    expect(statements).not.toMatch(/create\s+publication/i);
  });
});

describe("static: rachandzach_search_gallery_moments RPC", () => {
  const sql = () => mustRead(migrationPath);

  it("matches the packet's pinned signature (query_embedding, event_filter, result_limit)", () => {
    const text = sql();
    expect(text).toMatch(
      /create or replace function public\.rachandzach_search_gallery_moments\(\s*query_embedding extensions\.vector\(512\),\s*event_filter text,\s*result_limit int\s*\)\s*returns table \(photo_id uuid, similarity float8\)/,
    );
  });

  it("pins search_path (including extensions, for the vector type/operator)", () => {
    const text = sql();
    const start = text.indexOf(
      "create or replace function public.rachandzach_search_gallery_moments(",
    );
    expect(start).toBeGreaterThan(-1);
    const header = text.slice(start, text.indexOf("$$", start));
    expect(header).toContain("set search_path = public, extensions, pg_temp");
  });

  it("isolates photo status to published only, at the SQL layer", () => {
    const text = sql();
    const start = text.indexOf(
      "create or replace function public.rachandzach_search_gallery_moments(",
    );
    const body = text.slice(start, text.indexOf("$$;", start));
    expect(body).toMatch(/where\s+p\.status\s*=\s*'published'/);
    expect(body).toContain("join public.rachandzach_photos p on p.id = e.photo_id");
  });

  it("clamps result_limit to at most 40 regardless of the caller's input", () => {
    const text = sql();
    expect(text).toMatch(/limit least\(greatest\(coalesce\([^)]*result_limit[^)]*\), 1\), 40\)/);
  });

  it("supports an optional event filter that never widens the result set when absent", () => {
    const text = sql();
    expect(text).toMatch(/event_filter is null\s*\n\s*or ev\.slug = /);
  });

  it("revokes public/anon/authenticated and grants only service_role", () => {
    const text = sql();
    expect(text).toMatch(
      /revoke all on function public\.rachandzach_search_gallery_moments\(vector, text, int\)\s*\n\s*from public, anon, authenticated;/,
    );
    expect(text).toMatch(
      /grant execute on function public\.rachandzach_search_gallery_moments\(vector, text, int\)\s*\n\s*to service_role;/,
    );
  });

  it("is security definer and stable (read-only, safe to plan as such)", () => {
    const text = sql();
    const start = text.indexOf(
      "create or replace function public.rachandzach_search_gallery_moments(",
    );
    const header = text.slice(start, text.indexOf("as $$", start));
    expect(header).toMatch(/\bstable\b/);
    expect(header).toMatch(/\bsecurity definer\b/);
  });
});

// ---------------------------------------------------------------------------
// Logic: src/lib/search/moment-search.ts
// ---------------------------------------------------------------------------

describe("normalizeMomentSearchInput", () => {
  it("trims and accepts a query at the minimum length", () => {
    const result = normalizeMomentSearchInput({ query: "  hi  ", event: null, limit: 10 });
    expect(result.query).toBe("hi");
    expect(result.query.length).toBe(MOMENT_SEARCH_MIN_QUERY_LENGTH);
  });

  it("rejects a query shorter than the minimum", () => {
    expect(() =>
      normalizeMomentSearchInput({ query: "a", event: null, limit: 10 }),
    ).toThrow(MomentSearchValidationError);
    expect(() =>
      normalizeMomentSearchInput({ query: "  ", event: null, limit: 10 }),
    ).toThrow(MomentSearchValidationError);
  });

  it("accepts a query at exactly the maximum length and rejects one character over", () => {
    const atMax = "a".repeat(MOMENT_SEARCH_MAX_QUERY_LENGTH);
    expect(normalizeMomentSearchInput({ query: atMax, event: null, limit: 10 }).query).toBe(
      atMax,
    );
    const overMax = "a".repeat(MOMENT_SEARCH_MAX_QUERY_LENGTH + 1);
    expect(() =>
      normalizeMomentSearchInput({ query: overMax, event: null, limit: 10 }),
    ).toThrow(MomentSearchValidationError);
  });

  it("accepts a well-formed event slug and rejects a malformed one", () => {
    expect(
      normalizeMomentSearchInput({ query: "sunset kiss", event: "reception", limit: 10 }).event,
    ).toBe("reception");
    expect(() =>
      normalizeMomentSearchInput({ query: "sunset kiss", event: "Not A Slug", limit: 10 }),
    ).toThrow(MomentSearchValidationError);
    expect(() =>
      normalizeMomentSearchInput({ query: "sunset kiss", event: "../etc/passwd", limit: 10 }),
    ).toThrow(MomentSearchValidationError);
  });

  it("treats null, undefined, and empty-string event as no filter", () => {
    expect(normalizeMomentSearchInput({ query: "sunset kiss", event: null, limit: 10 }).event).toBeNull();
    expect(
      normalizeMomentSearchInput({
        query: "sunset kiss",
        event: undefined as unknown as null,
        limit: 10,
      }).event,
    ).toBeNull();
    expect(normalizeMomentSearchInput({ query: "sunset kiss", event: "", limit: 10 }).event).toBeNull();
  });

  it("clamps limit to the maximum and falls back to the default for non-positive or non-finite values", () => {
    expect(
      normalizeMomentSearchInput({ query: "sunset kiss", event: null, limit: 1000 }).limit,
    ).toBe(MOMENT_SEARCH_MAX_LIMIT);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        normalizeMomentSearchInput({ query: "sunset kiss", event: null, limit: bad }).limit,
      ).toBe(MOMENT_SEARCH_DEFAULT_LIMIT);
    }
  });
});

// --- Deterministic fixture ---------------------------------------------------

function photo(overrides: Partial<GalleryPhotoSource> & { id: string }): GalleryPhotoSource {
  return {
    status: "published",
    source: "photographer",
    eventSlug: "reception",
    eventName: "Reception",
    eventOrder: 1,
    capturedAt: "2025-07-19T20:00:00.000Z",
    originalFilename: `${overrides.id}.jpg`,
    width: 4000,
    height: 3000,
    orientation: "landscape",
    people: [],
    keywords: [],
    previews: [
      { objectPath: `previews/${overrides.id}/640.webp`, bucket: "rachandzach-previews", width: 640, format: "webp" },
    ],
    ...overrides,
  };
}

const FIXTURE_PHOTOS: GalleryPhotoSource[] = [
  photo({ id: "approved-kiss", eventSlug: "ceremony", eventName: "Ceremony", eventOrder: 0, keywords: ["kiss"] }),
  photo({ id: "approved-dance", eventSlug: "reception", eventName: "Reception", eventOrder: 1, keywords: ["dancing"] }),
  photo({ id: "approved-low-sim", eventSlug: "reception", eventName: "Reception", eventOrder: 1 }),
  photo({ id: "pending-photo", status: "pending" }),
  photo({ id: "hidden-photo", status: "hidden" }),
  photo({ id: "rejected-photo", status: "rejected" }),
];

const FIXTURE_EVENTS: GalleryEventMeta[] = [
  { slug: "ceremony", name: "Ceremony", order: 0 },
  { slug: "reception", name: "Reception", order: 1 },
];

const FIXTURE_PEOPLE: GalleryPersonMeta[] = [];

function makeDataSource(photos: GalleryPhotoSource[] = FIXTURE_PHOTOS): GalleryDataSource {
  return {
    async listPhotos() {
      return photos;
    },
    async listEvents() {
      return FIXTURE_EVENTS;
    },
    async listPeople() {
      return FIXTURE_PEOPLE;
    },
  };
}

const DETERMINISTIC_EMBEDDING = Array.from({ length: 512 }, (_, i) => (i % 7) / 7);

function fixedEmbedder(vector: number[] = DETERMINISTIC_EMBEDDING) {
  return async () => vector;
}

function baseDeps(overrides: Partial<MomentSearchDeps> = {}): MomentSearchDeps {
  return {
    enabled: true,
    embedText: fixedEmbedder(),
    runVectorSearch: async () => [],
    dataSource: makeDataSource(),
    ...overrides,
  };
}

describe("searchMomentsWith: deterministic vector fixture", () => {
  it("returns embedding matches mapped to full photo views, ordered as the vector search returned them", async () => {
    const matches: MomentVectorMatch[] = [
      { photoId: "approved-dance", similarity: 0.91 },
      { photoId: "approved-kiss", similarity: 0.7 },
    ];
    const results = await searchMomentsWith(
      { query: "people dancing", event: null, limit: 10 },
      baseDeps({ runVectorSearch: async () => matches }),
    );
    expect(results).toHaveLength(2);
    expect(results[0].matchType).toBe("embedding");
    expect(results[0].photo.id).toBe("approved-dance");
    expect(results[0].similarity).toBe(0.91);
    expect(results[1].photo.id).toBe("approved-kiss");
  });

  it("passes the embedder's exact vector through to runVectorSearch", async () => {
    const vector = DETERMINISTIC_EMBEDDING;
    let seen: number[] | null = null;
    await searchMomentsWith(
      { query: "sunset kiss", event: null, limit: 10 },
      baseDeps({
        embedText: fixedEmbedder(vector),
        runVectorSearch: async (embedding) => {
          seen = embedding;
          return [];
        },
      }),
    );
    expect(seen).toEqual(vector);
  });
});

describe("searchMomentsWith: event filtering", () => {
  it("passes the normalized event slug through to the vector search", async () => {
    let seenEvent: string | null | undefined;
    await searchMomentsWith(
      { query: "sunset kiss", event: "reception", limit: 10 },
      baseDeps({
        runVectorSearch: async (_embedding, eventSlug) => {
          seenEvent = eventSlug;
          return [{ photoId: "approved-dance", similarity: 0.9 }];
        },
      }),
    );
    expect(seenEvent).toBe("reception");
  });

  it("defense in depth: drops a match outside the requested event even if the RPC returned it", async () => {
    const results = await searchMomentsWith(
      { query: "sunset kiss", event: "reception", limit: 10 },
      baseDeps({
        // approved-kiss belongs to "ceremony"; a buggy/stale RPC index
        // returning it under an event filter must not leak through.
        runVectorSearch: async () => [{ photoId: "approved-kiss", similarity: 0.9 }],
      }),
    );
    // No embedding match survives the event check, and the keyword fallback
    // also finds nothing for this query/event combination.
    expect(results.every((r) => r.matchType !== "embedding")).toBe(true);
  });
});

describe("searchMomentsWith: low-similarity rejection", () => {
  it(`drops matches below the ${MOMENT_SEARCH_MIN_SIMILARITY} similarity floor`, async () => {
    const results = await searchMomentsWith(
      { query: "sunset kiss", event: null, limit: 10 },
      baseDeps({
        runVectorSearch: async () => [
          { photoId: "approved-dance", similarity: 0.5 },
          { photoId: "approved-low-sim", similarity: 0.05 },
        ],
      }),
    );
    const ids = results.filter((r) => r.matchType === "embedding").map((r) => r.photo.id);
    expect(ids).toContain("approved-dance");
    expect(ids).not.toContain("approved-low-sim");
  });

  it("keeps a match exactly at the similarity floor", async () => {
    const results = await searchMomentsWith(
      { query: "sunset kiss", event: null, limit: 10 },
      baseDeps({
        runVectorSearch: async () => [
          { photoId: "approved-low-sim", similarity: MOMENT_SEARCH_MIN_SIMILARITY },
        ],
      }),
    );
    expect(results[0]?.photo.id).toBe("approved-low-sim");
    expect(results[0]?.matchType).toBe("embedding");
  });

  it("falls back to keywords when every vector match is below the floor", async () => {
    const results = await searchMomentsWith(
      { query: "dancing", event: null, limit: 10 },
      baseDeps({
        runVectorSearch: async () => [{ photoId: "approved-dance", similarity: 0.01 }],
      }),
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.matchType === "keyword")).toBe(true);
    expect(results.map((r) => r.photo.id)).toContain("approved-dance"); // keyword "dancing" match
  });
});

describe("searchMomentsWith: disabled flag behavior", () => {
  it("never calls the embedder or the vector search when disabled", async () => {
    let embedCalled = false;
    let vectorCalled = false;
    const results = await searchMomentsWith(
      { query: "dancing", event: null, limit: 10 },
      baseDeps({
        enabled: false,
        embedText: async () => {
          embedCalled = true;
          return fixedEmbedder()();
        },
        runVectorSearch: async () => {
          vectorCalled = true;
          return [];
        },
      }),
    );
    expect(embedCalled).toBe(false);
    expect(vectorCalled).toBe(false);
    expect(results.every((r) => r.matchType === "keyword")).toBe(true);
    expect(results.map((r) => r.photo.id)).toContain("approved-dance");
  });

  it("returns an empty array rather than throwing when disabled and nothing keyword-matches", async () => {
    const results = await searchMomentsWith(
      { query: "zzz-no-match-zzz", event: null, limit: 10 },
      baseDeps({ enabled: false }),
    );
    expect(results).toEqual([]);
  });
});

describe("searchMomentsWith: embedding-service and RPC failure fall back, never throw", () => {
  it("falls back to keyword search when embedText rejects", async () => {
    const results = await searchMomentsWith(
      { query: "dancing", event: null, limit: 10 },
      baseDeps({
        embedText: async () => {
          throw new Error("model unavailable");
        },
      }),
    );
    expect(results.every((r) => r.matchType === "keyword")).toBe(true);
  });

  it("falls back to keyword search when the vector RPC rejects", async () => {
    const results = await searchMomentsWith(
      { query: "dancing", event: null, limit: 10 },
      baseDeps({
        runVectorSearch: async () => {
          throw new Error("rpc failed");
        },
      }),
    );
    expect(results.every((r) => r.matchType === "keyword")).toBe(true);
  });

  it("still enforces the query length gate before ever calling the embedder", async () => {
    let called = false;
    await expect(
      searchMomentsWith(
        { query: "a", event: null, limit: 10 },
        baseDeps({
          embedText: async () => {
            called = true;
            return fixedEmbedder()();
          },
        }),
      ),
    ).rejects.toThrow(MomentSearchValidationError);
    expect(called).toBe(false);
  });
});

describe("searchMomentsWith: pending-photo isolation", () => {
  it("drops pending, hidden, and rejected photo ids even when the vector search returns them", async () => {
    const results = await searchMomentsWith(
      { query: "sunset kiss", event: null, limit: 10 },
      baseDeps({
        runVectorSearch: async () => [
          { photoId: "approved-dance", similarity: 0.9 },
          { photoId: "pending-photo", similarity: 0.95 },
          { photoId: "hidden-photo", similarity: 0.95 },
          { photoId: "rejected-photo", similarity: 0.95 },
        ],
      }),
    );
    const ids = results.map((r) => r.photo.id);
    expect(ids).toContain("approved-dance");
    expect(ids).not.toContain("pending-photo");
    expect(ids).not.toContain("hidden-photo");
    expect(ids).not.toContain("rejected-photo");
  });

  it("drops an id the vector search returns that no longer exists in the catalog at all", async () => {
    const results = await searchMomentsWith(
      { query: "sunset kiss", event: null, limit: 10 },
      baseDeps({
        runVectorSearch: async () => [{ photoId: "does-not-exist", similarity: 0.99 }],
      }),
    );
    expect(results.every((r) => r.photo.id !== "does-not-exist")).toBe(true);
  });

  it("the keyword fallback itself only ever returns approved photos", async () => {
    const results = await searchMomentsWith(
      { query: "dancing", event: null, limit: 10 },
      baseDeps({ enabled: false }),
    );
    const ids = results.map((r) => r.photo.id);
    expect(ids).not.toContain("pending-photo");
    expect(ids).not.toContain("hidden-photo");
    expect(ids).not.toContain("rejected-photo");
  });
});

describe("searchMomentsWith: result limit", () => {
  it("truncates embedding matches to the requested limit", async () => {
    const matches: MomentVectorMatch[] = [
      { photoId: "approved-dance", similarity: 0.9 },
      { photoId: "approved-kiss", similarity: 0.8 },
      { photoId: "approved-low-sim", similarity: 0.7 },
    ];
    const results = await searchMomentsWith(
      { query: "sunset kiss", event: null, limit: 2 },
      baseDeps({ runVectorSearch: async () => matches }),
    );
    expect(results).toHaveLength(2);
  });
});

describe("keyword dedupe against people (mirrors query.test.ts's toView coverage)", () => {
  // src/lib/search/moment-search.ts's toMomentPhotoView() is a deliberate
  // small mirror of src/lib/gallery/query.ts's toView(), including its
  // private dedupeKeywordsAgainstPeople() helper: the clean master baked
  // tagged people's names into the embedded Keywords field, so a person
  // already shown as a confirmed chip (the people caption) would otherwise
  // repeat as a keyword chip in the Lightbox. This block proves the
  // moment-search mirror drops that redundant text per-photo while leaving
  // unrelated keywords, and confirmed person chips, alone -- same fixture
  // shape and wording as tests/gallery/query.test.ts's "keyword dedupe
  // against people" block, run here through searchMomentsWith's embedding
  // path instead of getGalleryPage.

  const rachel: GalleryPersonLink = {
    slug: "rachel-casciano",
    displayName: "Rachel Casciano",
    confidence: "confirmed",
  };

  const dedupePhotos: GalleryPhotoSource[] = [
    photo({
      id: "kw-name-match",
      people: [rachel],
      // Different case and stray whitespace must still match.
      keywords: ["  Rachel Casciano  ", "GOLDEN HOUR", "rachel casciano"],
    }),
    photo({
      id: "kw-slug-match",
      people: [rachel],
      keywords: ["rachel-casciano", "first dance"],
    }),
    photo({
      id: "kw-no-match",
      people: [rachel],
      keywords: ["sunset", "bouquet toss"],
    }),
    photo({
      id: "kw-no-people",
      people: [],
      keywords: ["Rachel Casciano", "golden hour"],
    }),
    photo({
      id: "kw-unconfirmed-not-deduped",
      // Not rendered as a chip (only confirmed links are), so it must not
      // be treated as a visible duplicate either.
      people: [{ ...rachel, confidence: "uncertain" }],
      keywords: ["Rachel Casciano", "candid"],
    }),
  ];

  async function resultFor(id: string) {
    const results = await searchMomentsWith(
      { query: "sunset kiss", event: null, limit: 10 },
      baseDeps({
        dataSource: makeDataSource(dedupePhotos),
        runVectorSearch: async () => [{ photoId: id, similarity: 0.9 }],
      }),
    );
    expect(results).toHaveLength(1);
    return results[0];
  }

  async function keywordsOf(id: string): Promise<string[]> {
    return (await resultFor(id)).photo.keywords;
  }

  it("drops a keyword matching a tagged person's display name (case-insensitive, trimmed)", async () => {
    expect(await keywordsOf("kw-name-match")).toEqual(["GOLDEN HOUR"]);
  });

  it("drops a keyword matching a tagged person's slug", async () => {
    expect(await keywordsOf("kw-slug-match")).toEqual(["first dance"]);
  });

  it("keeps a keyword that matches nobody tagged on the photo", async () => {
    expect(await keywordsOf("kw-no-match")).toEqual(["sunset", "bouquet toss"]);
  });

  it("keeps every keyword on a photo with no tagged people", async () => {
    expect(await keywordsOf("kw-no-people")).toEqual([
      "Rachel Casciano",
      "golden hour",
    ]);
  });

  it("does not dedupe against a person who is only uncertain, not confirmed", async () => {
    expect(await keywordsOf("kw-unconfirmed-not-deduped")).toEqual([
      "Rachel Casciano",
      "candid",
    ]);
  });

  it("leaves person chips untouched", async () => {
    const result = await resultFor("kw-name-match");
    expect(result.photo.people).toEqual([
      { slug: "rachel-casciano", displayName: "Rachel Casciano" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// serializeMomentResults: signs previews and never leaks an object path
// ---------------------------------------------------------------------------

describe("serializeMomentResults", () => {
  function fakeSigningClient(): SupabaseClient<Database> {
    const fake = {
      storage: {
        from: () => ({
          createSignedUrls: async (paths: string[]) => ({
            data: paths.map((p) => ({
              path: p,
              signedUrl: `https://signed.example.invalid/${encodeURIComponent(p)}`,
              error: null,
            })),
            error: null,
          }),
        }),
      },
    };
    return fake as unknown as SupabaseClient<Database>;
  }

  it("replaces object paths with signed URLs and never exposes an object path", async () => {
    const results = await searchMomentsWith(
      { query: "sunset kiss", event: null, limit: 10 },
      baseDeps({
        runVectorSearch: async () => [{ photoId: "approved-dance", similarity: 0.9 }],
      }),
    );
    const client = fakeSigningClient();
    const serialized = await serializeMomentResults(results, client);
    expect(serialized).toHaveLength(1);
    const [first] = serialized;
    expect(first.photo.previews.length).toBeGreaterThan(0);
    for (const preview of first.photo.previews) {
      expect(preview.url).toMatch(/^https:\/\/signed\.example\.invalid\//);
      expect(preview).not.toHaveProperty("objectPath");
      expect(preview).not.toHaveProperty("bucket");
    }
    expect(JSON.stringify(serialized)).not.toContain("previews/approved-dance");
  });

  it("preserves similarity and matchType through serialization", async () => {
    const results = await searchMomentsWith(
      { query: "sunset kiss", event: null, limit: 10 },
      baseDeps({
        runVectorSearch: async () => [{ photoId: "approved-dance", similarity: 0.42 }],
      }),
    );
    const serialized = await serializeMomentResults(results, fakeSigningClient());
    expect(serialized[0].similarity).toBe(0.42);
    expect(serialized[0].matchType).toBe("embedding");
  });

  it("preserves an approved uploader caption through serialization", async () => {
    const captioned = photo({
      id: "approved-caption",
      approvedCaption: {
        text: "The dance floor opened with this song.",
        byline: null,
      },
    });
    const results = await searchMomentsWith(
      { query: "first dance", event: null, limit: 10 },
      baseDeps({
        dataSource: makeDataSource([captioned]),
        runVectorSearch: async () => [
          { photoId: captioned.id, similarity: 0.9 },
        ],
      }),
    );

    const serialized = await serializeMomentResults(
      results,
      fakeSigningClient(),
    );

    expect(serialized[0].photo.approvedCaption).toEqual({
      text: "The dance floor opened with this song.",
      byline: null,
    });
  });
});
