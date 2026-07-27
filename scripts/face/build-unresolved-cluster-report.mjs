#!/usr/bin/env node
/**
 * Emit the unresolved face clusters in the report shape the recurring-face
 * tagger already reads.
 *
 * build-face-signatures.py names 118 of 131 tagged people. What it cannot
 * name it lists as unresolved clusters: recurring faces grouped confidently
 * but attached to nobody. Those are the people still missing from the
 * gallery, and until now nothing put them in front of a human.
 *
 * The tagger consumes zero-tag-review.json, whose clusters cover a narrower
 * case (photos with faces and no tags at all). Rather than teach the tagger a
 * second schema, this converts one into the other: same `clusters` plus
 * `photos` pair, same photoId:faceIndex face keys. The tagger's loader is
 * untouched.
 *
 * Local only. Reads gitignored face artifacts, writes a gitignored report,
 * never opens an original and never touches Supabase.
 *
 * Usage (from the repo root):
 *   node scripts/face/build-unresolved-cluster-report.mjs
 *   node scripts/face/build-unresolved-cluster-report.mjs --min-faces 4
 */
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SIGNATURES = join(repoRoot, "metadata/faces/signatures.json");
const DETECTIONS = join(repoRoot, "metadata/faces/detections.jsonl");
const CATALOG = join(repoRoot, "src/generated/gallery-v2.json");
const OUT = join(repoRoot, "metadata/faces/unresolved-cluster-review.json");

function invariant(condition, message) {
  if (!condition) throw new Error(`unresolved cluster report: ${message}`);
}

export function buildReport(signatures, detectionsByPhoto, catalog, minFaces = 1) {
  const photoMeta = new Map(
    catalog.photos.map((photo) => [
      photo.id,
      { path: photo.originalRelativePath, event: photo.eventSlug },
    ]),
  );

  const clusters = [];
  const impure = [];
  const usedPhotos = new Map();

  for (const cluster of signatures.unresolvedClusters) {
    // sampleFaces is capped at three; members carries the whole cluster.
    // Falling back would silently tag a fraction of the photos.
    const members = cluster.members ?? cluster.sampleFaces;
    invariant(
      Array.isArray(members) && members.length > 0,
      `cluster ${cluster.clusterId} has no members`,
    );
    invariant(
      members.length === cluster.faceCount,
      `cluster ${cluster.clusterId} lists ${members.length} members for ` +
        `faceCount ${cluster.faceCount}; re-run build-face-signatures.py`,
    );
    if (cluster.faceCount < minFaces) continue;

    const keys = [];
    const seenPhotos = new Set();
    for (const member of members) {
      const record = detectionsByPhoto.get(member.photoId);
      invariant(record, `cluster ${cluster.clusterId} references unknown photo ${member.photoId}`);
      const meta = photoMeta.get(member.photoId);
      invariant(meta, `photo ${member.photoId} is not in the catalog`);
      const face = record.faces.find((f) => f.i === member.faceIndex);
      invariant(
        face,
        `photo ${member.photoId} has no face ${member.faceIndex}`,
      );

      const faceKey = `${member.photoId}:${member.faceIndex}`;
      keys.push(faceKey);
      seenPhotos.add(member.photoId);

      if (!usedPhotos.has(member.photoId)) {
        usedPhotos.set(member.photoId, {
          photoId: member.photoId,
          path: meta.path,
          event: meta.event,
          dw: record.dw,
          dh: record.dh,
          faces: [],
        });
      }
      const entry = usedPhotos.get(member.photoId);
      if (!entry.faces.some((f) => f.faceKey === faceKey)) {
        entry.faces.push({
          faceKey,
          photoId: member.photoId,
          path: meta.path,
          event: meta.event,
          faceIndex: member.faceIndex,
          bbox: face.bbox,
          detScore: face.score,
        });
      }
    }

    // One person cannot be in a frame twice, so a cluster holding two faces
    // from one photo is more than one person. Centroid merging can produce
    // these, and it is very likely why they never resolved to a name. Offering
    // one for naming would tag several people at once, so drop it and say so
    // rather than let a reviewer confirm a bad merge.
    if (seenPhotos.size !== keys.length) {
      impure.push({
        clusterId: cluster.clusterId,
        faceCount: cluster.faceCount,
        distinctPhotos: seenPhotos.size,
        reason: "holds two or more faces from one photo, so it is not one person",
      });
      for (const key of keys) {
        const photoId = key.slice(0, key.indexOf(":"));
        const entry = usedPhotos.get(photoId);
        if (entry) {
          entry.faces = entry.faces.filter((f) => f.faceKey !== key);
          if (entry.faces.length === 0) usedPhotos.delete(photoId);
        }
      }
      continue;
    }
    invariant(
      seenPhotos.size === cluster.photoCount,
      `cluster ${cluster.clusterId} photo count drifted`,
    );

    clusters.push({
      clusterId: cluster.clusterId,
      faceCount: cluster.faceCount,
      photoCount: cluster.photoCount,
      samePhotoConflictCount: 0,
      // Who this cluster was photographed alongside: the strongest naming
      // hint available without showing a similarity score.
      topCoTags: cluster.topCoTags ?? [],
      members: keys,
      repeated: true,
    });
  }

  // Biggest first, so the most valuable decisions come while attention is
  // fresh rather than at the end of a 148-cluster queue.
  clusters.sort(
    (a, b) => b.faceCount - a.faceCount || a.clusterId.localeCompare(b.clusterId),
  );

  const fingerprint = createHash("sha256")
    .update(signatures.inputsFingerprint)
    .update(JSON.stringify(clusters.map((c) => [c.clusterId, c.members])))
    .digest("hex");

  return {
    schemaVersion: 1,
    inputsFingerprint: fingerprint,
    source: "signatures.json unresolvedClusters",
    summary: {
      clusters: clusters.length,
      faces: clusters.reduce((total, c) => total + c.faceCount, 0),
      photos: usedPhotos.size,
      largestCluster: clusters[0]?.faceCount ?? 0,
      skippedImpureClusters: impure.length,
    },
    // Not offered for naming. Kept in the report so they are visible rather
    // than silently missing from the queue.
    impureClusters: impure,
    clusters,
    photos: [...usedPhotos.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const index = argv.indexOf("--min-faces");
  const minFaces = index === -1 ? 1 : Number(argv[index + 1]);
  invariant(Number.isFinite(minFaces) && minFaces >= 1, "--min-faces must be >= 1");

  const [signatures, catalog, detectionsRaw] = await Promise.all([
    fs.readFile(SIGNATURES, "utf8").then(JSON.parse),
    fs.readFile(CATALOG, "utf8").then(JSON.parse),
    fs.readFile(DETECTIONS, "utf8"),
  ]);
  const detectionsByPhoto = new Map();
  for (const line of detectionsRaw.split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    detectionsByPhoto.set(record.photoId, record);
  }

  const report = buildReport(signatures, detectionsByPhoto, catalog, minFaces);
  await fs.writeFile(OUT, `${JSON.stringify(report, null, 1)}\n`);
  console.log(
    `${report.summary.clusters} unresolved clusters, ` +
      `${report.summary.faces} faces across ${report.summary.photos} photos ` +
      `(largest ${report.summary.largestCluster})`,
  );
  console.log(`wrote ${OUT}`);
  console.log("next: npm run faces:recurring -- --report " + OUT);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
