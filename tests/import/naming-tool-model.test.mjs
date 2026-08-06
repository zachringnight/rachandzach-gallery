import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildNamingModel } from "../../scripts/lib/naming-tool.mjs";

// buildNamingModel reads the queue from disk, so the fixture is a miniature
// repository in a temp directory: a two-photo catalog, a detector run, the
// pipeline's unresolved clusters, and one June-era CSV row. Photo A's face 0
// is covered by the CSV; photo B's faces 0 and 1 are cluster members no CSV
// ever queued; a third member points at a photo the catalog no longer has.

const HASH_A = "a".repeat(32);
const HASH_B = "b".repeat(32);
const HASH_GONE = "c".repeat(32);

const EMB = Buffer.alloc(2048, 1).toString("base64");

function detectionLine(photoId, path, faces) {
  return JSON.stringify({ photoId, path, dw: 1000, dh: 1000, faces });
}

let repoRoot;

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "naming-tool-model-"));
  const write = (relative, text) => writeFile(join(repoRoot, relative), text);

  await mkdir(join(repoRoot, "src", "generated"), { recursive: true });
  await mkdir(join(repoRoot, "metadata", "identity-review"), { recursive: true });
  await mkdir(join(repoRoot, "metadata", "faces"), { recursive: true });
  for (const hash of [HASH_A, HASH_B]) {
    await mkdir(join(repoRoot, "metadata", "import", "derivatives", "previews", hash), {
      recursive: true,
    });
    await write(join("metadata", "import", "derivatives", "previews", hash, "960.webp"), "");
  }

  await write(
    join("src", "generated", "gallery-v2.json"),
    JSON.stringify({
      photos: [
        {
          id: "photo-a",
          imageDataHash: HASH_A,
          originalRelativePath: "01 Day 1/a.jpg",
          eventSlug: "day-1",
          width: 1000,
          height: 1000,
          peopleSlugs: [],
        },
        {
          id: "photo-b",
          imageDataHash: HASH_B,
          originalRelativePath: "01 Day 1/b.jpg",
          eventSlug: "day-1",
          width: 1000,
          height: 1000,
          peopleSlugs: ["abe"],
        },
      ],
      people: [{ slug: "abe", name: "Abe", photoCount: 1 }],
    }),
  );

  await write(
    join("metadata", "faces", "detections.jsonl"),
    [
      detectionLine(HASH_A, "01 Day 1/a.jpg", [
        { i: 0, bbox: [100, 100, 300, 300], score: 0.99, emb: EMB },
      ]),
      detectionLine(HASH_B, "01 Day 1/b.jpg", [
        { i: 0, bbox: [100, 100, 300, 300], score: 0.99, emb: EMB },
        { i: 1, bbox: [500, 500, 700, 700], score: 0.99, emb: EMB },
      ]),
    ].join("\n") + "\n",
  );

  await write(
    join("metadata", "faces", "signatures.json"),
    JSON.stringify({
      unresolvedClusters: [
        {
          clusterId: "c0001",
          members: [
            { photoId: HASH_A, faceIndex: 0, bbox: [100, 100, 300, 300] },
            { photoId: HASH_B, faceIndex: 0, bbox: [100, 100, 300, 300] },
            { photoId: HASH_B, faceIndex: 1, bbox: [500, 500, 700, 700] },
            { photoId: HASH_GONE, faceIndex: 0, bbox: [100, 100, 300, 300] },
          ],
        },
      ],
    }),
  );

  // The CSV row resolves to photo A's detector face 0 through matchDetection
  // (its normalized box coincides with the detection's bbox exactly).
  await write(
    join("metadata", "identity-review", "unresolved-crops.csv"),
    "review_id,path,face_index,crop,box_x,box_y,box_w,box_h,applied_w,applied_h,area,notes\n" +
      "001,Day 1/a.jpg,00,,0.1,0.1,0.2,0.2,1000,1000,0.04,\n",
  );
});

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

describe("buildNamingModel cluster synthesis", () => {
  it("adds cluster faces the CSVs never queued, without duplicating CSV-covered faces", async () => {
    const model = await buildNamingModel({ repoRoot, assetBase: "../../", readOnly: true });

    const keys = model.items.map((item) => item.key).sort();
    expect(keys).toEqual([
      "cluster:01 Day 1/b.jpg:0",
      "cluster:01 Day 1/b.jpg:1",
      "missing:Day 1/a.jpg:00",
    ]);
    expect(model.counts.fromClusters).toBe(2);
    // Photo A face 0 is CSV-covered, so no synthetic item exists for it.
    const faces = model.items
      .filter((item) => item.faceIndex !== null)
      .map((item) => `${item.photoId}:${item.faceIndex}`);
    expect(new Set(faces).size).toBe(faces.length);
    // The member whose photo left the catalog is excluded, and counted.
    expect(model.counts.fromClustersUncatalogued).toBe(1);
  });

  it("stacks CSV and synthetic members of one cluster into one group", async () => {
    const model = await buildNamingModel({ repoRoot, assetBase: "../../", readOnly: true });

    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].id).toBe("c0001");
    expect([...model.groups[0].keys].sort()).toEqual([
      "cluster:01 Day 1/b.jpg:0",
      "cluster:01 Day 1/b.jpg:1",
      "missing:Day 1/a.jpg:00",
    ]);
    for (const item of model.items) {
      expect(item.groupId).toBe("c0001");
    }
  });

  it("produces synthetic items in the exact shape buildItem produces", async () => {
    const model = await buildNamingModel({ repoRoot, assetBase: "../../", readOnly: true });

    const csvItem = model.items.find((item) => item.kind === "missing");
    const synthetic = model.items.find((item) => item.key === "cluster:01 Day 1/b.jpg:0");
    expect(Object.keys(synthetic).sort()).toEqual(Object.keys(csvItem).sort());

    // The fields the decisions ledger and the reviewed-additions writer rely
    // on: photoId + catalogPath validate against the catalog, faceIndex is the
    // detector's own index.
    expect(synthetic.photoId).toBe(HASH_B);
    expect(synthetic.catalogPath).toBe("01 Day 1/b.jpg");
    expect(synthetic.faceIndex).toBe(0);
    expect(synthetic.scope).toBe("face");
    expect(synthetic.box).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 });
    expect(synthetic.knownPeople).toEqual([{ slug: "abe", name: "Abe" }]);
    expect(synthetic.path).toBe("Day 1/b.jpg");
    expect(synthetic.originalUrl).toBe("/original/Day%201/b.jpg");
  });

  it("keeps synthetic keys and the fingerprint stable across rebuilds", async () => {
    const first = await buildNamingModel({ repoRoot, assetBase: "../../", readOnly: true });
    const second = await buildNamingModel({ repoRoot, assetBase: "../../", readOnly: true });

    expect(second.items.map((item) => item.key)).toEqual(first.items.map((item) => item.key));
    expect(second.buildFingerprint).toBe(first.buildFingerprint);
  });
});
