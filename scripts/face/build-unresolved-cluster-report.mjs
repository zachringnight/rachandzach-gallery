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
import sharp from "sharp";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SIGNATURES = join(repoRoot, "metadata/faces/signatures.json");
const DETECTIONS = join(repoRoot, "metadata/faces/detections.jsonl");
const CATALOG = join(repoRoot, "src/generated/gallery-v2.json");
const OUT = join(repoRoot, "metadata/faces/unresolved-cluster-review.json");
const PREVIEWS = join(repoRoot, "metadata/import/derivatives/previews");

// Quality floors, measured on this archive's 575 clustered faces rather than
// guessed. Face fraction p25 = 0.037; focus (variance of the Laplacian on the
// native crop) p25 = 31, median 177, p90 1086 -- a wide spread, so it
// separates well. A cluster is judged by its BEST face, not its worst:
// someone sharp in one frame and blurred in the background of five others is
// still worth naming, because naming them tags the good frame too.
const DEFAULT_MIN_FRAC = 0.03;
const DEFAULT_MIN_FOCUS = 25;

/** Variance of the Laplacian over the face crop: low means soft or blurred. */
async function focusOf(previewPath, bbox, dw) {
  const image = sharp(previewPath);
  const meta = await image.metadata();
  const scale = meta.width / dw;
  const left = Math.max(0, Math.round(bbox[0] * scale));
  const top = Math.max(0, Math.round(bbox[1] * scale));
  const width = Math.min(meta.width - left, Math.round((bbox[2] - bbox[0]) * scale));
  const height = Math.min(meta.height - top, Math.round((bbox[3] - bbox[1]) * scale));
  if (width < 8 || height < 8) return 0;
  const { data, info } = await image
    .extract({ left, top, width, height })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < info.height - 1; y += 1) {
    for (let x = 1; x < info.width - 1; x += 1) {
      const i = y * info.width + x;
      const lap =
        4 * data[i] - data[i - 1] - data[i + 1] - data[i - info.width] - data[i + info.width];
      sum += lap;
      sumSq += lap * lap;
      count += 1;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function invariant(condition, message) {
  if (!condition) throw new Error(`unresolved cluster report: ${message}`);
}

export function buildReport(signatures, detectionsByPhoto, catalog, options = {}) {
  const {
    minFaces = 1,
    minFrac = 0,
    minFocus = 0,
    qualityByFaceKey = new Map(),
  } = options;
  const photoMeta = new Map(
    catalog.photos.map((photo) => [
      photo.id,
      { path: photo.originalRelativePath, event: photo.eventSlug },
    ]),
  );

  const clusters = [];
  const impure = [];
  const tooPoor = [];
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

    // Judge the cluster on its best face. A person who is sharp once and
    // blurred in the background five times is still worth naming; a person
    // who is never more than a soft smudge is not, and tagging them would
    // only put photos nobody wants into their gallery.
    const quality = keys.map((k) => qualityByFaceKey.get(k)).filter(Boolean);
    if (quality.length > 0 && (minFrac > 0 || minFocus > 0)) {
      const bestFrac = Math.max(...quality.map((q) => q.frac));
      const bestFocus = Math.max(...quality.map((q) => q.focus));
      if (bestFrac < minFrac || bestFocus < minFocus) {
        tooPoor.push({
          clusterId: cluster.clusterId,
          faceCount: cluster.faceCount,
          bestFrac: Number(bestFrac.toFixed(4)),
          bestFocus: Math.round(bestFocus),
          reason:
            bestFrac < minFrac
              ? "every face is too small a part of its photo"
              : "every face is too soft to identify",
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
    }

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
      skippedLowQualityClusters: tooPoor.length,
    },
    // Not offered for naming. Kept in the report so they are visible rather
    // than silently missing from the queue.
    impureClusters: impure,
    // Dropped for quality, listed so the queue's omissions are visible.
    lowQualityClusters: tooPoor,
    clusters,
    photos: [...usedPhotos.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    if (i === -1) return fallback;
    const value = Number(argv[i + 1]);
    invariant(Number.isFinite(value) && value >= 0, `${name} needs a number`);
    return value;
  };
  const minFaces = flag("--min-faces", 1);
  const minFrac = flag("--min-face-frac", DEFAULT_MIN_FRAC);
  const minFocus = flag("--min-focus", DEFAULT_MIN_FOCUS);
  invariant(minFaces >= 1, "--min-faces must be >= 1");

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
  const hashById = new Map(catalog.photos.map((p) => [p.id, p.imageDataHash]));

  // Measure focus and size for every clustered face, from the local 1600px
  // derivatives. Originals are never opened.
  const qualityByFaceKey = new Map();
  if (minFrac > 0 || minFocus > 0) {
    for (const cluster of signatures.unresolvedClusters) {
      for (const member of cluster.members ?? []) {
        const key = `${member.photoId}:${member.faceIndex}`;
        if (qualityByFaceKey.has(key)) continue;
        const record = detectionsByPhoto.get(member.photoId);
        const hash = hashById.get(member.photoId);
        if (!record || !hash) continue;
        const face = record.faces.find((f) => f.i === member.faceIndex);
        if (!face) continue;
        const preview = join(PREVIEWS, hash, "1600.webp");
        let focus = 0;
        try {
          focus = await focusOf(preview, face.bbox, record.dw);
        } catch {
          // No derivative means we cannot judge it; let it through rather
          // than hide a cluster for a missing file.
          continue;
        }
        qualityByFaceKey.set(key, {
          frac: (face.bbox[3] - face.bbox[1]) / Math.max(record.dw, record.dh),
          focus,
        });
      }
    }
  }

  const report = buildReport(signatures, detectionsByPhoto, catalog, {
    minFaces,
    minFrac,
    minFocus,
    qualityByFaceKey,
  });
  await fs.writeFile(OUT, `${JSON.stringify(report, null, 1)}\n`);
  const s = report.summary;
  console.log(
    `${s.clusters} clusters, ${s.faces} faces across ${s.photos} photos (largest ${s.largestCluster})`,
  );
  console.log(
    `skipped ${s.skippedLowQualityClusters} too small or too soft ` +
      `(face fraction < ${minFrac}, focus < ${minFocus}), ` +
      `${s.skippedImpureClusters} holding two faces in one photo`,
  );
  console.log(`wrote ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
