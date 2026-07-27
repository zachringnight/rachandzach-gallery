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
 * Hand-picked faces, from metadata/faces/face-overrides.json.
 *
 * The automatic pick is good but not always right: it can land on someone
 * turned away, mid-hug, or sharing the frame with a stronger face. And 24 of
 * the 132 catalog guests were never resolved by the face pipeline at all, so
 * automation has nothing to offer them.
 *
 * Read from src/generated/person-overrides.json (tracked; written by
 * scripts/export-face-overrides.mjs), falling back to the legacy
 * metadata/faces/face-overrides.json.
 *
 * Shape, keyed by person slug (under a "people" key or bare):
 *   { "rachel-casciano": { "photoId": "<32-hex>", "bbox": [x1, y1, x2, y2] } }
 *   { "aunt-carol":      { "photoId": "<32-hex>",
 *                          "crop": { "x": 0.31, "y": 0.12, "size": 0.4 } } }
 *
 * `photoId` is the imageDataHash, i.e. the directory name under
 * metadata/import/derivatives/previews/.
 *
 * Two override styles:
 *  - `bbox`: a FACE box in that photo's detection space (the dw/dh recorded
 *    in detections.jsonl); this script expands it into a portrait crop via
 *    squareCrop(). May be omitted for a person the detector found -- then
 *    only the photo changes and the detected box is reused. For an
 *    unresolved guest a bbox (or crop) is required.
 *  - `crop`: an exact normalized CROP square chosen by a human in the
 *    /admin/faces screen: x = left/width, y = top/height, size =
 *    side/min(width, height), all fractions of the photo's pixel grid.
 *    Used verbatim (no expansion, no detection data needed). This is what
 *    scripts/export-face-overrides.mjs writes -- the round trip is:
 *    Rachel crops in /admin/faces (Supabase rachandzach_person_overrides)
 *    -> export-face-overrides.mjs -> this file -> this script -> committed
 *    public/faces/{slug}.webp.
 *
 * Use scripts/list-face-candidates.mjs to find a photoId and bbox by hand.
 */
async function readOverrides(repoRoot) {
  // src/generated/ is tracked and is where export-face-overrides.mjs writes.
  // metadata/faces/ is the legacy location and is gitignored, so anything
  // written there was never committed; still read it so an existing local
  // hand-edited file keeps working.
  const candidates = [
    join(repoRoot, "src/generated/person-overrides.json"),
    join(repoRoot, "metadata/faces/face-overrides.json"),
  ];
  for (const path of candidates) {
    let raw;
    try {
      raw = await fs.readFile(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error(`${path} is present but unreadable: ${error.message}`);
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed.people ?? parsed) : {};
  }
  return {};
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

/**
 * An exact human-chosen crop from /admin/faces: x = left/width,
 * y = top/height, size = side/min(width, height). Same normalized contract
 * as rachandzach_person_overrides and src/lib/people/face-types.ts; used
 * verbatim (clamped to the image), never expanded.
 */
function normalizedCrop({ x, y, size }, imgW, imgH) {
  if (![x, y, size].every((v) => typeof v === "number" && Number.isFinite(v))) {
    return null;
  }
  if (size <= 0 || size > 1) return null;
  const side = Math.max(1, Math.round(size * Math.min(imgW, imgH)));
  const left = Math.max(0, Math.min(Math.round(x * imgW), imgW - side));
  const top = Math.max(0, Math.min(Math.round(y * imgH), imgH - side));
  return { left, top, width: side, height: side };
}

async function main() {
  const [signatures, catalog, dims, overrides] = await Promise.all([
    fs.readFile(join(repoRoot, "metadata/faces/signatures.json"), "utf8").then(JSON.parse),
    fs.readFile(join(repoRoot, "src/generated/gallery-v2.json"), "utf8").then(JSON.parse),
    readDetectionDims(),
    readOverrides(repoRoot),
  ]);

  // Only guests who actually appear in the gallery's people facet: the
  // signature file also carries clusters the catalog does not surface.
  const inCatalog = new Set(catalog.people.map((p) => p.slug));
  await fs.mkdir(OUT_DIR, { recursive: true });

  // Everyone the pipeline resolved, plus anyone named only in the overrides:
  // that second group is how an unresolved guest gets a face at all.
  const bySlug = new Map(signatures.people.map((p) => [p.slug, p]));
  for (const slug of Object.keys(overrides)) {
    if (!bySlug.has(slug)) bySlug.set(slug, { slug, clusters: [], bestConfidence: null });
  }

  const manifest = {};
  let written = 0;
  let overridden = 0;
  const skipped = [];

  for (const person of bySlug.values()) {
    const override = overrides[person.slug];
    if (!inCatalog.has(person.slug)) {
      // An exact crop override can still be built for a person outside the
      // catalog facet (an /admin/faces "added" guest): the runtime override
      // shows their face immediately, and this bakes it into the committed
      // set. Anything else outside the catalog is a stale entry.
      if (override && !(override.photoId && override.crop)) {
        skipped.push([person.slug, "override names a slug that is not in the catalog"]);
      }
      if (!(override?.photoId && override?.crop)) continue;
      console.log(`note: ${person.slug} is not in the catalog; building from its crop override anyway`);
    }
    const detected = pickSampleFace(person);
    // An override supplies the photo, and either an exact human crop, its
    // own bbox, or the bbox the detector already found in that photo.
    let face = detected;
    if (override?.photoId) {
      if (override.crop) {
        face = { photoId: override.photoId, crop: override.crop };
      } else {
        const bbox = override.bbox ?? (detected?.photoId === override.photoId ? detected.bbox : null);
        if (!bbox) {
          skipped.push([
            person.slug,
            "override needs a bbox or crop (no detection to reuse for that photo)",
          ]);
          continue;
        }
        face = { photoId: override.photoId, bbox };
      }
      overridden += 1;
    }
    if (!face) {
      skipped.push([person.slug, "no sample face"]);
      continue;
    }
    const dim = dims.get(face.photoId);
    const source = join(PREVIEWS, face.photoId, "1600.webp");
    try {
      const image = sharp(source);
      const meta = await image.metadata();
      if (!meta.width || !meta.height) {
        skipped.push([person.slug, "missing dimensions"]);
        continue;
      }
      let crop;
      if (face.crop) {
        crop = normalizedCrop(face.crop, meta.width, meta.height);
        if (!crop) {
          skipped.push([person.slug, "crop override out of range"]);
          continue;
        }
      } else {
        if (!dim) {
          skipped.push([person.slug, "missing dimensions"]);
          continue;
        }
        crop = squareCrop(face.bbox, meta.width / dim.dw, meta.width, meta.height);
      }
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

  // Reconcile the output directory against what we just generated. A guest
  // who is removed disappears from the manifest but their crop file used to
  // stay on disk, and /faces/{slug}.webp is a predictable URL -- so a deleted
  // person's face remained retrievable indefinitely by anyone who had, or
  // guessed, the path. Deleting a face is supposed to delete the face.
  const expected = new Set(Object.keys(manifest).map((slug) => `${slug}.webp`));
  let removed = 0;
  for (const entry of await fs.readdir(OUT_DIR)) {
    if (!entry.endsWith(".webp") || expected.has(entry)) continue;
    await fs.rm(join(OUT_DIR, entry));
    removed += 1;
  }

  await fs.writeFile(
    join(repoRoot, "src/generated/face-thumbnails.json"),
    `${JSON.stringify({ size: SIZE, people: manifest }, null, 2)}\n`,
  );

  console.log(`wrote ${written} face thumbnails to ${OUT_DIR}`);
  if (removed > 0) {
    console.log(`removed ${removed} obsolete crop(s) no longer in the manifest`);
  }
  console.log(`catalog people: ${inCatalog.size}, without a face: ${inCatalog.size - written}`);
  if (skipped.length > 0) {
    console.log("skipped:");
    for (const [slug, why] of skipped.slice(0, 20)) console.log(`  ${slug}: ${why}`);
  }
}

await main();
