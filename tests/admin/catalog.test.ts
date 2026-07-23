import { describe, expect, it } from "vitest";

import {
  catalogCompleteness,
  filterAdminCatalogPhotos,
  parseAdminCatalogFilters,
  parseCatalogMetadataPatch,
  type AdminCatalogFilters,
} from "@/lib/admin/catalog";
import type { GalleryPhotoSource } from "@/lib/gallery/query";
import { buildGalleryFixture } from "../fixtures/gallery/catalog";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function filters(
  patch: Partial<AdminCatalogFilters> = {},
): AdminCatalogFilters {
  return {
    query: "",
    needs: "all",
    event: null,
    person: null,
    source: null,
    sort: "weekend",
    ...patch,
  };
}

function photo(
  patch: Partial<GalleryPhotoSource> = {},
): GalleryPhotoSource {
  const base = buildGalleryFixture(1).approved[0];
  return {
    ...base,
    eventSlug: "ceremony",
    eventName: "Ceremony",
    originalFilename: "RZ-Ceremony-001.jpg",
    people: [
      {
        slug: "rachel",
        displayName: "Rachel",
        confidence: "confirmed",
      },
    ],
    keywords: ["first kiss", "flowers"],
    ...patch,
  };
}

describe("admin catalog filters", () => {
  it("normalizes URL input and falls back from invalid values", () => {
    expect(
      parseAdminCatalogFilters(
        new URLSearchParams(
          "q=%20Rachel%20&needs=missing-people&source=guest&sort=newest&event=ceremony",
        ),
      ),
    ).toEqual({
      query: "Rachel",
      needs: "missing-people",
      event: "ceremony",
      person: null,
      source: "guest",
      sort: "newest",
    });

    expect(
      parseAdminCatalogFilters(
        new URLSearchParams("needs=bogus&source=other&event=../bad&sort=oldest"),
      ),
    ).toEqual(filters());
  });

  it("searches across filename, event, people, and keywords", () => {
    const photos = [
      photo(),
      photo({
        id: "second",
        originalFilename: "Dancefloor-044.jpg",
        eventSlug: "dancing",
        eventName: "Dancing",
        people: [],
        keywords: ["disco ball"],
      }),
    ];

    expect(
      filterAdminCatalogPhotos(photos, filters({ query: "rachel" })).map(
        (item) => item.id,
      ),
    ).toEqual([photos[0].id]);
    expect(
      filterAdminCatalogPhotos(photos, filters({ query: "disco" })).map(
        (item) => item.id,
      ),
    ).toEqual(["second"]);
    expect(
      filterAdminCatalogPhotos(
        photos,
        filters({ needs: "missing-people" }),
      ).map((item) => item.id),
    ).toEqual(["second"]);
  });

  it("reports exactly which metadata is missing", () => {
    expect(catalogCompleteness(photo())).toBe("complete");
    expect(catalogCompleteness(photo({ eventSlug: "" }))).toBe(
      "missing-event",
    );
    expect(catalogCompleteness(photo({ people: [] }))).toBe(
      "missing-people",
    );
    expect(catalogCompleteness(photo({ keywords: [] }))).toBe(
      "missing-keywords",
    );
    expect(catalogCompleteness(photo({ keywords: ["Rachel", "rachel"] }))).toBe(
      "missing-keywords",
    );
    expect(
      catalogCompleteness(photo({ eventSlug: "", people: [], keywords: [] })),
    ).toBe("needs-attention");
  });
});

describe("catalog metadata patch contract", () => {
  it("accepts a bounded bulk add/remove patch and removes duplicates", () => {
    expect(
      parseCatalogMetadataPatch({
        photoIds: [UUID_A, UUID_B, UUID_A],
        eventSlug: "reception",
        addPeopleSlugs: ["rachel", "rachel"],
        removePeopleSlugs: [],
        addKeywords: ["dance floor", "Dance Floor"],
        removeKeywords: ["portraits"],
      }),
    ).toEqual({
      photoIds: [UUID_A, UUID_B],
      eventSlug: "reception",
      addPeopleSlugs: ["rachel"],
      removePeopleSlugs: [],
      addKeywords: ["dance floor"],
      removeKeywords: ["portraits"],
    });
  });

  it("accepts an explicit event clear", () => {
    expect(
      parseCatalogMetadataPatch({
        photoIds: [UUID_A],
        eventSlug: null,
      }),
    ).toEqual({
      photoIds: [UUID_A],
      eventSlug: null,
      addPeopleSlugs: [],
      removePeopleSlugs: [],
      addKeywords: [],
      removeKeywords: [],
    });
  });

  it("rejects malformed ids, no-op patches, and conflicting operations", () => {
    expect(parseCatalogMetadataPatch({ photoIds: ["not-a-uuid"], eventSlug: null })).toBeNull();
    expect(parseCatalogMetadataPatch({ photoIds: [UUID_A] })).toBeNull();
    expect(
      parseCatalogMetadataPatch({
        photoIds: [UUID_A],
        addPeopleSlugs: ["rachel"],
        removePeopleSlugs: ["rachel"],
      }),
    ).toBeNull();
    expect(
      parseCatalogMetadataPatch({
        photoIds: [UUID_A],
        addKeywords: ["dance"],
        removeKeywords: ["DANCE"],
      }),
    ).toBeNull();
  });
});
