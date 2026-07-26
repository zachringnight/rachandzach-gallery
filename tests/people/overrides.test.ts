import { describe, expect, it, vi } from "vitest";

// overrides.ts starts with `import "server-only"`, a marker package that
// throws outside a React Server bundle; mock it out exactly as
// tests/gallery/serialize.test.ts does.
vi.mock("server-only", () => ({}));

import {
  surfacePeople,
  surfaceGalleryFacets,
  type PersonOverride,
} from "@/lib/people/overrides";

function override(partial: Partial<PersonOverride> & { personSlug: string }): PersonOverride {
  return {
    displayName: null,
    hidden: false,
    added: false,
    facePhotoId: null,
    faceCrop: null,
    updatedAt: "2026-07-26T00:00:00.000Z",
    updatedBy: "wedding@rachandzach.com",
    ...partial,
  };
}

const catalogPeople = [
  { slug: "zach-soskin", displayName: "Zach Soskin", count: 120 },
  { slug: "rachel-casciano", displayName: "Rachel Casciano", count: 118 },
  { slug: "cousin-eddie", displayName: "Cousin Eddie", count: 3 },
];

describe("surfacePeople", () => {
  it("passes the catalog through untouched with no overrides", () => {
    expect(surfacePeople(catalogPeople, new Map())).toEqual(catalogPeople);
  });

  it("drops hidden people from the picker roster only", () => {
    const overrides = new Map([
      ["cousin-eddie", override({ personSlug: "cousin-eddie", hidden: true })],
    ]);
    const surfaced = surfacePeople(catalogPeople, overrides);
    expect(surfaced.map((p) => p.slug)).toEqual([
      "zach-soskin",
      "rachel-casciano",
    ]);
  });

  it("applies display-name corrections", () => {
    const overrides = new Map([
      [
        "rachel-casciano",
        override({ personSlug: "rachel-casciano", displayName: "Rachel Soskin" }),
      ],
    ]);
    const surfaced = surfacePeople(catalogPeople, overrides);
    expect(surfaced[1]).toEqual({
      slug: "rachel-casciano",
      displayName: "Rachel Soskin",
      count: 118,
    });
  });

  it("appends added people alphabetically with a zero count", () => {
    const overrides = new Map([
      [
        "aunt-zelda",
        override({ personSlug: "aunt-zelda", displayName: "Aunt Zelda", added: true }),
      ],
      [
        "aunt-carol",
        override({ personSlug: "aunt-carol", displayName: "Aunt Carol", added: true }),
      ],
    ]);
    const surfaced = surfacePeople(catalogPeople, overrides);
    expect(surfaced.slice(-2)).toEqual([
      {
        slug: "aunt-carol",
        displayName: "Aunt Carol",
        count: 0,
        overrideOnly: true,
      },
      {
        slug: "aunt-zelda",
        displayName: "Aunt Zelda",
        count: 0,
        overrideOnly: true,
      },
    ]);
  });

  it("marks only additions as overrideOnly, so catalog people keep their route", () => {
    // The flag is what stops a guest surface offering /[personSlug] to someone
    // with no catalog row, where that route 404s. Catalog people must never
    // carry it, or they lose a route that works.
    const overrides = new Map([
      [
        "aunt-carol",
        override({ personSlug: "aunt-carol", displayName: "Aunt Carol", added: true }),
      ],
    ]);
    const surfaced = surfacePeople(catalogPeople, overrides);
    const addition = surfaced.find((person) => person.slug === "aunt-carol");
    expect(addition?.overrideOnly).toBe(true);
    for (const person of catalogPeople) {
      const found = surfaced.find((candidate) => candidate.slug === person.slug);
      expect(found?.overrideOnly).toBeUndefined();
    }
  });

  it("never surfaces a hidden addition and never duplicates a catalog slug", () => {
    const overrides = new Map([
      [
        "hidden-add",
        override({
          personSlug: "hidden-add",
          displayName: "Hidden Add",
          added: true,
          hidden: true,
        }),
      ],
      [
        "zach-soskin",
        override({ personSlug: "zach-soskin", displayName: "Zach", added: true }),
      ],
    ]);
    const surfaced = surfacePeople(catalogPeople, overrides);
    expect(surfaced.filter((p) => p.slug === "zach-soskin")).toHaveLength(1);
    expect(surfaced.some((p) => p.slug === "hidden-add")).toBe(false);
  });
});

describe("surfaceGalleryFacets", () => {
  it("rewrites only the people facet", () => {
    const facets = {
      events: [{ slug: "ceremony", name: "Ceremony", count: 12 }],
      people: catalogPeople,
    };
    const overrides = new Map([
      ["cousin-eddie", override({ personSlug: "cousin-eddie", hidden: true })],
    ]);
    const surfaced = surfaceGalleryFacets(facets, overrides);
    expect(surfaced.events).toBe(facets.events);
    expect(surfaced.people).toHaveLength(2);
  });
});
