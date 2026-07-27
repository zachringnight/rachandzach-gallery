import { describe, expect, it } from "vitest";

import { buildReport } from "../../scripts/face/build-unresolved-cluster-report.mjs";

function detections(entries) {
  return new Map(
    entries.map(([photoId, faceIndexes]) => [
      photoId,
      {
        photoId,
        dw: 1536,
        dh: 2048,
        faces: faceIndexes.map((i) => ({ i, bbox: [1, 2, 3, 4], score: 0.9 })),
      },
    ]),
  );
}

function catalog(ids) {
  return {
    photos: ids.map((id) => ({
      id,
      originalRelativePath: `Ceremony/${id}.jpg`,
      eventSlug: "ceremony",
    })),
  };
}

function signatures(clusters) {
  return { inputsFingerprint: "a".repeat(64), unresolvedClusters: clusters };
}

const CLEAN = {
  clusterId: "c0116",
  faceCount: 3,
  photoCount: 3,
  topCoTags: [{ slug: "someone", score: 0.5, support: 1 }],
  members: [
    { photoId: "p1", faceIndex: 0 },
    { photoId: "p2", faceIndex: 1 },
    { photoId: "p3", faceIndex: 0 },
  ],
};

describe("unresolved cluster report", () => {
  it("carries every member through, not just the sampled ones", () => {
    const report = buildReport(
      signatures([CLEAN]),
      detections([["p1", [0]], ["p2", [1]], ["p3", [0]]]),
      catalog(["p1", "p2", "p3"]),
    );
    expect(report.clusters).toHaveLength(1);
    // The whole point: signatures sample three faces, but naming a cluster
    // has to tag all of them.
    expect(report.clusters[0].members).toEqual(["p1:0", "p2:1", "p3:0"]);
    expect(report.summary.faces).toBe(3);
    expect(report.photos.map((p) => p.photoId).sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("keeps the co-tag hints that make a cluster nameable", () => {
    const report = buildReport(
      signatures([CLEAN]),
      detections([["p1", [0]], ["p2", [1]], ["p3", [0]]]),
      catalog(["p1", "p2", "p3"]),
    );
    expect(report.clusters[0].topCoTags).toEqual(CLEAN.topCoTags);
  });

  it("drops a cluster holding two faces from one photo instead of offering it", () => {
    const impure = {
      clusterId: "c0200",
      faceCount: 2,
      photoCount: 1,
      members: [
        { photoId: "p1", faceIndex: 0 },
        { photoId: "p1", faceIndex: 1 },
      ],
    };
    const report = buildReport(
      signatures([CLEAN, impure]),
      detections([["p1", [0, 1]], ["p2", [1]], ["p3", [0]]]),
      catalog(["p1", "p2", "p3"]),
    );
    expect(report.clusters.map((c) => c.clusterId)).toEqual(["c0116"]);
    expect(report.impureClusters).toHaveLength(1);
    expect(report.impureClusters[0].clusterId).toBe("c0200");
    expect(report.summary.skippedImpureClusters).toBe(1);
  });

  it("does not leave the dropped cluster's faces behind in photos", () => {
    const impure = {
      clusterId: "c0200",
      faceCount: 2,
      photoCount: 1,
      members: [
        { photoId: "p9", faceIndex: 0 },
        { photoId: "p9", faceIndex: 1 },
      ],
    };
    const report = buildReport(
      signatures([impure]),
      detections([["p9", [0, 1]]]),
      catalog(["p9"]),
    );
    expect(report.clusters).toHaveLength(0);
    expect(report.photos).toHaveLength(0);
  });

  it("ranks the biggest clusters first", () => {
    const small = { ...CLEAN, clusterId: "c0900", faceCount: 1, photoCount: 1,
      members: [{ photoId: "p1", faceIndex: 0 }] };
    const report = buildReport(
      signatures([small, CLEAN]),
      detections([["p1", [0]], ["p2", [1]], ["p3", [0]]]),
      catalog(["p1", "p2", "p3"]),
    );
    expect(report.clusters.map((c) => c.clusterId)).toEqual(["c0116", "c0900"]);
  });

  it("honours a minimum face count", () => {
    const small = { ...CLEAN, clusterId: "c0900", faceCount: 1, photoCount: 1,
      members: [{ photoId: "p1", faceIndex: 0 }] };
    const report = buildReport(
      signatures([CLEAN, small]),
      detections([["p1", [0]], ["p2", [1]], ["p3", [0]]]),
      catalog(["p1", "p2", "p3"]),
      2,
    );
    expect(report.clusters.map((c) => c.clusterId)).toEqual(["c0116"]);
  });

  it("fails closed when a cluster only carries sampled faces", () => {
    const truncated = {
      clusterId: "c0116",
      faceCount: 21,
      photoCount: 16,
      sampleFaces: [{ photoId: "p1", faceIndex: 0 }],
    };
    expect(() =>
      buildReport(signatures([truncated]), detections([["p1", [0]]]), catalog(["p1"])),
    ).toThrow(/re-run build-face-signatures/);
  });

  it("fails closed when a member points at a face that is not there", () => {
    expect(() =>
      buildReport(
        signatures([CLEAN]),
        detections([["p1", [0]], ["p2", [9]], ["p3", [0]]]),
        catalog(["p1", "p2", "p3"]),
      ),
    ).toThrow(/has no face 1/);
  });

  it("fails closed when a photo is missing from the catalog", () => {
    expect(() =>
      buildReport(
        signatures([CLEAN]),
        detections([["p1", [0]], ["p2", [1]], ["p3", [0]]]),
        catalog(["p1", "p2"]),
      ),
    ).toThrow(/not in the catalog/);
  });

  it("changes its fingerprint when membership changes", () => {
    const a = buildReport(
      signatures([CLEAN]),
      detections([["p1", [0]], ["p2", [1]], ["p3", [0]]]),
      catalog(["p1", "p2", "p3"]),
    );
    const shrunk = { ...CLEAN, faceCount: 2, photoCount: 2,
      members: CLEAN.members.slice(0, 2) };
    const b = buildReport(
      signatures([shrunk]),
      detections([["p1", [0]], ["p2", [1]], ["p3", [0]]]),
      catalog(["p1", "p2", "p3"]),
    );
    expect(a.inputsFingerprint).not.toBe(b.inputsFingerprint);
  });
});
