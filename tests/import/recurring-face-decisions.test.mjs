import { describe, expect, it } from "vitest";

import { buildRecurringFaceTaggerModel } from "../../scripts/face/build-recurring-face-tagger.mjs";
import { buildRecurringFaceTagUpdate } from "../../scripts/face/import-recurring-face-decisions.mjs";

const HASH_ONE = "1".repeat(32);
const HASH_TWO = "2".repeat(32);
const FINGERPRINT = "a".repeat(64);

function face(photoId, faceIndex, bbox, extra = {}) {
  return {
    faceKey: `${photoId}:${faceIndex}`,
    photoId,
    faceIndex,
    bbox,
    clusteringEligible: true,
    matches: [
      {
        slug: "nearest-secret",
        name: "Nearest Secret",
        similarity: 0.2,
      },
    ],
    ...extra,
  };
}

function report() {
  return {
    schemaVersion: 1,
    inputsFingerprint: FINGERPRINT,
    summary: {
      repeatedSameFaceClusters: 1,
      facesInRepeatedClusters: 2,
    },
    clusters: [
      {
        clusterId: "z001",
        repeated: true,
        faceCount: 2,
        photoCount: 2,
        samePhotoConflictCount: 0,
        members: [`${HASH_ONE}:0`, `${HASH_TWO}:0`],
        matches: [{ name: "Nearest Secret", similarity: 0.2 }],
      },
    ],
    photos: [
      {
        photoId: HASH_ONE,
        path: "Reception/one.jpg",
        event: "reception",
        dw: 1000,
        dh: 800,
        faces: [face(HASH_ONE, 0, [100, 120, 220, 260])],
      },
      {
        photoId: HASH_TWO,
        path: "Reception/two.jpg",
        event: "reception",
        dw: 800,
        dh: 1000,
        faces: [face(HASH_TWO, 0, [300, 200, 420, 340])],
      },
    ],
  };
}

function catalog() {
  return {
    people: [
      { slug: "guest-one", name: "Guest One", photoCount: 4 },
      { slug: "guest-two", name: "Guest Two", photoCount: 0 },
    ],
    photos: [
      {
        id: HASH_ONE,
        imageDataHash: HASH_ONE,
        originalRelativePath: "Reception/one.jpg",
        peopleSlugs: [],
      },
      {
        id: HASH_TWO,
        imageDataHash: HASH_TWO,
        originalRelativePath: "Reception/two.jpg",
        peopleSlugs: [],
      },
    ],
  };
}

function manifest() {
  return {
    schemaVersion: 1,
    source: {
      auditFingerprint: "b".repeat(64),
      auditFingerprints: ["b".repeat(64)],
      reviewedAt: "2026-07-27",
      reviewedBy: "Codex visual side-by-side review",
      reviewMethod: "Saved profiles were visually reviewed.",
      minSimilarity: 0.55,
      minMargin: 0.08,
      candidatesReviewed: 4,
      candidatesApproved: 3,
      candidatesRejected: 1,
      reviewWaves: [
        {
          wave: 1,
          auditFingerprint: "b".repeat(64),
          minSimilarity: 0.55,
          minMargin: 0.08,
          candidatesReviewed: 4,
          candidatesApproved: 3,
          candidatesRejected: 1,
        },
      ],
    },
    additions: [
      {
        photoId: "3".repeat(32),
        path: "Ceremony/already.jpg",
        personSlug: "guest-one",
        displayName: "Guest One",
        faceIndex: 0,
        similarity: 0.8,
        margin: 0.4,
        reviewWave: 1,
      },
      {
        photoId: "4".repeat(32),
        path: "Ceremony/already-two.jpg",
        personSlug: "guest-one",
        displayName: "Guest One",
        faceIndex: 0,
        similarity: 0.8,
        margin: 0.4,
        reviewWave: 1,
      },
      {
        photoId: "5".repeat(32),
        path: "Ceremony/already-three.jpg",
        personSlug: "guest-one",
        displayName: "Guest One",
        faceIndex: 0,
        similarity: 0.8,
        margin: 0.4,
        reviewWave: 1,
      },
    ],
  };
}

function decisions(rows = [
  { clusterId: "z001", action: "tag", personSlug: "guest-two" },
]) {
  return {
    schemaVersion: 1,
    reportFingerprint: FINGERPRINT,
    exportedAt: "2026-07-27T18:00:00.000Z",
    decisions: rows,
  };
}

describe("recurring face decision import", () => {
  it("turns one human cluster decision into additive photo-person rows without model scores", () => {
    const result = buildRecurringFaceTagUpdate({
      report: report(),
      catalog: catalog(),
      manifest: manifest(),
      decisionFile: decisions(),
      reviewedAt: "2026-07-27",
    });

    expect(result.summary).toMatchObject({
      taggedClusters: 1,
      heldClusters: 0,
      additionsCreated: 2,
      additionsAlreadyTracked: 0,
      totalTrackedAdditions: 5,
      reviewWave: 2,
    });
    expect(result.manifest.additions.slice(-2)).toEqual([
      expect.objectContaining({
        photoId: HASH_ONE,
        personSlug: "guest-two",
        confirmationKind: "human-recurring-cluster",
        reviewWave: 2,
        clusterId: "z001",
        clusterFingerprint: FINGERPRINT,
        faceIndex: 0,
      }),
      expect.objectContaining({
        photoId: HASH_TWO,
        personSlug: "guest-two",
        confirmationKind: "human-recurring-cluster",
        reviewWave: 2,
        clusterId: "z001",
        clusterFingerprint: FINGERPRINT,
        faceIndex: 0,
      }),
    ]);
    expect(result.manifest.additions.at(-1)).not.toHaveProperty("similarity");
    expect(result.manifest.additions.at(-1)).not.toHaveProperty("margin");
    expect(result.manifest.source).toMatchObject({
      candidatesReviewed: 6,
      candidatesApproved: 5,
      candidatesRejected: 1,
    });
    expect(result.manifest.source.reviewWaves.at(-1)).toMatchObject({
      manualConfirmation: true,
      candidatesReviewed: 2,
      candidatesApproved: 2,
      repeatedClustersIdentified: 1,
    });
  });

  it("is idempotent when the same exported decisions are imported again", () => {
    const first = buildRecurringFaceTagUpdate({
      report: report(),
      catalog: catalog(),
      manifest: manifest(),
      decisionFile: decisions(),
      reviewedAt: "2026-07-27",
    });
    const second = buildRecurringFaceTagUpdate({
      report: report(),
      catalog: catalog(),
      manifest: first.manifest,
      decisionFile: decisions(),
      reviewedAt: "2026-07-27",
    });

    expect(second.summary).toMatchObject({
      additionsCreated: 0,
      additionsAlreadyTracked: 2,
      totalTrackedAdditions: 5,
      reviewWave: 2,
    });
    expect(second.manifest.source.reviewWaves).toHaveLength(2);
  });

  it("fails closed for a stale report fingerprint or unknown person", () => {
    expect(() =>
      buildRecurringFaceTagUpdate({
        report: report(),
        catalog: catalog(),
        manifest: manifest(),
        decisionFile: {
          ...decisions(),
          reportFingerprint: "c".repeat(64),
        },
        reviewedAt: "2026-07-27",
      }),
    ).toThrow("different review report");

    expect(() =>
      buildRecurringFaceTagUpdate({
        report: report(),
        catalog: catalog(),
        manifest: manifest(),
        decisionFile: decisions([
          { clusterId: "z001", action: "tag", personSlug: "not-a-person" },
        ]),
        reviewedAt: "2026-07-27",
      }),
    ).toThrow("unknown person not-a-person");
  });

  it("keeps held clusters out of the additive tag overlay", () => {
    const result = buildRecurringFaceTagUpdate({
      report: report(),
      catalog: catalog(),
      manifest: manifest(),
      decisionFile: decisions([{ clusterId: "z001", action: "hold" }]),
      reviewedAt: "2026-07-27",
    });

    expect(result.summary).toMatchObject({
      taggedClusters: 0,
      heldClusters: 1,
      additionsCreated: 0,
      reviewWave: null,
    });
    expect(result.manifest).toEqual(manifest());
  });

  it("rejects assigning one person to two different face clusters in the same photo", () => {
    const conflicted = report();
    conflicted.photos[0].faces.push(
      face(HASH_ONE, 1, [500, 120, 620, 260]),
    );
    conflicted.photos[1].faces.push(
      face(HASH_TWO, 1, [500, 220, 620, 360]),
    );
    conflicted.clusters.push({
      clusterId: "z002",
      repeated: true,
      faceCount: 2,
      photoCount: 2,
      samePhotoConflictCount: 0,
      members: [`${HASH_ONE}:1`, `${HASH_TWO}:1`],
      matches: [],
    });

    expect(() =>
      buildRecurringFaceTagUpdate({
        report: conflicted,
        catalog: catalog(),
        manifest: manifest(),
        decisionFile: decisions([
          { clusterId: "z001", action: "tag", personSlug: "guest-two" },
          { clusterId: "z002", action: "tag", personSlug: "guest-two" },
        ]),
        reviewedAt: "2026-07-27",
      }),
    ).toThrow("both assign Guest Two to the same photo");
  });
});

describe("recurring face tagger model", () => {
  it("includes only recurring crops, full-photo context, and roster choices", () => {
    const model = buildRecurringFaceTaggerModel({
      report: report(),
      catalog: catalog(),
      derivativeUrls: {
        [HASH_ONE]: "../../previews/one.webp",
        [HASH_TWO]: "../../previews/two.webp",
      },
      committedFaceUrls: {
        "guest-one": "../../../public/faces/guest-one.webp",
      },
    });

    expect(model.counts).toEqual({
      clusters: 1,
      faces: 2,
      photos: 2,
      people: 2,
    });
    expect(model.clusters[0]).toMatchObject({
      id: "z001",
      faceCount: 2,
      photoCount: 2,
    });
    expect(model.clusters[0].members[0]).toEqual(
      expect.objectContaining({
        filename: "one.jpg",
        event: "reception",
        crop: expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
          size: expect.any(Number),
        }),
        box: expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
          width: expect.any(Number),
          height: expect.any(Number),
        }),
      }),
    );
    const serialized = JSON.stringify(model);
    expect(serialized).not.toContain("Nearest Secret");
    expect(serialized).not.toContain('"matches"');
    expect(serialized).not.toContain('"emb"');
  });
});
