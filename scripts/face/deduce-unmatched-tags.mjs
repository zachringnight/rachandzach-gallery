#!/usr/bin/env node
/**
 * Deduce face tags from names already on a photograph.
 *
 * A photograph carries names, and separately the detector found faces in it.
 * Most names can be matched to a face by their saved profile. When exactly
 * ONE name and exactly ONE face are left over, the leftover face is that
 * person by elimination, no model similarity required. That is the strongest
 * evidence in this whole pipeline: it comes from a human already having said
 * "this person is in this photograph".
 *
 * It matters most for guests the recognition side cannot help with at all,
 * the ones with no saved profile: the deduction gives them a first real face,
 * and the next signature rebuild can then learn them properly.
 *
 * Confidence is reported, never assumed:
 *   sole      one unmatched name, one unmatched face. Very strong.
 *   ambiguous more than one of either. Reported for a human, never applied.
 *
 * Writes nothing. It prints candidates and, with --json, a file the stack
 * applier can consume after a person has looked at them.
 *
 *   node scripts/face/deduce-unmatched-tags.mjs
 *   node scripts/face/deduce-unmatched-tags.mjs --json metadata/faces/deduced.json
 */
import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Cosine over unit vectors. */
function dot(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += a[i] * b[i];
  return total;
}

function unit(values) {
  let norm = 0;
  for (const value of values) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return values.map((value) => value / norm);
}

function decode(base64) {
  const buffer = Buffer.from(base64, "base64");
  return unit(
    Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4)),
  );
}

/**
 * A face counts as claimed by a name only well above the archive's measured
 * impostor ceiling (0.244 at P99). Below that a "match" is noise, and letting
 * noise claim a face would hide the very leftover this script looks for.
 */
const CLAIM = 0.45;

async function main() {
  const jsonIndex = process.argv.indexOf("--json");
  const jsonOut = jsonIndex === -1 ? null : process.argv[jsonIndex + 1];

  const [catalog, signatures, detectionsText] = await Promise.all([
    fs.readFile(join(repoRoot, "src/generated/gallery-v2.json"), "utf8").then(JSON.parse),
    fs.readFile(join(repoRoot, "metadata/faces/signatures.json"), "utf8").then(JSON.parse),
    fs.readFile(join(repoRoot, "metadata/faces/detections.jsonl"), "utf8"),
  ]);

  const nameBySlug = new Map(catalog.people.map((person) => [person.slug, person.name]));
  const profiles = new Map();
  for (const person of signatures.people ?? []) {
    const centroids = (person.clusters ?? [])
      .filter((cluster) => cluster.centroid)
      .map((cluster) => unit(cluster.centroid));
    if (centroids.length) profiles.set(person.slug, centroids);
  }

  const detectionByPhoto = new Map();
  for (const line of detectionsText.split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    detectionByPhoto.set(record.photoId, record);
  }

  const sole = [];
  const ambiguous = [];

  for (const photo of catalog.photos) {
    const detection = detectionByPhoto.get(photo.imageDataHash);
    if (!detection) continue;
    const faces = (detection.faces ?? []).filter((face) => face.emb);
    const names = photo.peopleSlugs ?? [];
    if (!faces.length || !names.length) continue;

    const embeddings = new Map(faces.map((face) => [face.i, decode(face.emb)]));

    // Greedy best-first assignment: the strongest name-to-face pair wins,
    // both leave the pool, repeat. Greedy is right here because we only care
    // about what is LEFT OVER, and a confident pair is confident regardless
    // of the order it is taken in.
    const freeFaces = new Set(faces.map((face) => face.i));
    const freeNames = new Set(names);
    for (;;) {
      let best = null;
      for (const slug of freeNames) {
        const centroids = profiles.get(slug);
        if (!centroids) continue;
        for (const faceIndex of freeFaces) {
          const score = Math.max(
            ...centroids.map((centroid) => dot(embeddings.get(faceIndex), centroid)),
          );
          if (score >= CLAIM && (!best || score > best.score)) {
            best = { slug, faceIndex, score };
          }
        }
      }
      if (!best) break;
      freeFaces.delete(best.faceIndex);
      freeNames.delete(best.slug);
    }

    if (freeNames.size === 0 || freeFaces.size === 0) continue;

    // Only faces big and confident enough to be a named guest rather than a
    // head in the far background.
    const usable = [...freeFaces].filter((faceIndex) => {
      const face = faces.find((candidate) => candidate.i === faceIndex);
      const height = (face.bbox[3] - face.bbox[1]) / Math.max(detection.dw, detection.dh);
      return face.score >= 0.7 && height >= 0.03;
    });
    if (!usable.length) continue;

    const row = {
      photoId: photo.imageDataHash,
      path: photo.originalRelativePath,
      names: [...freeNames].map((slug) => ({
        slug,
        name: nameBySlug.get(slug) ?? slug,
        hasProfile: profiles.has(slug),
      })),
      faceIndexes: usable,
    };
    if (freeNames.size === 1 && usable.length === 1) sole.push(row);
    else ambiguous.push(row);
  }

  // A person with no saved profile is the reason this script exists, so lead
  // with them: every one of these is a face for somebody the recognition side
  // cannot currently find at all.
  const noProfileFirst = (left, right) =>
    Number(right.names.some((n) => !n.hasProfile)) -
    Number(left.names.some((n) => !n.hasProfile));
  sole.sort(noProfileFirst);

  const gains = new Map();
  for (const row of sole) {
    for (const entry of row.names) {
      if (!gains.has(entry.slug)) gains.set(entry.slug, { ...entry, photos: 0 });
      gains.get(entry.slug).photos += 1;
    }
  }

  console.log(
    `${sole.length} photographs where exactly one name and one face are left ` +
      `over, so the face is that person by elimination`,
  );
  console.log(`${ambiguous.length} more with several of either, which need a human\n`);

  console.log("By person, strongest first (no saved profile means this would be their first face):\n");
  for (const gain of [...gains.values()].sort(
    (a, b) => Number(!a.hasProfile) - Number(!b.hasProfile) || b.photos - a.photos,
  )) {
    console.log(
      `  ${gain.name.padEnd(26)} ${String(gain.photos).padStart(3)} photos` +
        (gain.hasProfile ? "" : "   <- no saved profile today"),
    );
  }

  if (jsonOut) {
    await fs.writeFile(
      resolve(jsonOut),
      `${JSON.stringify({ claimThreshold: CLAIM, sole, ambiguous }, null, 1)}\n`,
    );
    console.log(`\nwrote ${jsonOut}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
