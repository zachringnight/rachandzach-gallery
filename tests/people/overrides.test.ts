import { describe, expect, it, vi } from "vitest";

// overrides.ts starts with `import "server-only"`, a marker package that
// throws outside a React Server bundle; mock it out exactly as
// tests/gallery/serialize.test.ts does.
vi.mock("server-only", () => ({}));

import {
  personIdentities,
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
    // Added people are full catalog identities, but the facet list only
    // carries people with confirmed photos, so an untagged addition arrives
    // through the appended branch with the same shape as everyone else (no
    // special flag: their /{slug} route resolves from the catalog).
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
      },
      {
        slug: "aunt-zelda",
        displayName: "Aunt Zelda",
        count: 0,
      },
    ]);
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

describe("personIdentities", () => {
  it("still resolves a hidden person's saved selection to their real name", () => {
    // Hiding is picker-only: a guest who already picked themselves in Find
    // me keeps their preference, so identity resolution must keep working
    // even though surfacePeople dropped them from the roster.
    const overrides = new Map([
      ["cousin-eddie", override({ personSlug: "cousin-eddie", hidden: true })],
    ]);
    expect(
      surfacePeople(catalogPeople, overrides).some(
        (person) => person.slug === "cousin-eddie",
      ),
    ).toBe(false);
    const identity = personIdentities(catalogPeople, overrides).find(
      (person) => person.slug === "cousin-eddie",
    );
    expect(identity).toEqual({
      slug: "cousin-eddie",
      displayName: "Cousin Eddie",
    });
  });

  it("applies renames, includes hidden additions, and never carries counts", () => {
    const overrides = new Map([
      [
        "rachel-casciano",
        override({
          personSlug: "rachel-casciano",
          displayName: "Rachel Soskin",
          hidden: true,
        }),
      ],
      [
        "aunt-carol",
        override({
          personSlug: "aunt-carol",
          displayName: "Aunt Carol",
          added: true,
          hidden: true,
        }),
      ],
    ]);
    const identities = personIdentities(catalogPeople, overrides);
    expect(identities.find((p) => p.slug === "rachel-casciano")).toEqual({
      slug: "rachel-casciano",
      displayName: "Rachel Soskin",
    });
    expect(identities.find((p) => p.slug === "aunt-carol")).toEqual({
      slug: "aunt-carol",
      displayName: "Aunt Carol",
    });
    for (const identity of identities) {
      expect(identity).not.toHaveProperty("count");
    }
  });
});

describe("surfaceGalleryFacets", () => {
  it("rewrites the people facet and carries hidden-capable identities", () => {
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
    // The filter chip for a hidden person's slug resolves through this.
    expect(
      surfaced.identities.find((p) => p.slug === "cousin-eddie")?.displayName,
    ).toBe("Cousin Eddie");
  });
});
