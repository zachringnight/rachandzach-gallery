#!/usr/bin/env node
// P5 (design upgrade plan): crop one face thumbnail per tagged guest so the
// Find me picker can show faces instead of a wall of name chips.
//
// Everything is derived locally from artifacts already in the repo:
//   metadata/faces/signatures.json  -- per-person clusters with sampleFaces
//                                      (photoId, faceIndex, bbox)
//   metadata/faces/detections.jsonl -- the detection-space dimensions each
//                                      bbox is expressed in
//   metadata/import/derivatives/previews/{photoId}/1600.webp
//
// Zero network, zero database, and the read-only clean master is never
// touched -- crops come from the import pipeline's own derivatives.
//
// PRIVACY: output lands in public/faces/, which is NOT public. src/proxy.ts
// matches everything except _next/static and _next/image, and PUBLIC_ROUTES
// in src/lib/auth/guest-session.ts does not list /faces, so these requests
// default-deny without a valid guest session. Do not add /faces to
// PUBLIC_ROUTES: these are guests' faces.
//
// Usage: node scripts/build-face-thumbnails.mjs [--out public/faces] [--size 192]
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 || i === process.argv.length - 1 ? fallback : process.argv[i + 1];
}

const OUT_DIR = resolve(repoRoot, argValue("--out", "public/faces"));
const SIZE = Number(argValue("--size", "192"));
const PREVIEWS = resolve(repoRoot, "metadata/import/derivatives/previews");

/** Detection-space dimensions per photo, so bboxes can be rescaled. */
async function readDetectionDims() {
  const dims = new Map();
  const rl = createInterface({
    input: createReadStream(join(repoRoot, "metadata/faces/detections.jsonl")),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    dims.set(row.photoId, { dw: row.dw, dh: row.dh });
  }
  return dims;
}

/**
 * The face a person is most recognisably themselves in: highest-confidence
 * cluster, and within it the largest sample face (bigger box = closer to
 * camera = a better thumbnail than a distant face in a group shot).
 */
function pickSampleFace(person) {
  const clusters = [...person.clusters].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
  );
  for (const cluster of clusters) {
    const faces = [...(cluster.sampleFaces ?? [])].sort((a, b) => {
      const area = (f) => (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]);
      return area(b) - area(a);
    });
    if (faces.length > 0) return faces[0];
  }
  return null;
}

/**
 * A square crop around the face with headroom, so the result reads as a
 * portrait rather than a surveillance still. Clamped to the image so a face
 * near an edge shifts rather than distorts.
 */
function squareCrop(bbox, scale, imgW, imgH) {
  const [x1, y1, x2, y2] = bbox.map((v) => v * scale);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const side = Math.max(x2 - x1, y2 - y1) * 1.5;
  let left = Math.round(cx - side / 2);
  // Bias upward: faces sit better slightly above centre.
  let top = Math.round(cy - side / 2 - side * 0.06);
  const box = Math.round(Math.min(side, imgW, imgH));
  left = Math.max(0, Math.min(left, imgW - box));
  top = Math.max(0, Math.min(top, imgH - box));
  return { left, top, width: box, height: box };
}

async function main() {
  const [signatures, catalog, dims] = await Promise.all([
    fs.readFile(join(repoRoot, "metadata/faces/signatures.json"), "utf8").then(JSON.parse),
    fs.readFile(join(repoRoot, "src/generated/gallery-v2.json"), "utf8").then(JSON.parse),
    readDetectionDims(),
  ]);

  // Only guests who actually appear in the gallery's people facet: the
  // signature file also carries clusters the catalog does not surface.
  const inCatalog = new Set(catalog.people.map((p) => p.slug));
  await fs.mkdir(OUT_DIR, { recursive: true });

  const manifest = {};
  let written = 0;
  const skipped = [];

  for (const person of signatures.people) {
    if (!inCatalog.has(person.slug)) continue;
    const face = pickSampleFace(person);
    if (!face) {
      skipped.push([person.slug, "no sample face"]);
      continue;
    }
    const dim = dims.get(face.photoId);
    const source = join(PREVIEWS, face.photoId, "1600.webp");
    try {
      const image = sharp(source);
      const meta = await image.metadata();
      if (!dim || !meta.width || !meta.height) {
        skipped.push([person.slug, "missing dimensions"]);
        continue;
      }
      const crop = squareCrop(face.bbox, meta.width / dim.dw, meta.width, meta.height);
      await image
        .extract(crop)
        .resize(SIZE, SIZE, { fit: "cover" })
        .webp({ quality: 82 })
        .toFile(join(OUT_DIR, `${person.slug}.webp`));
      manifest[person.slug] = { confidence: person.bestConfidence };
      written += 1;
    } catch (error) {
      skipped.push([person.slug, error.message]);
    }
  }

  await fs.writeFile(
    join(repoRoot, "src/generated/face-thumbnails.json"),
    `${JSON.stringify({ size: SIZE, people: manifest }, null, 2)}\n`,
  );

  console.log(`wrote ${written} face thumbnails to ${OUT_DIR}`);
  console.log(`catalog people: ${inCatalog.size}, without a face: ${inCatalog.size - written}`);
  if (skipped.length > 0) {
    console.log("skipped:");
    for (const [slug, why] of skipped.slice(0, 20)) console.log(`  ${slug}: ${why}`);
  }
}

await main();
