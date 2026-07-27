import { describe, expect, it } from "vitest";

import { applyCatalogOverlays } from "../../scripts/lib/catalog-overlays.mjs";

function fixture() {
  return {
    people: [
      { slug: "existing-person", name: "Existing Person", photoCount: 1 },
      { slug: "alias-target", name: "Canonical Name", photoCount: 0 },
    ],
    photos: [
      {
        id: "hash-one",
        imageDataHash: "hash-one",
        originalRelativePath: "Ceremony/one.jpg",
        peopleSlugs: ["existing-person"],
      },
    ],
    stats: { people: 2 },
  };
}

function attendance() {
  return {
    schemaVersion: 1,
    source: { attendeeCount: 3 },
    attendees: [
      {
        seatingName: "Existing Person",
        personSlug: "existing-person",
        displayName: "Existing Person",
        resolution: "existing",
      },
      {
        seatingName: "Alias Seating Name",
        personSlug: "alias-target",
        displayName: "Canonical Name",
        resolution: "alias",
      },
      {
        seatingName: "New Person",
        personSlug: "new-person",
        displayName: "New Person",
        resolution: "added",
      },
    ],
  };
}

function faceTags() {
  return {
    schemaVersion: 1,
    source: {
      candidatesApproved: 1,
      minSimilarity: 0.72,
      minMargin: 0.15,
    },
    additions: [
      {
        photoId: "hash-one",
        path: "Ceremony/one.jpg",
        personSlug: "alias-target",
        similarity: 0.8,
        margin: 0.4,
      },
    ],
  };
}

describe("catalog overlays", () => {
  it("adds seated identities and reviewed tags, then recomputes counts", () => {
    const catalog = fixture();

    const result = applyCatalogOverlays(catalog, attendance(), faceTags());

    expect(result).toEqual({
      attendanceCount: 3,
      peopleAdded: 1,
      peopleTotal: 3,
      reviewedFaceTags: 1,
      faceTagsAdded: 1,
      faceTagsAlreadyPresent: 0,
    });
    expect(catalog.photos[0].peopleSlugs).toEqual([
      "alias-target",
      "existing-person",
    ]);
    expect(
      Object.fromEntries(catalog.people.map((person) => [person.slug, person.photoCount])),
    ).toEqual({
      "alias-target": 1,
      "existing-person": 1,
      "new-person": 0,
    });
    expect(catalog.stats.people).toBe(3);
  });

  it("is idempotent when the overlay has already been applied", () => {
    const catalog = fixture();
    applyCatalogOverlays(catalog, attendance(), faceTags());

    const result = applyCatalogOverlays(catalog, attendance(), faceTags());

    expect(result.peopleAdded).toBe(0);
    expect(result.faceTagsAdded).toBe(0);
    expect(result.faceTagsAlreadyPresent).toBe(1);
  });

  it("fails closed when a reviewed tag path no longer matches its photo", () => {
    const tags = faceTags();
    tags.additions[0].path = "Ceremony/different.jpg";

    expect(() => applyCatalogOverlays(fixture(), attendance(), tags)).toThrow(
      "reviewed face tag path drift",
    );
  });

  it("fails closed when two seating rows resolve to one identity", () => {
    const manifest = attendance();
    manifest.attendees[2].personSlug = "alias-target";

    expect(() => applyCatalogOverlays(fixture(), manifest, faceTags())).toThrow(
      "multiple seating attendees resolve to alias-target",
    );
  });
});
