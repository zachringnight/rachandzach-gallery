/**
 * Keyword-chip data flow through the client serialization boundary
 * (keyword-tags feature). Proves two things serialize.ts must get right now
 * that ClientPhoto carries `keywords`:
 *
 *  - The full pipeline (GalleryDataSource -> query.ts's getGalleryPage /
 *    getPhotoDetail -> serialize.ts's serializeGalleryPage /
 *    serializePhotoDetail) still lands the people-deduped keyword list on
 *    the client DTO. query.ts's own dedupe logic is already covered in
 *    depth by the "keyword dedupe against people" block in
 *    tests/gallery/query.test.ts; this file only asserts the result
 *    survives the extra serialize.ts hop unchanged.
 *  - Adding `keywords` did not open a new leak: serialized output never
 *    contains an internal object path or bucket name, mirroring the
 *    existing privacy assertions in tests/search/moment-search.test.ts's
 *    serializeMomentResults block.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// serialize.ts starts with `import "server-only"`, a marker package that
// throws unless the bundler resolves its "react-server" export condition
// (see src/lib/search/moment-search.ts's "Import hygiene" doc comment for
// the same constraint on that file). Plain Vitest does not set that
// condition, so importing serialize.ts here would throw before any test
// runs. Mocking the marker to a no-op is the standard way to unit test a
// server-only-tagged module directly; it only affects this test file's
// module graph, not the real guard Next.js enforces when bundling for the
// browser.
vi.mock("server-only", () => ({}));
import {
  getGalleryPage,
  getPhotoDetail,
  type GalleryDataSource,
  type GalleryPersonLink,
  type GalleryPhotoSource,
  type GalleryPhotoView,
  type GalleryPage,
  type GalleryPhotoDetail,
} from "@/lib/gallery/query";
import { serializeGalleryPage, serializePhotoDetail } from "@/lib/gallery/serialize";

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

// ---------------------------------------------------------------------------
// End-to-end: the query-layer dedupe survives the serialize.ts hop
// ---------------------------------------------------------------------------

const rachel: GalleryPersonLink = {
  slug: "rachel-casciano",
  displayName: "Rachel Casciano",
  confidence: "confirmed",
};

function e2ePhotoSource(): GalleryPhotoSource {
  return {
    id: "kw-e2e",
    status: "published",
    source: "photographer",
    eventSlug: "reception",
    eventName: "Reception",
    eventOrder: 1,
    capturedAt: "2025-07-19T20:00:00.000Z",
    originalFilename: "kw-e2e.jpg",
    width: 6000,
    height: 4000,
    orientation: "landscape",
    people: [rachel],
    // "Rachel Casciano" duplicates the confirmed person chip and must not
    // reach the client; "golden hour" names nobody and must survive.
    keywords: ["Rachel Casciano", "golden hour"],
    previews: [
      {
        objectPath: "previews/kw-e2e-hash/1200.jpg",
        bucket: "rachandzach-previews",
        width: 1200,
        format: "jpeg",
      },
    ],
  };
}

function e2eDataSource(): GalleryDataSource {
  return {
    async listPhotos() {
      return [e2ePhotoSource()];
    },
    async listEvents() {
      return [{ slug: "reception", name: "Reception", order: 1 }];
    },
    async listPeople() {
      return [{ slug: "rachel-casciano", displayName: "Rachel Casciano" }];
    },
  };
}

describe("keyword chips: end-to-end through serialization", () => {
  it("ClientPhoto.keywords from getGalleryPage keeps the person-deduped list, not the raw one", async () => {
    const dataSource = e2eDataSource();
    const page = await getGalleryPage({ ids: ["kw-e2e"] }, dataSource);
    const client = await serializeGalleryPage(page, fakeSigningClient());

    expect(client.photos).toHaveLength(1);
    expect(client.photos[0].keywords).toEqual(["golden hour"]);
    // The dedupe target -- the person's own name -- must be gone, and the
    // person chip itself must be untouched.
    expect(client.photos[0].keywords).not.toContain("Rachel Casciano");
    expect(client.photos[0].people).toEqual([
      { slug: "rachel-casciano", displayName: "Rachel Casciano" },
    ]);
  });

  it("ClientPhotoDetail.photo.keywords from getPhotoDetail keeps the same dedupe", async () => {
    const dataSource = e2eDataSource();
    const detail = await getPhotoDetail("kw-e2e", dataSource);
    expect(detail).not.toBeNull();
    const client = await serializePhotoDetail(detail!, fakeSigningClient());

    expect(client.photo.keywords).toEqual(["golden hour"]);
  });
});

// ---------------------------------------------------------------------------
// serialize.ts boundary in isolation: shape, empties, and privacy
// ---------------------------------------------------------------------------

function view(overrides: Partial<GalleryPhotoView> & { id: string }): GalleryPhotoView {
  return {
    eventSlug: "reception",
    eventName: "Reception",
    source: "photographer",
    orientation: "landscape",
    width: 6000,
    height: 4000,
    aspectRatio: 1.5,
    capturedAt: "2025-07-19T20:00:00.000Z",
    people: [],
    keywords: [],
    previews: [
      {
        objectPath: `previews/${overrides.id}-super-secret-hash/1200.jpg`,
        bucket: "rachandzach-previews",
        width: 1200,
        height: 800,
        format: "jpeg",
      },
    ],
    ...overrides,
    approvedCaption: overrides.approvedCaption ?? null,
  };
}

describe("serializeGalleryPage: keywords field", () => {
  it("copies keywords onto ClientPhoto in the given order", async () => {
    const page: GalleryPage = {
      photos: [view({ id: "p1", keywords: ["golden hour", "first dance"] })],
      nextCursor: null,
      total: 1,
      signedUrlExpiresAt: new Date().toISOString(),
    };
    const client = await serializeGalleryPage(page, fakeSigningClient());
    expect(client.photos[0].keywords).toEqual(["golden hour", "first dance"]);
  });

  it("keeps an empty keyword list an empty array, not undefined or missing", async () => {
    const page: GalleryPage = {
      photos: [view({ id: "p2", keywords: [] })],
      nextCursor: null,
      total: 1,
      signedUrlExpiresAt: new Date().toISOString(),
    };
    const client = await serializeGalleryPage(page, fakeSigningClient());
    expect(client.photos[0]).toHaveProperty("keywords");
    expect(client.photos[0].keywords).toEqual([]);
  });

  it("never leaks an object path or bucket name, with or without keywords present", async () => {
    const page: GalleryPage = {
      photos: [view({ id: "p3", keywords: ["golden hour"] })],
      nextCursor: null,
      total: 1,
      signedUrlExpiresAt: new Date().toISOString(),
    };
    const client = await serializeGalleryPage(page, fakeSigningClient());
    const serialized = JSON.stringify(client);
    expect(serialized).not.toContain("objectPath");
    // The raw path (with its literal slash) must be gone; the fake signed
    // URL legitimately contains the same characters URL-encoded (%2F), which
    // is expected and fine -- mirrors tests/search/moment-search.test.ts's
    // "never exposes an object path" assertion.
    expect(serialized).not.toContain("previews/p3-super-secret-hash");
    expect(client.photos[0].previews[0]).not.toHaveProperty("objectPath");
    expect(client.photos[0].previews[0]).not.toHaveProperty("bucket");
  });
});

// ---------------------------------------------------------------------------
// AVIF <picture> fallback signing: for each width whose best format is AVIF,
// the nearest WebP/JPEG derivative is signed alongside it so PhotoImage's
// <picture> negotiation has a universally-decodable <img src>. Bounded: one
// extra URL per width, never the whole WebP ladder.
// ---------------------------------------------------------------------------

type PreviewRow = NonNullable<GalleryPhotoView["previews"]>[number];

function previewRow(
  id: string,
  width: number,
  format: "avif" | "webp" | "jpeg",
): PreviewRow {
  return {
    objectPath: `previews/${id}-hash/${width}.${format}`,
    bucket: "rachandzach-previews",
    width,
    height: Math.round((width * 2) / 3),
    format,
  };
}

async function serializedPreviews(previews: PreviewRow[]) {
  const page: GalleryPage = {
    photos: [view({ id: "fb", previews })],
    nextCursor: null,
    total: 1,
    signedUrlExpiresAt: new Date().toISOString(),
  };
  const client = await serializeGalleryPage(page, fakeSigningClient());
  return client.photos[0].previews;
}

describe("serializeGalleryPage: WebP fallback signing", () => {
  it("signs both the AVIF primary and the same-width WebP for every width, and nothing more", async () => {
    const out = await serializedPreviews([
      previewRow("fb", 480, "avif"),
      previewRow("fb", 480, "webp"),
      previewRow("fb", 960, "avif"),
      previewRow("fb", 960, "webp"),
      previewRow("fb", 1600, "avif"),
      previewRow("fb", 1600, "webp"),
      previewRow("fb", 2400, "avif"),
      previewRow("fb", 2400, "jpeg"),
    ]);
    const shapes = out.map((p) => `${p.width}.${p.format}`);
    expect(shapes).toEqual([
      "480.webp",
      "480.avif",
      "960.webp",
      "960.avif",
      "1600.webp",
      "1600.avif",
      "2400.jpeg",
      "2400.avif",
    ]);
  });

  it("picks the nearest WebP width when no exact-width WebP exists", async () => {
    const out = await serializedPreviews([
      previewRow("fb", 2400, "avif"),
      previewRow("fb", 1600, "webp"),
      previewRow("fb", 480, "webp"),
    ]);
    const shapes = out.map((p) => `${p.width}.${p.format}`);
    // Widths kept: 2400 (avif best) plus the stored webp widths as their own
    // one-format widths; the 2400 avif's companion is the CLOSEST webp
    // (1600), which is already present -- no duplicate entry.
    expect(shapes).toContain("2400.avif");
    expect(shapes).toContain("1600.webp");
    expect(shapes.filter((s) => s === "1600.webp")).toHaveLength(1);
  });

  it("prefers a same-width JPEG over a distant WebP as the fallback", async () => {
    const out = await serializedPreviews([
      previewRow("fb", 2400, "avif"),
      previewRow("fb", 2400, "jpeg"),
      previewRow("fb", 480, "webp"),
    ]);
    const shapes = out.map((p) => `${p.width}.${p.format}`);
    expect(shapes).toContain("2400.jpeg");
    expect(shapes).toContain("2400.avif");
  });

  it("keeps an AVIF-only photo exactly as before: no fallback, no failure", async () => {
    const out = await serializedPreviews([
      previewRow("fb", 480, "avif"),
      previewRow("fb", 960, "avif"),
    ]);
    expect(out.map((p) => `${p.width}.${p.format}`)).toEqual([
      "480.avif",
      "960.avif",
    ]);
  });

  it("adds nothing for widths whose best format is already universal", async () => {
    const out = await serializedPreviews([
      previewRow("fb", 480, "webp"),
      previewRow("fb", 960, "avif"),
      previewRow("fb", 960, "webp"),
    ]);
    expect(out.map((p) => `${p.width}.${p.format}`)).toEqual([
      "480.webp",
      "960.webp",
      "960.avif",
    ]);
  });
});

describe("serializeGalleryPage: approved uploader captions", () => {
  it("copies only the public caption fields onto the client photo", async () => {
    const page: GalleryPage = {
      photos: [
        view({
          id: "captioned",
          approvedCaption: {
            text: "The best view of the first dance.",
            byline: "Jamie",
          },
        }),
      ],
      nextCursor: null,
      total: 1,
      signedUrlExpiresAt: new Date().toISOString(),
    };

    const client = await serializeGalleryPage(page, fakeSigningClient());
    expect(client.photos[0].approvedCaption).toEqual({
      text: "The best view of the first dance.",
      byline: "Jamie",
    });
  });

  it("serializes an unapproved or absent caption as null", async () => {
    const page: GalleryPage = {
      photos: [view({ id: "no-caption", approvedCaption: null })],
      nextCursor: null,
      total: 1,
      signedUrlExpiresAt: new Date().toISOString(),
    };

    const client = await serializeGalleryPage(page, fakeSigningClient());
    expect(client.photos[0].approvedCaption).toBeNull();
  });
});

describe("serializePhotoDetail: keywords field", () => {
  it("copies keywords on both the primary photo and every related photo", async () => {
    const detail: GalleryPhotoDetail = {
      photo: view({ id: "main", keywords: ["sunset", "toast"] }),
      related: [
        view({ id: "related-1", keywords: ["dancing"] }),
        view({ id: "related-2", keywords: [] }),
      ],
      signedUrlExpiresAt: new Date().toISOString(),
    };
    const client = await serializePhotoDetail(detail, fakeSigningClient());
    expect(client.photo.keywords).toEqual(["sunset", "toast"]);
    expect(client.related[0].keywords).toEqual(["dancing"]);
    expect(client.related[1].keywords).toEqual([]);
  });

  it("never leaks an object path or bucket name through the detail payload", async () => {
    const detail: GalleryPhotoDetail = {
      photo: view({ id: "main2", keywords: ["golden hour"] }),
      related: [],
      signedUrlExpiresAt: new Date().toISOString(),
    };
    const client = await serializePhotoDetail(detail, fakeSigningClient());
    const serialized = JSON.stringify(client);
    expect(serialized).not.toContain("objectPath");
    expect(serialized).not.toContain("previews/main2-super-secret-hash");
  });
});
