import { describe, expect, it } from "vitest";
import {
  displayEventName,
  compareBySortKey,
  decodeCursor,
  encodeCursor,
  getGalleryFacets,
  getGalleryPage,
  getPhotoDetail,
  GalleryQueryError,
  MAX_GALLERY_SEARCH_LENGTH,
  MAX_GALLERY_LIMIT,
  DEFAULT_GALLERY_LIMIT,
  type GalleryDataSource,
  type GalleryPersonLink,
  type GalleryPhotoSource,
  type GallerySort,
} from "@/lib/gallery/query";
import { buildGalleryFixture } from "../fixtures/gallery/catalog";

const fixture = buildGalleryFixture();
const { dataSource, approved } = fixture;

function keyOf(photo: GalleryPhotoSource) {
  return {
    eventOrder: photo.eventOrder,
    capturedAt: photo.capturedAt,
    originalFilename: photo.originalFilename,
    id: photo.id,
  };
}

async function pageAll(
  input: Parameters<typeof getGalleryPage>[0],
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let guard = 0;
  do {
    const page = await getGalleryPage({ ...input, cursor }, dataSource);
    ids.push(...page.photos.map((p) => p.id));
    cursor = page.nextCursor;
    guard += 1;
    if (guard > 10_000) throw new Error("paging did not terminate");
  } while (cursor !== null);
  return ids;
}

function expectedOrder(
  photos: GalleryPhotoSource[],
  sort: GallerySort,
): string[] {
  return [...photos]
    .sort((a, b) => compareBySortKey(keyOf(a), keyOf(b), sort))
    .map((p) => p.id);
}

describe("gallery fixture", () => {
  it("has the full 1,721-photo approved catalog plus non-approved rows", () => {
    expect(approved).toHaveLength(1721);
    expect(fixture.photos.length).toBeGreaterThan(1721);
  });
});

describe("getGalleryPage cursor stability", () => {
  for (const sort of ["weekend", "newest"] as const) {
    it(`pages the whole catalog with no duplicates or gaps (sort=${sort})`, async () => {
      const ids = await pageAll({ sort, limit: 60 });
      // No duplicates.
      expect(new Set(ids).size).toBe(ids.length);
      // Exactly the approved set, no gaps, no extras.
      expect(ids).toHaveLength(1721);
      // Byte-for-byte the deterministic sorted order.
      expect(ids).toEqual(expectedOrder(approved, sort));
    });
  }

  it("reports a stable total independent of cursor/limit", async () => {
    const first = await getGalleryPage({ limit: 10 }, dataSource);
    expect(first.total).toBe(1721);
    const next = await getGalleryPage(
      { limit: 10, cursor: first.nextCursor },
      dataSource,
    );
    expect(next.total).toBe(1721);
  });

  it("returns a null nextCursor on the final page", async () => {
    const small = buildGalleryFixture(5).dataSource;
    const page = await getGalleryPage({ limit: 60 }, small);
    expect(page.photos).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });

  it("sets signedUrlExpiresAt in the future", async () => {
    const page = await getGalleryPage({ limit: 1 }, dataSource);
    expect(new Date(page.signedUrlExpiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });
});

describe("getGalleryPage limits", () => {
  it("defaults to 60 and clamps to the maximum", async () => {
    const dflt = await getGalleryPage({}, dataSource);
    expect(dflt.photos).toHaveLength(DEFAULT_GALLERY_LIMIT);
    const over = await getGalleryPage({ limit: 1000 }, dataSource);
    expect(over.photos).toHaveLength(MAX_GALLERY_LIMIT);
  });

  it("coerces non-positive or non-finite limits to the default", async () => {
    for (const bad of [0, -5, Number.NaN]) {
      const page = await getGalleryPage({ limit: bad }, dataSource);
      expect(page.photos).toHaveLength(DEFAULT_GALLERY_LIMIT);
    }
  });
});

describe("status isolation", () => {
  it("never returns pending, hidden, or rejected photos in any page", async () => {
    const ids = await pageAll({ limit: 200 });
    const forbidden = new Set([
      fixture.pendingId,
      "pending-0002",
      fixture.hiddenId,
      fixture.rejectedId,
    ]);
    for (const id of ids) expect(forbidden.has(id)).toBe(false);
    expect(ids.every((id) => id.startsWith("photo-"))).toBe(true);
  });
});

describe("filters", () => {
  it("searches event, confirmed-person, keyword, and filename metadata", async () => {
    const byEventAndKeyword = await getGalleryPage(
      { q: "event-03 ceremony", limit: 100 },
      dataSource,
    );
    const expectedEventAndKeyword = approved.filter(
      (photo) =>
        photo.eventName === "Event 3" &&
        photo.keywords.includes("ceremony"),
    );
    expect(byEventAndKeyword.total).toBe(expectedEventAndKeyword.length);
    expect(
      byEventAndKeyword.photos.every((photo) => photo.eventName === "Event 3"),
    ).toBe(true);

    const filenameTarget = approved[42];
    const byFilename = await getGalleryPage(
      { q: filenameTarget.originalFilename.toLocaleLowerCase("en-US") },
      dataSource,
    );
    expect(byFilename.photos.map((photo) => photo.id)).toContain(
      filenameTarget.id,
    );

    const byPerson = await getGalleryPage({ q: "person-00", limit: 100 }, dataSource);
    expect(byPerson.total).toBeGreaterThan(0);
    expect(
      byPerson.photos.every((photo) =>
        photo.people.some((person) => person.slug === "person-00"),
      ),
    ).toBe(true);
  });

  it("does not expose uncertain or background people through search", async () => {
    const page = await getGalleryPage({ q: "Ghost Guest" }, dataSource);
    expect(page.total).toBe(0);
    expect(page.photos).toHaveLength(0);
  });

  it("filters by event and totals match", async () => {
    const slug = fixture.events[3].slug;
    const page = await getGalleryPage({ event: slug, limit: 100 }, dataSource);
    const expected = approved.filter((p) => p.eventSlug === slug).length;
    expect(page.total).toBe(expected);
    const ids = await pageAll({ event: slug, limit: 100 });
    expect(ids).toHaveLength(expected);
    expect(new Set(ids).size).toBe(expected);
  });

  it("filters by orientation", async () => {
    const page = await getGalleryPage(
      { orientation: "portrait", limit: 100 },
      dataSource,
    );
    const expected = approved.filter((p) => p.orientation === "portrait").length;
    expect(page.total).toBe(expected);
    expect(page.photos.every((p) => p.orientation === "portrait")).toBe(true);
  });

  it("filters by source using client vocabulary", async () => {
    const guest = await getGalleryPage(
      { source: "guest", limit: 100 },
      dataSource,
    );
    const expected = approved.filter((p) => p.source === "guest").length;
    expect(guest.total).toBe(expected);
    expect(guest.photos.every((p) => p.source === "guest")).toBe(true);
  });

  it("applies conjunctive filters", async () => {
    const slug = fixture.events[1].slug;
    const page = await getGalleryPage(
      { event: slug, orientation: "landscape", source: "photographer", limit: 100 },
      dataSource,
    );
    const expected = approved.filter(
      (p) =>
        p.eventSlug === slug &&
        p.orientation === "landscape" &&
        p.source === "photographer",
    ).length;
    expect(page.total).toBe(expected);
  });

  it("filters by a confirmed person only", async () => {
    const ids = await pageAll({
      person: fixture.confirmedPersonSlug,
      limit: 200,
    });
    const expected = approved.filter((p) =>
      p.people.some(
        (link) =>
          link.slug === fixture.confirmedPersonSlug &&
          link.confidence === "confirmed",
      ),
    ).map((p) => p.id);
    expect(new Set(ids)).toEqual(new Set(expected));
    expect(ids.length).toBeGreaterThan(0);
  });

  it("never matches a person that is only uncertain or background", async () => {
    const page = await getGalleryPage(
      { person: fixture.ghostPersonSlug, limit: 100 },
      dataSource,
    );
    expect(page.total).toBe(0);
    expect(page.photos).toHaveLength(0);
  });
});

describe("confirmed-only people in views", () => {
  it("omits non-confirmed person links from photo views", async () => {
    // Find an approved photo that carries a ghost (non-confirmed) link.
    const withGhost = approved.find((p) =>
      p.people.some((link) => link.slug === fixture.ghostPersonSlug),
    );
    expect(withGhost).toBeDefined();
    const page = await getGalleryPage(
      { ids: [withGhost!.id] },
      dataSource,
    );
    expect(page.photos).toHaveLength(1);
    const slugs = page.photos[0].people.map((p) => p.slug);
    expect(slugs).not.toContain(fixture.ghostPersonSlug);
    expect(
      page.photos[0].people.every((p) => typeof p.displayName === "string"),
    ).toBe(true);
  });
});

describe("keyword dedupe against people", () => {
  // The clean master baked final_people into embedded Keywords, so a person
  // already shown as a confirmed chip would otherwise repeat as plain
  // keyword text. This block proves toView() drops that redundant text
  // per-photo while leaving unrelated keywords, and person chips, alone.

  function keywordPhoto(
    overrides: Partial<GalleryPhotoSource> & { id: string },
  ): GalleryPhotoSource {
    return {
      status: "published",
      source: "photographer",
      eventSlug: "reception",
      eventName: "Reception",
      eventOrder: 1,
      capturedAt: "2025-07-19T20:00:00.000Z",
      originalFilename: `${overrides.id}.jpg`,
      width: 6000,
      height: 4000,
      orientation: "landscape",
      people: [],
      keywords: [],
      previews: [],
      ...overrides,
    };
  }

  const rachel: GalleryPersonLink = {
    slug: "rachel-casciano",
    displayName: "Rachel Casciano",
    confidence: "confirmed",
  };

  const keywordPhotos: GalleryPhotoSource[] = [
    keywordPhoto({
      id: "kw-name-match",
      people: [rachel],
      // Different case and stray whitespace must still match.
      keywords: ["  Rachel Casciano  ", "GOLDEN HOUR", "rachel casciano"],
    }),
    keywordPhoto({
      id: "kw-slug-match",
      people: [rachel],
      keywords: ["rachel-casciano", "first dance"],
    }),
    keywordPhoto({
      id: "kw-no-match",
      people: [rachel],
      keywords: ["sunset", "bouquet toss"],
    }),
    keywordPhoto({
      id: "kw-no-people",
      people: [],
      keywords: ["Rachel Casciano", "golden hour"],
    }),
    keywordPhoto({
      id: "kw-unconfirmed-not-deduped",
      // Not rendered as a chip (only confirmed links are), so it must not
      // be treated as a visible duplicate either.
      people: [{ ...rachel, confidence: "uncertain" }],
      keywords: ["Rachel Casciano", "candid"],
    }),
  ];

  const keywordSource: GalleryDataSource = {
    async listPhotos() {
      return keywordPhotos;
    },
    async listEvents() {
      return [{ slug: "reception", name: "Reception", order: 1 }];
    },
    async listPeople() {
      return [{ slug: "rachel-casciano", displayName: "Rachel Casciano" }];
    },
  };

  async function keywordsOf(id: string): Promise<string[]> {
    const page = await getGalleryPage({ ids: [id] }, keywordSource);
    expect(page.photos).toHaveLength(1);
    return page.photos[0].keywords;
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
    const page = await getGalleryPage(
      { ids: ["kw-name-match"] },
      keywordSource,
    );
    expect(page.photos[0].people).toEqual([
      { slug: "rachel-casciano", displayName: "Rachel Casciano" },
    ]);
  });

  it("still dedupes the pre-rename catalog name after an admin rename", async () => {
    // An admin rename replaces displayName, but the photo's embedded keyword
    // still carries the original catalog name. Without previousDisplayName the
    // Notes panel would show the corrected name as a chip AND the obsolete one
    // as a keyword beside it.
    const renamedSource = {
      ...keywordSource,
      listPhotos: async () => [
        keywordPhoto({
          id: "kw-renamed",
          people: [
            {
              slug: "rachel-casciano",
              displayName: "Rachel Soskin",
              previousDisplayName: "Rachel Casciano",
              confidence: "confirmed" as const,
            },
          ],
          keywords: ["Rachel Casciano", "golden hour"],
        }),
      ],
    };
    const page = await getGalleryPage({ ids: ["kw-renamed"] }, renamedSource);
    expect(page.photos[0].keywords).toEqual(["golden hour"]);
    expect(page.photos[0].people).toEqual([
      { slug: "rachel-casciano", displayName: "Rachel Soskin" },
    ]);
  });
});

describe("ids exact-order lookup", () => {
  it("returns exactly the requested approved ids in order", async () => {
    const wanted = [
      fixture.approvedIds[10],
      fixture.approvedIds[2],
      fixture.approvedIds[999],
    ];
    const page = await getGalleryPage({ ids: wanted }, dataSource);
    expect(page.photos.map((p) => p.id)).toEqual(wanted);
    expect(page.total).toBe(3);
    expect(page.nextCursor).toBeNull();
  });

  it("ignores other filters when ids are set", async () => {
    const wanted = [fixture.approvedIds[0], fixture.approvedIds[1]];
    const page = await getGalleryPage(
      { ids: wanted, event: "event-13", orientation: "square", person: "ghost" },
      dataSource,
    );
    expect(page.photos.map((p) => p.id)).toEqual(wanted);
  });

  it("drops unknown ids", async () => {
    const page = await getGalleryPage(
      { ids: ["does-not-exist", fixture.approvedIds[5]] },
      dataSource,
    );
    expect(page.photos.map((p) => p.id)).toEqual([fixture.approvedIds[5]]);
  });

  it("de-duplicates repeated ids, keeping first occurrence order", async () => {
    const id = fixture.approvedIds[7];
    const page = await getGalleryPage(
      { ids: [id, fixture.approvedIds[8], id] },
      dataSource,
    );
    expect(page.photos.map((p) => p.id)).toEqual([id, fixture.approvedIds[8]]);
  });

  it("never returns pending or rejected ids even when explicitly requested", async () => {
    const page = await getGalleryPage(
      {
        ids: [fixture.pendingId, fixture.rejectedId, fixture.hiddenId, fixture.approvedIds[3]],
      },
      dataSource,
    );
    expect(page.photos.map((p) => p.id)).toEqual([fixture.approvedIds[3]]);
  });

  it("accepts an empty ids array as an empty result (not all photos)", async () => {
    const page = await getGalleryPage({ ids: [] }, dataSource);
    expect(page.photos).toHaveLength(0);
    expect(page.total).toBe(0);
  });

  it("rejects more than 100 ids", async () => {
    const many = Array.from({ length: 101 }, (_, i) => `photo-${i}`);
    await expect(getGalleryPage({ ids: many }, dataSource)).rejects.toBeInstanceOf(
      GalleryQueryError,
    );
  });
});

describe("invalid inputs", () => {
  it("rejects invalid orientation, source, and sort", async () => {
    await expect(
      getGalleryPage({ orientation: "diagonal" as never }, dataSource),
    ).rejects.toBeInstanceOf(GalleryQueryError);
    await expect(
      getGalleryPage({ source: "admin" as never }, dataSource),
    ).rejects.toBeInstanceOf(GalleryQueryError);
    await expect(
      getGalleryPage({ sort: "oldest" as never }, dataSource),
    ).rejects.toBeInstanceOf(GalleryQueryError);
  });

  it("rejects malformed person/event slugs", async () => {
    await expect(
      getGalleryPage({ person: "Not A Slug" }, dataSource),
    ).rejects.toBeInstanceOf(GalleryQueryError);
  });

  it("rejects overlong search input", async () => {
    await expect(
      getGalleryPage({ q: "x".repeat(MAX_GALLERY_SEARCH_LENGTH + 1) }, dataSource),
    ).rejects.toBeInstanceOf(GalleryQueryError);
  });

  it("rejects a malformed cursor", async () => {
    await expect(
      getGalleryPage({ cursor: "!!!not-base64!!!" }, dataSource),
    ).rejects.toBeInstanceOf(GalleryQueryError);
  });

  it("rejects a cursor minted for a different sort", async () => {
    const first = await getGalleryPage({ sort: "weekend", limit: 5 }, dataSource);
    expect(first.nextCursor).not.toBeNull();
    await expect(
      getGalleryPage(
        { sort: "newest", cursor: first.nextCursor },
        dataSource,
      ),
    ).rejects.toBeInstanceOf(GalleryQueryError);
  });
});

describe("cursor codec round-trip", () => {
  it("round-trips a sort key", () => {
    const photo = approved[42];
    const cursor = encodeCursor(photo, "weekend");
    const key = decodeCursor(cursor, "weekend");
    expect(key).toEqual(keyOf(photo));
  });
});

describe("getGalleryFacets", () => {
  it("counts events by approved membership and sums to the catalog total", async () => {
    const facets = await getGalleryFacets(dataSource);
    const sum = facets.events.reduce((acc, e) => acc + e.count, 0);
    expect(sum).toBe(1721);
    expect(facets.events.every((e) => e.count > 0)).toBe(true);
    // Sorted by canonical weekend order.
    const orders = facets.events.map((e) =>
      fixture.events.find((ev) => ev.slug === e.slug)!.order,
    );
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("counts people from confirmed links only and excludes ghost", async () => {
    const facets = await getGalleryFacets(dataSource);
    const slugs = facets.people.map((p) => p.slug);
    expect(slugs).not.toContain(fixture.ghostPersonSlug);
    const confirmed = facets.people.find(
      (p) => p.slug === fixture.confirmedPersonSlug,
    );
    expect(confirmed).toBeDefined();
    expect(confirmed!.count).toBeGreaterThan(0);
    // Sorted by count desc.
    const counts = facets.people.map((p) => p.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("cross-checks a person count against a direct scan", async () => {
    const facets = await getGalleryFacets(dataSource);
    const direct = approved.filter((p) =>
      p.people.some(
        (link) =>
          link.slug === fixture.confirmedPersonSlug &&
          link.confidence === "confirmed",
      ),
    ).length;
    const facet = facets.people.find(
      (p) => p.slug === fixture.confirmedPersonSlug,
    );
    expect(facet!.count).toBe(direct);
  });
});

describe("event display names", () => {
  it("clarifies that Film means still photography from a film camera", () => {
    expect(displayEventName("film", "Film")).toBe("Film Camera");
    expect(displayEventName("ceremony", "Ceremony")).toBe("Ceremony");
  });
});

describe("getPhotoDetail", () => {
  it("returns null for unknown ids", async () => {
    expect(await getPhotoDetail("nope", dataSource)).toBeNull();
  });

  it("returns null for a pending photo (never leaks its existence)", async () => {
    expect(await getPhotoDetail(fixture.pendingId, dataSource)).toBeNull();
  });

  it("returns the photo plus related, excluding itself and non-approved", async () => {
    const id = fixture.approvedIds[500];
    const detail = await getPhotoDetail(id, dataSource, 12);
    expect(detail).not.toBeNull();
    expect(detail!.photo.id).toBe(id);
    expect(detail!.related.length).toBeLessThanOrEqual(12);
    expect(detail!.related.every((r) => r.id !== id)).toBe(true);
    const approvedIdSet = new Set(fixture.approvedIds);
    expect(detail!.related.every((r) => approvedIdSet.has(r.id))).toBe(true);
  });

  it("prioritizes photos that share confirmed people", async () => {
    // Pick a photo with at least one confirmed person.
    const seed = approved.find(
      (p) => p.people.filter((l) => l.confidence === "confirmed").length > 0,
    )!;
    const detail = await getPhotoDetail(seed.id, dataSource, 8);
    const seedPeople = new Set(
      seed.people.filter((l) => l.confidence === "confirmed").map((l) => l.slug),
    );
    const sharedFlags = detail!.related.map((r) =>
      r.people.some((p) => seedPeople.has(p.slug)) ? 1 : 0,
    );
    // Once a non-sharing related photo appears, no sharing one follows it.
    let sawZero = false;
    for (const flag of sharedFlags) {
      if (flag === 0) sawZero = true;
      if (flag === 1) expect(sawZero).toBe(false);
    }
  });
});
