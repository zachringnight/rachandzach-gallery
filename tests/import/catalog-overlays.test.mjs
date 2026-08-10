import { describe, expect, it } from "vitest";

import {
  applyCatalogOverlays,
  applyDisplayNameOverrides,
  applyPersonMerges,
} from "../../scripts/lib/catalog-overlays.mjs";

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

function removals(rows) {
  return {
    schemaVersion: 1,
    source: { reviewedBy: "Test" },
    removals: rows ?? [
      {
        photoId: "hash-one",
        path: "Ceremony/one.jpg",
        personSlug: "existing-person",
        reason: "Reviewed the full frame and confirmed this person is not in it.",
      },
    ],
  };
}

function personMerges() {
  return {
    schemaVersion: 1,
    merges: [
      {
        fromSlug: "existing-person",
        fromName: "Existing Person",
        intoSlug: "merged-person",
        intoName: "Merged Person",
        reason: "A human confirmed these records belong to the same guest.",
      },
    ],
  };
}

describe("tracked person identity corrections", () => {
  it("durably merges an old identity into a missing target", () => {
    const catalog = fixture();

    const result = applyPersonMerges(catalog, personMerges());

    expect(result).toMatchObject({
      reviewedPersonMerges: 1,
      personMergesApplied: 1,
      personMergeTargetsAdded: 1,
      personMergePhotosReattributed: 1,
    });
    expect(catalog.people.map((person) => person.slug)).not.toContain("existing-person");
    expect(catalog.people).toContainEqual({
      slug: "merged-person",
      name: "Merged Person",
      photoCount: 0,
    });
    expect(catalog.photos[0].peopleSlugs).toEqual(["merged-person"]);
  });

  it("is idempotent after a person merge has already landed", () => {
    const catalog = fixture();
    applyPersonMerges(catalog, personMerges());

    const result = applyPersonMerges(catalog, personMerges());

    expect(result.personMergesApplied).toBe(0);
    expect(result.personMergesAlreadyApplied).toBe(1);
  });

  it("fails closed when a merge source name has drifted", () => {
    const catalog = fixture();
    catalog.people[0].name = "Unexpected Name";

    expect(() => applyPersonMerges(catalog, personMerges())).toThrow(
      /name is Unexpected Name, expected Existing Person/,
    );
  });

  it("updates tracked display names and rejects missing identities", () => {
    const catalog = fixture();
    const result = applyDisplayNameOverrides(catalog, {
      names: { "existing-person": "Updated Person" },
    });

    expect(result.displayNamesUpdated).toBe(1);
    expect(catalog.people[0].name).toBe("Updated Person");
    expect(() =>
      applyDisplayNameOverrides(catalog, { names: { "missing-person": "Nobody" } }),
    ).toThrow(/references missing person missing-person/);
  });
});

describe("catalog overlay removals", () => {
  it("removes a tag the master supplied and recounts the person", () => {
    const catalog = fixture();
    const result = applyCatalogOverlays(catalog, attendance(), faceTags(), removals());
    expect(catalog.photos[0].peopleSlugs).not.toContain("existing-person");
    expect(result.faceTagsRemoved).toBe(1);
    expect(
      catalog.people.find((p) => p.slug === "existing-person").photoCount,
    ).toBe(0);
  });

  it("is idempotent once the tag is already gone", () => {
    const catalog = fixture();
    applyCatalogOverlays(catalog, attendance(), faceTags(), removals());
    const result = applyCatalogOverlays(catalog, attendance(), faceTags(), removals());
    expect(result.faceTagsRemoved).toBe(0);
    expect(result.faceTagsAlreadyAbsent).toBe(1);
  });

  it("behaves exactly as before when no removals file is supplied", () => {
    const withArg = fixture();
    const withoutArg = fixture();
    const a = applyCatalogOverlays(withArg, attendance(), faceTags(), null);
    const b = applyCatalogOverlays(withoutArg, attendance(), faceTags());
    expect(withArg).toEqual(withoutArg);
    expect(a.faceTagsRemoved).toBe(0);
    expect(b.faceTagsRemoved).toBe(0);
  });

  it("fails closed when the same pair is both added and removed", () => {
    expect(() =>
      applyCatalogOverlays(
        fixture(),
        attendance(),
        faceTags(),
        removals([
          {
            photoId: "hash-one",
            path: "Ceremony/one.jpg",
            personSlug: "alias-target",
            reason: "This contradicts the addition for the very same pair.",
          },
        ]),
      ),
    ).toThrow(/both added and removed/);
  });

  it("fails closed when a removal carries no reviewed reason", () => {
    expect(() =>
      applyCatalogOverlays(
        fixture(),
        attendance(),
        faceTags(),
        removals([
          {
            photoId: "hash-one",
            path: "Ceremony/one.jpg",
            personSlug: "existing-person",
            reason: "too short",
          },
        ]),
      ),
    ).toThrow(/needs a reviewed reason/);
  });

  it("fails closed when a removal path no longer matches its photo", () => {
    expect(() =>
      applyCatalogOverlays(
        fixture(),
        attendance(),
        faceTags(),
        removals([
          {
            photoId: "hash-one",
            path: "Ceremony/moved.jpg",
            personSlug: "existing-person",
            reason: "Reviewed the full frame and confirmed this person is not in it.",
          },
        ]),
      ),
    ).toThrow(/removal path drift/);
  });
});

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
      // Reported even with no removals file, so a run that silently stopped
      // applying removals is visible rather than indistinguishable.
      reviewedFaceTagRemovals: 0,
      faceTagsRemoved: 0,
      faceTagsAlreadyAbsent: 0,
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

  it("uses a recorded review wave threshold for contextual confirmations", () => {
    const tags = faceTags();
    tags.source.reviewWaves = [
      {
        wave: 4,
        minSimilarity: 0.4,
        minMargin: 0.18,
      },
    ];
    tags.additions[0].reviewWave = 4;
    tags.additions[0].similarity = 0.46;
    tags.additions[0].margin = 0.3;

    expect(() =>
      applyCatalogOverlays(fixture(), attendance(), tags),
    ).not.toThrow();
  });

  it("fails closed when a tag references an unknown review wave", () => {
    const tags = faceTags();
    tags.additions[0].reviewWave = 4;

    expect(() => applyCatalogOverlays(fixture(), attendance(), tags)).toThrow(
      "references unknown review wave",
    );
  });

  it("accepts an explicit human recurring-cluster confirmation without inventing a model score", () => {
    const tags = faceTags();
    tags.source.reviewWaves = [
      {
        wave: 5,
        manualConfirmation: true,
      },
    ];
    tags.additions[0] = {
      photoId: "hash-one",
      path: "Ceremony/one.jpg",
      personSlug: "alias-target",
      confirmationKind: "human-recurring-cluster",
      reviewWave: 5,
      clusterId: "z001",
      faceIndex: 0,
      clusterFingerprint: "a".repeat(64),
      contextEvidence:
        "Zach identified the same recurring face across two private review photos.",
    };

    expect(() =>
      applyCatalogOverlays(fixture(), attendance(), tags),
    ).not.toThrow();
  });

  it("accepts a signature-builder cluster id as well as a zero-tag one", () => {
    const tags = faceTags();
    tags.source.reviewWaves = [{ wave: 5, manualConfirmation: true }];
    tags.additions[0] = {
      photoId: "hash-one",
      path: "Ceremony/one.jpg",
      personSlug: "alias-target",
      confirmationKind: "human-recurring-cluster",
      reviewWave: 5,
      // c#### comes from signatures.json unresolvedClusters; z### from the
      // zero-tag review. A human confirms both the same way.
      clusterId: "c0116",
      faceIndex: 0,
      clusterFingerprint: "a".repeat(64),
      contextEvidence:
        "Zach named the recurring unnamed cluster from the private tagger.",
    };

    expect(() =>
      applyCatalogOverlays(fixture(), attendance(), tags),
    ).not.toThrow();
  });

  it("still rejects a cluster id in neither form", () => {
    const tags = faceTags();
    tags.source.reviewWaves = [{ wave: 5, manualConfirmation: true }];
    tags.additions[0] = {
      photoId: "hash-one",
      path: "Ceremony/one.jpg",
      personSlug: "alias-target",
      confirmationKind: "human-recurring-cluster",
      reviewWave: 5,
      clusterId: "cluster-116",
      faceIndex: 0,
      clusterFingerprint: "a".repeat(64),
      contextEvidence:
        "Zach named the recurring unnamed cluster from the private tagger.",
    };

    expect(() => applyCatalogOverlays(fixture(), attendance(), tags)).toThrow(
      /invalid recurring cluster/,
    );
  });

  it("fails closed when a human recurring-cluster tag lacks its confirmation context", () => {
    const tags = faceTags();
    tags.source.reviewWaves = [
      {
        wave: 5,
        manualConfirmation: true,
      },
    ];
    tags.additions[0] = {
      photoId: "hash-one",
      path: "Ceremony/one.jpg",
      personSlug: "alias-target",
      confirmationKind: "human-recurring-cluster",
      reviewWave: 5,
      clusterId: "z001",
      faceIndex: 0,
      clusterFingerprint: "a".repeat(64),
    };

    expect(() =>
      applyCatalogOverlays(fixture(), attendance(), tags),
    ).toThrow("needs human confirmation context");
  });
});
