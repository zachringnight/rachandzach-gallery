#!/usr/bin/env node
/**
 * Build the private, local face-naming workbench.
 *
 * Everything this writes lives under gitignored `metadata/identity-review/`
 * on this Mac. It is read-only on the wedding originals and on the clean
 * master: photographs are displayed from the local preview derivatives that
 * the import already produced, and the source JPEG is only ever linked, never
 * opened or rewritten.
 *
 * The page records decisions in browser localStorage and exports one small
 * JSON file. `scripts/import-naming-tool-decisions.mjs` is the only thing that
 * turns that file into tracked metadata, and it is dry-run by default.
 *
 * Face grouping is a presentation aid only. Similar-looking faces are placed
 * side by side so one person can be named once instead of six times; the page
 * never suggests who someone is from a model score, and every member of a
 * group is shown so the human decision stays the human's.
 *
 *   node scripts/build-naming-tool.mjs [--open]
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsv } from "./lib/photo-metadata.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const reviewDir = join(rootDir, "metadata", "identity-review");
const queueFile = join(rootDir, "metadata", "sorted", "unconfirmed-review-queue.csv");
const unresolvedCropsFile = join(reviewDir, "unresolved-crops.csv");
const partialCropsFile = join(reviewDir, "partial-crops.csv");
const peopleFile = join(reviewDir, "people-reference-index.csv");
const referenceCropsFile = join(reviewDir, "reference-crops.csv");
const catalogFile = join(rootDir, "src", "generated", "gallery-v2.json");
const attendeesFile = join(rootDir, "metadata", "wedding-attendees.json");
const detectionsFile = join(rootDir, "metadata", "faces", "detections.jsonl");
const derivativesRoot = join(rootDir, "metadata", "import", "derivatives", "previews");
const committedFacesRoot = join(rootDir, "public", "faces");
const sourceRoot = resolve(rootDir, "..", "Rachel & Zach - Ali Beck Photography 2");
const ledgerFile = join(reviewDir, "naming-decisions.json");
const modelFile = join(reviewDir, "naming-tool-model.json");
const outputFile = join(reviewDir, "name-people.html");

// Grouping thresholds. The face signature run measured impostor pairs topping
// out near 0.59 and genuine pairs sitting at 0.70 median, so 0.64 with an
// average-link merge keeps groups conservative. A group that is wrong is worse
// than no group at all, because it invites one name to cover several faces.
const GROUP_EDGE = 0.64;
const GROUP_MIN_PAIR = 0.55;
const GROUP_MAX = 12;
// How much room to leave around a detected face box, as a multiple of its
// longest side. Tight is for recognition, wide is for "who is this standing
// next to".
const CROP_TIGHT = 1.9;
const CROP_WIDE = 4.2;

function invariant(condition, message) {
  if (!condition) throw new Error("Naming tool invalid: " + message);
}

function readCsv(text) {
  const [headers = [], ...rows] = parseCsv(text);
  return rows
    .filter((row) => row.some((value) => String(value || "").trim()))
    .map((row) =>
      Object.fromEntries(headers.map((header, index) => [header.trim(), row[index] || ""])),
    );
}

async function readCsvFile(path) {
  return fs
    .readFile(path, "utf8")
    .then(readCsv)
    .catch(() => []);
}

async function readJsonFile(path, fallback = null) {
  return fs
    .readFile(path, "utf8")
    .then((text) => JSON.parse(text))
    .catch((error) => {
      if (error.code === "ENOENT") return fallback;
      throw error;
    });
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Repo-relative path to a URL the generated page can load over file://. */
function localUrl(absolutePath) {
  return relative(dirname(outputFile), absolutePath)
    .split(sep)
    .map((part) => (part === ".." ? part : encodeURIComponent(part)))
    .join("/");
}

function repoUrl(repoRelativePath) {
  return localUrl(join(rootDir, repoRelativePath));
}

function sourceUrl(sourceRelativePath) {
  return localUrl(join(sourceRoot, sourceRelativePath));
}

function numeric(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value) {
  return Number(value.toFixed(6));
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function boxFromRow(row) {
  const x = numeric(row.box_x);
  const y = numeric(row.box_y);
  const width = numeric(row.box_w);
  const height = numeric(row.box_h);
  if ([x, y, width, height].some((value) => value == null)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * Square crop window around a normalized face box, expressed the way the page
 * renders it: x/y are the top-left corner as a fraction of the full image and
 * size is the side length as a fraction of the image's shorter edge.
 */
function cropWindow(box, aspectRatio, padding) {
  const width = aspectRatio >= 1 ? aspectRatio : 1;
  const height = aspectRatio >= 1 ? 1 : 1 / aspectRatio;
  // Work in "shorter edge = 1" units so the window stays square on screen.
  const boxWidth = box.width * width;
  const boxHeight = box.height * height;
  const side = Math.min(Math.max(boxWidth, boxHeight) * padding, Math.min(width, height));
  const centerX = (box.x + box.width / 2) * width;
  const centerY = (box.y + box.height / 2) * height;
  const left = clamp(centerX - side / 2, 0, width - side);
  const top = clamp(centerY - side / 2, 0, height - side);
  return { x: round(left / width), y: round(top / height), size: round(side) };
}

function splitPeople(value) {
  return String(value || "")
    .split(";")
    .map((person) => person.trim())
    .filter(Boolean);
}

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function suggestionSourceName(filename) {
  if (filename === "manual-confirmed-matches.csv") return "manual";
  return filename.replace(/\.csv$/, "").replace(/^identity-review-/, "agent ");
}

async function readSuggestionRows() {
  const files = await fs.readdir(reviewDir).catch(() => []);
  const suggestionFiles = files
    .filter(
      (file) =>
        /^identity-review-\d{2}-\d{2}\.csv$/.test(file) ||
        file === "manual-confirmed-matches.csv",
    )
    .sort();
  const rows = [];
  for (const file of suggestionFiles) {
    const parsed = await readCsvFile(join(reviewDir, file));
    for (const row of parsed) {
      if (!row.path || row.recommendation !== "replace" || !row.people) continue;
      const people = splitPeople(row.people);
      if (!people.length) continue;
      for (const person of people) {
        rows.push({
          path: row.path,
          person,
          confidence: row.confidence || "",
          notes: row.notes || "",
          source: suggestionSourceName(file),
        });
      }
    }
  }
  return rows;
}

async function readDetections() {
  const byPath = new Map();
  const text = await fs.readFile(detectionsFile, "utf8").catch(() => "");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    byPath.set(record.path, record);
  }
  return byPath;
}

function decodeEmbedding(base64) {
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length !== 2048) return null;
  return new Float32Array(buffer.buffer, buffer.byteOffset, 512);
}

function cosine(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += left[index] * right[index];
  return total;
}

function intersectionOverUnion(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * The review CSVs were cut before the current detector run, so their
 * face_index does not line up with the detector's ordering. Geometry does:
 * match each reviewed box to the detected face it overlaps.
 */
function matchDetection(detection, box) {
  if (!detection || !box) return null;
  let best = null;
  let bestScore = 0;
  for (const face of detection.faces || []) {
    const candidate = {
      x: face.bbox[0] / detection.dw,
      y: face.bbox[1] / detection.dh,
      width: (face.bbox[2] - face.bbox[0]) / detection.dw,
      height: (face.bbox[3] - face.bbox[1]) / detection.dh,
    };
    const score = intersectionOverUnion(box, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = face;
    }
  }
  return bestScore >= 0.2 ? { face: best, iou: bestScore } : null;
}

/**
 * Average-link agglomerative grouping over the reviewed faces only. Kept
 * deliberately small and conservative: this decides what sits next to what on
 * screen, nothing else.
 */
function groupFaces(entries) {
  const clusters = entries.map((entry, index) => ({ index, members: [entry] }));
  let merged = true;
  while (merged) {
    merged = false;
    let bestPair = null;
    let bestScore = GROUP_EDGE;
    for (let a = 0; a < clusters.length; a += 1) {
      for (let b = a + 1; b < clusters.length; b += 1) {
        if (clusters[a].members.length + clusters[b].members.length > GROUP_MAX) continue;
        let total = 0;
        let minimum = 1;
        for (const left of clusters[a].members) {
          for (const right of clusters[b].members) {
            const score = cosine(left.embedding, right.embedding);
            total += score;
            if (score < minimum) minimum = score;
          }
        }
        if (minimum < GROUP_MIN_PAIR) continue;
        const average = total / (clusters[a].members.length * clusters[b].members.length);
        if (average > bestScore) {
          bestScore = average;
          bestPair = [a, b];
        }
      }
    }
    if (bestPair) {
      const [a, b] = bestPair;
      clusters[a].members.push(...clusters[b].members);
      clusters.splice(b, 1);
      merged = true;
    }
  }
  return clusters
    .filter((cluster) => cluster.members.length > 1)
    .sort((left, right) => right.members.length - left.members.length)
    .map((cluster, index) => ({
      id: "g" + String(index + 1).padStart(3, "0"),
      keys: cluster.members.map((member) => member.key),
    }));
}

function fingerprint(parts) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(String(part)).update(" ");
  return hash.digest("hex");
}

function derivativeUrl(photoId, preferred) {
  for (const filename of preferred) {
    const path = join(derivativesRoot, photoId, filename);
    if (existsSync(path)) return localUrl(path);
  }
  return null;
}

async function main() {
  const open = process.argv.includes("--open");

  const [
    queueRows,
    unresolvedRows,
    partialRows,
    personRows,
    referenceCropRows,
    suggestionRows,
    catalog,
    attendees,
    detections,
    ledger,
  ] = await Promise.all([
    readCsvFile(queueFile),
    readCsvFile(unresolvedCropsFile),
    readCsvFile(partialCropsFile),
    readCsvFile(peopleFile),
    readCsvFile(referenceCropsFile),
    readSuggestionRows(),
    readJsonFile(catalogFile),
    readJsonFile(attendeesFile, { attendees: [] }),
    readDetections(),
    readJsonFile(ledgerFile, { schemaVersion: 1, entries: {} }),
  ]);

  invariant(Array.isArray(catalog?.photos), "generated catalog photos are missing");
  invariant(Array.isArray(catalog?.people), "generated catalog people are missing");

  // The review CSVs predate the numbered clean-master folders, so
  // "Day 1/x.jpg" has to be matched to "01 Day 1/x.jpg".
  const photoByReviewPath = new Map();
  for (const photo of catalog.photos) {
    photoByReviewPath.set(photo.originalRelativePath.replace(/^\d{2} /, ""), photo);
    photoByReviewPath.set(photo.originalRelativePath, photo);
  }
  const detectionByReviewPath = new Map();
  for (const [path, record] of detections) {
    detectionByReviewPath.set(path.replace(/^\d{2} /, ""), record);
    detectionByReviewPath.set(path, record);
  }

  // Roster: everyone the catalog knows plus every seated attendee, so a face
  // can be named even when that person has no photographs yet.
  const rosterBySlug = new Map();
  for (const person of catalog.people) {
    rosterBySlug.set(person.slug, {
      slug: person.slug,
      name: person.name,
      photoCount: person.photoCount || 0,
    });
  }
  for (const attendee of attendees.attendees || []) {
    if (rosterBySlug.has(attendee.personSlug)) continue;
    rosterBySlug.set(attendee.personSlug, {
      slug: attendee.personSlug,
      name: attendee.displayName,
      photoCount: 0,
    });
  }

  const sheetByPerson = new Map(
    personRows.filter((row) => row.person && row.sheet).map((row) => [row.person, row.sheet]),
  );
  const cropsByPerson = new Map();
  for (const row of referenceCropRows) {
    if (!row.person || !row.crop) continue;
    const list = cropsByPerson.get(row.person) || [];
    if (list.length < 4) list.push(row.crop);
    cropsByPerson.set(row.person, list);
  }

  const roster = [...rosterBySlug.values()]
    .map((person) => {
      const faceFile = join(committedFacesRoot, person.slug + ".webp");
      const sheet = sheetByPerson.get(person.name);
      const crops = cropsByPerson.get(person.name) || [];
      return {
        slug: person.slug,
        name: person.name,
        photoCount: person.photoCount,
        faceUrl: existsSync(faceFile) ? localUrl(faceFile) : null,
        sheetUrl: sheet ? repoUrl(sheet) : null,
        cropUrls: crops.map((crop) => repoUrl(crop)),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "en-US"));

  const rosterByName = new Map(roster.map((person) => [person.name.toLowerCase(), person]));
  const rosterBySlugFinal = new Map(roster.map((person) => [person.slug, person]));

  function resolvePerson(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return null;
    return (
      rosterByName.get(trimmed.toLowerCase()) || rosterBySlugFinal.get(slugify(trimmed)) || null
    );
  }

  const suggestionsByPath = new Map();
  for (const row of suggestionRows) {
    const person = resolvePerson(row.person);
    const list = suggestionsByPath.get(row.path) || [];
    const key = (person ? person.slug : row.person.toLowerCase());
    if (list.some((item) => item.key === key)) continue;
    list.push({
      key,
      slug: person ? person.slug : null,
      name: person ? person.name : row.person,
      confidence: row.confidence,
      source: row.source,
      notes: row.notes,
    });
    suggestionsByPath.set(row.path, list);
  }

  const queueByPath = new Map(queueRows.map((row) => [row.path, row]));
  const skipped = { uncatalogued: new Set(), noCrop: 0 };

  function buildItem(row, kind) {
    const photo = photoByReviewPath.get(row.path);
    if (!photo) {
      skipped.uncatalogued.add(row.path);
      return null;
    }
    const photoUrl =
      derivativeUrl(photo.imageDataHash, ["1600.webp", "960.webp", "2400.jpeg"]) ||
      (row.crop ? repoUrl(row.crop) : null);
    if (!photoUrl) {
      skipped.noCrop += 1;
      return null;
    }
    const thumbUrl =
      derivativeUrl(photo.imageDataHash, ["480.webp", "960.webp"]) || photoUrl;
    const aspectRatio = photo.width && photo.height ? photo.width / photo.height : 1;
    const box = boxFromRow(row);
    const detection = detectionByReviewPath.get(row.path);
    const match = matchDetection(detection, box);
    const queueRow = queueByPath.get(row.path);
    const faceLabel = row.face_index || "full";
    const key = kind + ":" + row.path + ":" + faceLabel;
    return {
      key,
      kind,
      id: row.review_id || "",
      path: row.path,
      catalogPath: photo.originalRelativePath,
      photoId: photo.imageDataHash,
      event: photo.eventSlug || row.path.split("/")[0] || "",
      filename: row.path.split("/").pop() || "",
      faceLabel,
      faceIndex: match ? match.face.i : null,
      scope: box ? "face" : "photo",
      photoUrl,
      thumbUrl,
      sourceUrl: sourceUrl(row.path),
      aspectRatio: round(aspectRatio),
      box: box
        ? {
            x: round(box.x),
            y: round(box.y),
            width: round(box.width),
            height: round(box.height),
          }
        : null,
      tightCrop: box ? cropWindow(box, aspectRatio, CROP_TIGHT) : null,
      wideCrop: box ? cropWindow(box, aspectRatio, CROP_WIDE) : null,
      fallbackCropUrl: row.crop ? repoUrl(row.crop) : null,
      otherFaces: (detection?.faces || [])
        .map((face) => ({
          index: face.i,
          box: {
            x: round(face.bbox[0] / detection.dw),
            y: round(face.bbox[1] / detection.dh),
            width: round((face.bbox[2] - face.bbox[0]) / detection.dw),
            height: round((face.bbox[3] - face.bbox[1]) / detection.dh),
          },
        }))
        .filter((face) => !match || face.index !== match.face.i),
      existingPeople: splitPeople(row.existing_people).map((name) => {
        const person = resolvePerson(name);
        return { name: person ? person.name : name, slug: person ? person.slug : null };
      }),
      catalogPeople: (photo.peopleSlugs || [])
        .map((slug) => rosterBySlugFinal.get(slug))
        .filter(Boolean)
        .map((person) => ({ name: person.name, slug: person.slug })),
      notes: row.notes || queueRow?.notes || "",
      guesses: suggestionsByPath.get(row.path) || [],
      embedding: match ? decodeEmbedding(match.face.emb) : null,
      groupId: null,
    };
  }

  const items = [];
  for (const row of unresolvedRows) {
    const item = buildItem(row, "missing");
    if (item) items.push(item);
  }
  for (const row of partialRows) {
    const item = buildItem(row, "partial");
    if (item) items.push(item);
  }

  const groupable = items
    .filter((item) => item.embedding)
    .map((item) => ({ key: item.key, embedding: item.embedding }));
  const groups = groupFaces(groupable);
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  for (const group of groups) {
    for (const key of group.keys) itemByKey.get(key).groupId = group.id;
  }

  // Embeddings are a build-time input only. They never reach the page.
  for (const item of items) delete item.embedding;

  const groupOrder = new Map(groups.map((group, index) => [group.id, index]));
  items.sort((left, right) => {
    const leftGroup = left.groupId ? groupOrder.get(left.groupId) : Number.MAX_SAFE_INTEGER;
    const rightGroup = right.groupId ? groupOrder.get(right.groupId) : Number.MAX_SAFE_INTEGER;
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    const scopeDelta = Number(left.scope === "photo") - Number(right.scope === "photo");
    if (scopeDelta) return scopeDelta;
    const guessDelta = Number(right.guesses.length > 0) - Number(left.guesses.length > 0);
    if (guessDelta) return guessDelta;
    return (
      left.catalogPath.localeCompare(right.catalogPath) ||
      String(left.faceLabel).localeCompare(String(right.faceLabel))
    );
  });

  const buildFingerprint = fingerprint([
    "naming-tool-v3",
    ...items.map(
      (item) =>
        item.key + "|" + item.photoId + "|" + item.catalogPath + "|" + String(item.faceIndex),
    ),
    ...roster.map((person) => person.slug),
  ]);

  const ledgerEntries = ledger?.entries && typeof ledger.entries === "object" ? ledger.entries : {};
  let priorCount = 0;
  for (const item of items) {
    const prior = ledgerEntries[item.key];
    if (!prior) continue;
    priorCount += 1;
    item.prior = {
      action: prior.action,
      personSlugs: Array.isArray(prior.personSlugs) ? prior.personSlugs : [],
      note: prior.note || "",
      decidedAt: prior.decidedAt || "",
    };
  }

  const model = {
    schemaVersion: 1,
    tool: "naming-tool",
    buildFingerprint,
    builtAt: new Date().toISOString(),
    counts: {
      items: items.length,
      missing: items.filter((item) => item.kind === "missing").length,
      partial: items.filter((item) => item.kind === "partial").length,
      grouped: items.filter((item) => item.groupId).length,
      groups: groups.length,
      roster: roster.length,
      priorDecisions: priorCount,
    },
    groups: groups.map((group) => ({ id: group.id, keys: group.keys })),
    roster,
    items,
  };

  await fs.writeFile(modelFile, JSON.stringify(model, null, 2) + "\n");
  await fs.writeFile(outputFile, renderHtml(model));

  console.log("Wrote " + relative(rootDir, outputFile));
  console.log("Wrote " + relative(rootDir, modelFile));
  console.log("Review items: " + model.counts.items);
  console.log("  missing-tag faces: " + model.counts.missing);
  console.log("  extra faces on tagged photos: " + model.counts.partial);
  console.log(
    "Look-alike groups: " +
      model.counts.groups +
      " covering " +
      model.counts.grouped +
      " items",
  );
  console.log("Roster names offered: " + model.counts.roster);
  if (priorCount) console.log("Decisions already imported: " + priorCount);
  if (skipped.uncatalogued.size) {
    console.log(
      "Skipped " +
        skipped.uncatalogued.size +
        " photos that are no longer in the catalog (Sneak Peek duplicates consolidated into their retained copies).",
    );
  }
  if (skipped.noCrop) console.log("Skipped " + skipped.noCrop + " rows with no displayable image.");
  console.log("");
  console.log("Open: " + outputFile);

  if (open) {
    spawn("open", [outputFile], { stdio: "ignore", detached: true }).unref();
  }
}

const css = String.raw`
  :root {
    color-scheme: light;
    --bg: #f6f3ec;
    --surface: #fffdf8;
    --surface-soft: #faf6ee;
    --ink: #2b241d;
    --muted: #776d61;
    --line: #ded5c7;
    --sage: #3f5a49;
    --sage-soft: #e7eee6;
    --gold: #bf9b5f;
    --terracotta: #a95f4a;
    --danger: #8d4d3d;
    --shadow: 0 14px 34px rgba(43, 36, 29, 0.09);
    --stage: #221e1a;
  }
  * { box-sizing: border-box; }
  html {
    background: var(--bg);
    color: var(--ink);
    font-family: "Avenir Next", Avenir, Inter, system-ui, sans-serif;
    font-size: 15px;
  }
  body { margin: 0; }
  button, input, textarea { font: inherit; color: inherit; }
  button {
    min-height: 34px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
    padding: 0 11px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }
  button:hover { border-color: var(--sage); }
  button:disabled { opacity: 0.4; cursor: default; }
  button.primary { border-color: var(--sage); background: var(--sage); color: #fffdf8; }
  button.warn { border-color: #d9b6aa; background: #fff7f4; color: var(--danger); }
  button.active { border-color: var(--sage); background: var(--sage-soft); }
  button.tiny { min-height: 26px; padding: 0 8px; font-size: 12px; }
  kbd {
    display: inline-block;
    min-width: 18px;
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: var(--surface);
    padding: 1px 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    font-weight: 700;
    text-align: center;
  }

  header {
    position: sticky;
    top: 0;
    z-index: 8;
    display: grid;
    gap: 9px;
    border-bottom: 1px solid var(--line);
    background: rgba(246, 243, 236, 0.97);
    backdrop-filter: blur(12px);
    padding: 11px 18px 9px;
  }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
  h1 {
    margin: 0;
    font-family: "Iowan Old Style", Georgia, serif;
    font-size: 21px;
    font-weight: 500;
  }
  .kicker {
    color: var(--muted);
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.09em;
  }
  .headStats { display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; }
  .stat { text-align: right; }
  .statValue { font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .statLabel { color: var(--muted); font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.07em; }
  .rail { height: 6px; border-radius: 999px; background: #e6e0d4; overflow: hidden; }
  .railFill { width: 0%; height: 100%; background: linear-gradient(90deg, var(--sage), var(--gold)); transition: width 200ms ease; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .toolbar input[type="search"] {
    min-height: 32px;
    flex: 0 1 220px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
    padding: 0 10px;
  }
  .spacer { flex: 1 1 auto; }

  main { padding: 14px 18px 40px; }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 400px;
    gap: 16px;
    align-items: start;
  }
  .panel {
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .stage { padding: 12px; display: grid; gap: 10px; }
  .stageTop { display: flex; gap: 12px; align-items: stretch; }
  .faceView {
    position: relative;
    flex: 0 0 auto;
    width: min(46vh, 430px);
    aspect-ratio: 1 / 1;
    overflow: hidden;
    border-radius: 8px;
    background: var(--stage);
  }
  .faceView img { position: absolute; display: block; max-width: none; }
  .faceView.contain img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .contextView {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 8px;
    background: var(--stage);
  }
  .contextWrap { position: relative; display: inline-block; max-width: 100%; max-height: min(46vh, 430px); }
  .contextWrap img { display: block; max-width: 100%; max-height: min(46vh, 430px); width: auto; }
  .marker {
    position: absolute;
    border: 2px solid #f6d476;
    border-radius: 4px;
    box-shadow: 0 0 0 9999px rgba(34, 30, 26, 0.42);
    pointer-events: none;
  }
  .marker.other {
    border-color: rgba(255, 253, 248, 0.55);
    border-style: dashed;
    box-shadow: none;
  }
  .stageBar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
  }
  .groupStrip { display: grid; gap: 7px; }
  .groupRow { display: flex; gap: 7px; overflow-x: auto; padding-bottom: 3px; }
  .groupFace {
    position: relative;
    flex: 0 0 auto;
    width: 92px;
    height: 92px;
    padding: 0;
    overflow: hidden;
    border-radius: 7px;
    background: var(--stage);
  }
  .groupFace img { position: absolute; display: block; max-width: none; }
  .groupFace.current { outline: 3px solid var(--gold); outline-offset: -3px; }
  .groupFace .badge {
    position: absolute;
    left: 3px;
    bottom: 3px;
    border-radius: 4px;
    background: rgba(34, 30, 26, 0.78);
    padding: 1px 5px;
    color: #fffdf8;
    font-size: 10px;
    font-weight: 800;
  }
  .groupFace.done .badge { background: var(--sage); }

  .side { display: grid; gap: 11px; padding: 13px; }
  .statusRow { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px 9px;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .pill.partial { border-color: var(--gold); background: #fbf4e5; color: #7a5d24; }
  .pill.done { border-color: var(--sage); background: var(--sage-soft); color: var(--sage); }
  .pill.skip { border-color: var(--gold); background: #fbf4e5; color: #7a5d24; }
  .pill.none { border-color: #d9b6aa; background: #fff7f4; color: var(--danger); }
  .meta { display: grid; gap: 3px; }
  .metaPath { font-size: 13px; font-weight: 800; overflow-wrap: anywhere; }
  .metaNote { color: var(--muted); font-size: 12px; line-height: 1.35; margin: 0; }
  .label {
    margin: 0 0 5px;
    color: var(--muted);
    font-size: 10px;
    font-weight: 850;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .comboWrap { position: relative; display: grid; gap: 6px; }
  .comboInput {
    width: 100%;
    min-height: 40px;
    border: 2px solid var(--line);
    border-radius: 7px;
    background: #fff;
    padding: 0 11px;
    font-size: 15px;
    font-weight: 700;
  }
  .comboInput:focus { outline: none; border-color: var(--sage); }
  .comboInput.armed { border-color: var(--sage); background: #fff; }
  .options { display: grid; gap: 3px; max-height: 280px; overflow-y: auto; }
  .option {
    display: grid;
    grid-template-columns: 34px 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 40px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    padding: 3px 6px;
    text-align: left;
    font-size: 13px;
    font-weight: 700;
  }
  .option:hover { background: var(--surface-soft); }
  .option.highlight { border-color: var(--sage); background: var(--sage-soft); }
  .option .thumb {
    width: 34px;
    height: 34px;
    border-radius: 5px;
    background: #e9e1d5 center/cover no-repeat;
    display: grid;
    place-items: center;
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
  }
  .option .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .option .hint { color: var(--muted); font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .option .num {
    min-width: 16px;
    border-radius: 3px;
    background: var(--surface-soft);
    padding: 0 4px;
    color: var(--muted);
    font-size: 10px;
    font-weight: 800;
    text-align: center;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--sage);
    border-radius: 999px;
    background: var(--sage-soft);
    padding: 3px 5px 3px 9px;
    font-size: 12px;
    font-weight: 800;
  }
  .chip button {
    min-height: 18px;
    width: 18px;
    border: 0;
    border-radius: 999px;
    background: rgba(63, 90, 73, 0.16);
    padding: 0;
    line-height: 1;
    font-size: 12px;
  }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .actions button { min-height: 38px; }
  .actions .wide { grid-column: 1 / -1; }
  .noteInput {
    width: 100%;
    min-height: 34px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #fff;
    padding: 7px 10px;
    font-size: 13px;
    resize: vertical;
  }
  details.reference summary { cursor: pointer; color: var(--muted); font-size: 12px; font-weight: 800; }
  .referenceGrid { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; }
  .referenceGrid img {
    width: 78px;
    height: 78px;
    object-fit: cover;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #e9e1d5;
  }

  .drawer {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: none;
    background: rgba(43, 36, 29, 0.44);
  }
  .drawer.open { display: grid; place-items: center; }
  .drawerCard {
    width: min(1000px, 94vw);
    max-height: 86vh;
    overflow: hidden;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 10px;
    border-radius: 11px;
    background: var(--surface);
    box-shadow: 0 30px 70px rgba(43, 36, 29, 0.3);
    padding: 16px;
  }
  .rosterGrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
    gap: 8px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .rosterCard {
    display: grid;
    gap: 5px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface-soft);
    padding: 7px;
    text-align: center;
    min-height: 0;
  }
  .rosterCard:hover { border-color: var(--sage); }
  .rosterCard .face {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: 6px;
    background: #e9e1d5;
    overflow: hidden;
    display: grid;
    place-items: center;
    color: var(--muted);
    font-size: 17px;
    font-weight: 800;
  }
  .rosterCard .face img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .rosterCard .name { font-size: 12px; font-weight: 800; line-height: 1.2; overflow-wrap: anywhere; }
  .rosterCard .count { color: var(--muted); font-size: 10px; font-weight: 800; }

  .helpGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 6px 18px; overflow-y: auto; }
  .helpRow { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; }
  .helpRow span { color: var(--muted); font-weight: 700; }

  .empty { display: none; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); padding: 26px; color: var(--muted); font-weight: 700; }
  .empty.visible { display: block; }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 20px;
    z-index: 30;
    transform: translate(-50%, 14px);
    opacity: 0;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow);
    padding: 9px 16px;
    font-size: 13px;
    font-weight: 800;
    pointer-events: none;
    transition: opacity 130ms ease, transform 130ms ease;
  }
  .toast.visible { opacity: 1; transform: translate(-50%, 0); }
  [hidden] { display: none !important; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  @media (max-width: 1120px) {
    .layout { grid-template-columns: 1fr; }
    .stageTop { flex-direction: column; }
    .faceView { width: 100%; }
  }
`;

const clientJs = String.raw`
(() => {
  "use strict";
  const model = JSON.parse(document.getElementById("model").textContent);
  const items = model.items;
  const roster = model.roster;
  const rosterBySlug = new Map(roster.map((p) => [p.slug, p]));
  const itemByKey = new Map(items.map((i) => [i.key, i]));
  const groupKeys = new Map(model.groups.map((g) => [g.id, g.keys]));
  const storageKey = "rzNamingTool:" + model.buildFingerprint;
  const prefsKey = "rzNamingToolPrefs";

  const state = new Map(JSON.parse(localStorage.getItem(storageKey) || "[]"));
  for (const item of items) {
    if (state.has(item.key) || !item.prior) continue;
    state.set(item.key, {
      action: item.prior.action,
      personSlugs: item.prior.personSlugs,
      note: item.prior.note,
      imported: true
    });
  }

  const prefs = Object.assign(
    { zoom: "tight", mode: "open" },
    JSON.parse(localStorage.getItem(prefsKey) || "{}")
  );
  let mode = prefs.mode;
  let zoom = prefs.zoom;
  let currentKey = "";
  let currentIndex = 0;
  let query = "";
  let highlight = 0;
  let pending = [];
  let undoStack = [];
  let sessionDone = 0;
  const sessionStart = Date.now();
  let toastTimer = null;

  const els = {};
  for (const node of document.querySelectorAll("[id]")) els[node.id] = node;

  function save() {
    localStorage.setItem(storageKey, JSON.stringify([...state.entries()]));
    localStorage.setItem(prefsKey, JSON.stringify({ zoom: zoom, mode: mode }));
  }

  function record(item) {
    return state.get(item.key) || null;
  }

  function statusOf(item) {
    const r = record(item);
    if (!r) return "open";
    if (r.action === "tag") return "tagged";
    if (r.action === "not-a-guest") return "not-a-guest";
    if (r.action === "remove") return "removed";
    if (r.action === "skip") return "skipped";
    return "open";
  }

  function isResolved(item) {
    const s = statusOf(item);
    return s === "tagged" || s === "not-a-guest" || s === "removed";
  }

  function visible() {
    const filter = els.filter.value.trim().toLowerCase();
    return items.filter((item) => {
      const s = statusOf(item);
      if (mode === "open" && (isResolved(item) || s === "skipped")) return false;
      if (mode === "skipped" && s !== "skipped") return false;
      if (mode === "done" && !isResolved(item)) return false;
      if (mode === "groups" && !item.groupId) return false;
      if (!filter) return true;
      const r = record(item);
      const hay = [
        item.catalogPath,
        item.notes,
        item.event,
        item.groupId || "",
        item.existingPeople.map((p) => p.name).join(" "),
        item.guesses.map((g) => g.name).join(" "),
        (r ? r.personSlugs || [] : []).map((s2) => (rosterBySlug.get(s2) || {}).name || s2).join(" ")
      ].join(" ").toLowerCase();
      return hay.indexOf(filter) !== -1;
    });
  }

  function current() {
    const list = visible();
    if (!list.length) return null;
    let index = list.findIndex((i) => i.key === currentKey);
    if (index < 0) index = Math.min(currentIndex, list.length - 1);
    currentIndex = index;
    currentKey = list[index].key;
    return list[index];
  }

  function toast(text) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = text;
    els.toast.classList.add("visible");
    toastTimer = window.setTimeout(() => els.toast.classList.remove("visible"), 1400);
  }

  function initials(name) {
    return String(name || "?").split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("");
  }

  function cropStyle(crop, aspectRatio) {
    const a = aspectRatio > 0 ? aspectRatio : 1;
    const size = Math.min(Math.max(crop.size, 0.0001), 1);
    const width = a >= 1 ? a : 1;
    const height = a >= 1 ? 1 : 1 / a;
    const scale = 1 / size;
    return {
      width: (width * scale * 100) + "%",
      height: (height * scale * 100) + "%",
      left: (-crop.x * width * scale * 100) + "%",
      top: (-crop.y * height * scale * 100) + "%"
    };
  }

  function applyCrop(container, item, crop) {
    container.innerHTML = "";
    const img = document.createElement("img");
    img.decoding = "async";
    img.alt = "";
    if (crop) {
      container.classList.remove("contain");
      img.src = item.photoUrl;
      Object.assign(img.style, cropStyle(crop, item.aspectRatio));
    } else {
      container.classList.add("contain");
      img.src = item.fallbackCropUrl || item.photoUrl;
    }
    container.append(img);
  }

  // ---------- suggestions ----------

  function scoreName(person, q) {
    const name = person.name.toLowerCase();
    if (name === q) return 0;
    if (name.indexOf(q) === 0) return 1;
    const words = name.split(/\s+/);
    if (words.some((w) => w.indexOf(q) === 0)) return 2;
    if (name.indexOf(q) !== -1) return 3;
    const initialsMatch = words.map((w) => w.charAt(0)).join("");
    if (initialsMatch.indexOf(q) === 0) return 4;
    return -1;
  }

  function suggestions(item) {
    const q = query.trim().toLowerCase();
    const chosen = new Set(pending);
    if (!q) {
      const out = [];
      for (const guess of item.guesses) {
        if (!guess.slug || chosen.has(guess.slug)) continue;
        const person = rosterBySlug.get(guess.slug);
        if (person) out.push({ person: person, hint: guess.source + (guess.confidence ? " / " + guess.confidence : "") });
      }
      for (const tagged of item.catalogPeople) {
        if (chosen.has(tagged.slug) || out.some((o) => o.person.slug === tagged.slug)) continue;
        const person = rosterBySlug.get(tagged.slug);
        if (person) out.push({ person: person, hint: "already on this photo" });
      }
      if (out.length < 8) {
        for (const person of recentPeople()) {
          if (chosen.has(person.slug) || out.some((o) => o.person.slug === person.slug)) continue;
          out.push({ person: person, hint: "recent" });
          if (out.length >= 8) break;
        }
      }
      return out.slice(0, 9);
    }
    const scored = [];
    for (const person of roster) {
      if (chosen.has(person.slug)) continue;
      const rank = scoreName(person, q);
      if (rank < 0) continue;
      scored.push({ person: person, rank: rank });
    }
    scored.sort((a, b) => a.rank - b.rank || b.person.photoCount - a.person.photoCount || a.person.name.localeCompare(b.person.name));
    return scored.slice(0, 9).map((s) => ({ person: s.person, hint: s.person.photoCount + " photos" }));
  }

  function recentPeople() {
    const seen = [];
    for (let i = undoStack.length - 1; i >= 0 && seen.length < 8; i -= 1) {
      for (const slug of undoStack[i].slugs || []) {
        const person = rosterBySlug.get(slug);
        if (person && !seen.some((p) => p.slug === slug)) seen.push(person);
      }
    }
    return seen;
  }

  // ---------- rendering ----------

  function renderStage(item) {
    const crop = item.tightCrop ? (zoom === "tight" ? item.tightCrop : zoom === "wide" ? item.wideCrop : null) : null;
    applyCrop(els.faceView, item, crop);

    els.contextWrap.innerHTML = "";
    const img = document.createElement("img");
    img.src = item.photoUrl;
    img.alt = "";
    img.decoding = "async";
    els.contextWrap.append(img);
    if (item.box) {
      const marker = document.createElement("div");
      marker.className = "marker";
      marker.style.left = (item.box.x * 100).toFixed(3) + "%";
      marker.style.top = (item.box.y * 100).toFixed(3) + "%";
      marker.style.width = (item.box.width * 100).toFixed(3) + "%";
      marker.style.height = (item.box.height * 100).toFixed(3) + "%";
      els.contextWrap.append(marker);
    }
    for (const other of item.otherFaces.slice(0, 24)) {
      const marker = document.createElement("div");
      marker.className = "marker other";
      marker.style.left = (other.box.x * 100).toFixed(3) + "%";
      marker.style.top = (other.box.y * 100).toFixed(3) + "%";
      marker.style.width = (other.box.width * 100).toFixed(3) + "%";
      marker.style.height = (other.box.height * 100).toFixed(3) + "%";
      els.contextWrap.append(marker);
    }

    els.zoomLabel.textContent = item.tightCrop
      ? (zoom === "tight" ? "Tight face" : zoom === "wide" ? "Face and context" : "Whole photo")
      : "Whole photo (no face box in this row)";
  }

  function renderGroup(item) {
    const keys = item.groupId ? groupKeys.get(item.groupId) : null;
    els.groupStrip.hidden = !keys;
    if (!keys) return;
    const openCount = keys.filter((k) => k !== item.key && !isResolved(itemByKey.get(k))).length;
    els.groupLabel.innerHTML =
      "Looks like the same face in " + keys.length + " photos &middot; " +
      openCount + " still open &middot; check every crop before using " +
      "<kbd>a</kbd>";
    els.groupRow.innerHTML = "";
    for (const key of keys) {
      const member = itemByKey.get(key);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "groupFace" + (key === item.key ? " current" : "") + (isResolved(member) ? " done" : "");
      button.title = member.catalogPath;
      const inner = document.createElement("span");
      inner.style.position = "absolute";
      inner.style.inset = "0";
      inner.style.overflow = "hidden";
      const img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = "";
      img.src = member.thumbUrl;
      if (member.tightCrop) Object.assign(img.style, cropStyle(member.tightCrop, member.aspectRatio));
      else { img.style.width = "100%"; img.style.height = "100%"; img.style.objectFit = "cover"; }
      inner.append(img);
      const badge = document.createElement("span");
      badge.className = "badge";
      const r = record(member);
      badge.textContent = r && r.action === "tag"
        ? ((rosterBySlug.get((r.personSlugs || [])[0]) || {}).name || "tagged").split(" ")[0]
        : member.event;
      button.append(inner, badge);
      button.addEventListener("click", () => goToKey(key));
      els.groupRow.append(button);
    }
  }

  function renderChips() {
    els.chips.innerHTML = "";
    els.chips.hidden = pending.length === 0;
    for (const slug of pending) {
      const person = rosterBySlug.get(slug);
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.append(document.createTextNode(person ? person.name : slug));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Remove";
      remove.addEventListener("click", () => {
        pending = pending.filter((s) => s !== slug);
        render();
      });
      chip.append(remove);
      els.chips.append(chip);
    }
    els.chips.hidden = false;
  }

  function renderOptions(item) {
    const list = suggestions(item);
    highlight = Math.min(highlight, Math.max(0, list.length - 1));
    els.options.innerHTML = "";
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "metaNote";
      empty.textContent = query.trim()
        ? "No roster name matches that. Press Enter on a typed name only if you mean to add someone new."
        : "Start typing a name.";
      els.options.append(empty);
      return list;
    }
    list.forEach((entry, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option" + (index === highlight ? " highlight" : "");
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(index + 1);
      const thumb = document.createElement("span");
      thumb.className = "thumb";
      if (entry.person.faceUrl) {
        const img = document.createElement("img");
        img.src = entry.person.faceUrl;
        img.loading = "lazy";
        img.alt = "";
        thumb.append(img);
      } else {
        thumb.textContent = initials(entry.person.name);
      }
      const name = document.createElement("span");
      name.textContent = entry.person.name;
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = entry.hint || "";
      button.append(num, thumb, name, hint);
      button.addEventListener("mouseenter", () => { highlight = index; paintHighlight(); });
      button.addEventListener("click", () => choose(index));
      els.options.append(button);
    });
    return list;
  }

  function paintHighlight() {
    const buttons = els.options.querySelectorAll(".option");
    buttons.forEach((button, index) => button.classList.toggle("highlight", index === highlight));
  }

  function renderReference() {
    const slug = pending.length ? pending[pending.length - 1] : null;
    const person = slug ? rosterBySlug.get(slug) : null;
    els.reference.hidden = !person;
    if (!person) return;
    els.referenceName.textContent = "Saved faces for " + person.name;
    els.referenceGrid.innerHTML = "";
    const urls = [];
    if (person.faceUrl) urls.push(person.faceUrl);
    for (const url of person.cropUrls) if (urls.length < 5) urls.push(url);
    if (!urls.length) {
      const note = document.createElement("p");
      note.className = "metaNote";
      note.textContent = "No saved face for this attendee yet. Use your own recognition.";
      els.referenceGrid.append(note);
      return;
    }
    for (const url of urls) {
      const img = document.createElement("img");
      img.src = url;
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = "";
      els.referenceGrid.append(img);
    }
  }

  function renderProgress() {
    let resolved = 0;
    let skippedCount = 0;
    for (const item of items) {
      if (isResolved(item)) resolved += 1;
      else if (statusOf(item) === "skipped") skippedCount += 1;
    }
    const percent = items.length ? (resolved / items.length) * 100 : 0;
    els.railFill.style.width = percent.toFixed(2) + "%";
    els.doneValue.textContent = resolved + " / " + items.length;
    els.openValue.textContent = String(items.length - resolved - skippedCount);
    els.skipValue.textContent = String(skippedCount);
    const minutes = (Date.now() - sessionStart) / 60000;
    els.rateValue.textContent = sessionDone && minutes > 0.2
      ? (sessionDone / minutes).toFixed(1) + "/min"
      : String(sessionDone);
    const decided = countDecisions();
    els.exportButton.disabled = decided === 0;
    els.exportButton.textContent = decided ? "Export " + decided + " decisions" : "Export decisions";
  }

  function render() {
    for (const button of document.querySelectorAll("[data-mode]")) {
      button.classList.toggle("active", button.dataset.mode === mode);
    }
    const item = current();
    els.layout.hidden = !item;
    els.empty.classList.toggle("visible", !item);
    renderProgress();
    if (!item) {
      els.counter.textContent = "0 of 0";
      return;
    }
    const list = visible();
    els.counter.textContent = (currentIndex + 1) + " of " + list.length;

    const r = record(item);
    els.kindPill.textContent = item.kind === "partial" ? "Extra face" : "Untagged photo";
    els.kindPill.className = "pill" + (item.kind === "partial" ? " partial" : "");
    const status = statusOf(item);
    els.statusPill.hidden = status === "open";
    els.statusPill.className = "pill " + (status === "tagged" ? "done" : status === "skipped" ? "skip" : "none");
    els.statusPill.textContent =
      status === "tagged"
        ? "Named " + (r.personSlugs || []).map((s) => (rosterBySlug.get(s) || {}).name || s).join(", ")
        : status === "not-a-guest"
        ? "Not a guest"
        : status === "removed"
        ? "Tag removed"
        : status === "skipped"
        ? "Skipped"
        : "";

    els.metaPath.textContent = item.catalogPath + (item.faceLabel !== "full" ? "  (face " + item.faceLabel + ")" : "");
    els.metaNote.textContent = item.notes || "";
    els.metaNote.hidden = !item.notes;
    const tagged = item.existingPeople.length ? item.existingPeople : item.catalogPeople;
    els.metaTagged.textContent = tagged.length ? "Already tagged: " + tagged.map((p) => p.name).join(", ") : "";
    els.metaTagged.hidden = tagged.length === 0;
    els.removeButton.hidden = tagged.length === 0;
    els.openOriginal.href = item.sourceUrl;

    renderStage(item);
    renderGroup(item);
    renderChips();
    renderOptions(item);
    renderReference();

    els.noteInput.value = r && r.note ? r.note : "";
    els.applyGroup.hidden = !item.groupId;
    prefetch(list);
  }

  const prefetched = new Set();
  function prefetch(list) {
    for (let offset = 1; offset <= 3; offset += 1) {
      const next = list[currentIndex + offset];
      if (!next || prefetched.has(next.photoUrl)) continue;
      prefetched.add(next.photoUrl);
      const img = new Image();
      img.decoding = "async";
      img.src = next.photoUrl;
    }
  }

  // ---------- decisions ----------

  function countDecisions() {
    let total = 0;
    for (const [, value] of state) {
      if (value.imported) continue;
      if (value.action === "tag" || value.action === "not-a-guest" || value.action === "remove") total += 1;
    }
    return total;
  }

  function commit(keys, value, label) {
    const before = keys.map((key) => [key, state.get(key) ? Object.assign({}, state.get(key)) : null]);
    for (const key of keys) state.set(key, Object.assign({}, value));
    undoStack.push({ before: before, slugs: value.personSlugs || [] });
    if (undoStack.length > 60) undoStack.shift();
    sessionDone += keys.length;
    save();
    els.undoButton.disabled = false;
    if (label) toast(label);
  }

  function undo() {
    const last = undoStack.pop();
    if (!last) return toast("Nothing to undo");
    for (const [key, value] of last.before) {
      if (value) state.set(key, value);
      else state.delete(key);
    }
    sessionDone = Math.max(0, sessionDone - last.before.length);
    save();
    els.undoButton.disabled = undoStack.length === 0;
    currentKey = last.before[0][0];
    setQuery("");
    pending = [];
    render();
    toast("Undone");
  }

  function advance() {
    const list = visible();
    const index = list.findIndex((i) => i.key === currentKey);
    const next = list[index + 1] || list[index] || list[0];
    if (mode === "open") {
      const stillOpen = list.find((i) => i.key !== currentKey || !isResolved(i));
      currentKey = (list.find((i) => !isResolved(i) && statusOf(i) !== "skipped") || next || {}).key || "";
    } else {
      currentKey = next ? next.key : "";
    }
    setQuery("");
    pending = [];
    highlight = 0;
    render();
  }

  function saveCurrent(alsoGroup) {
    const item = current();
    if (!item) return;
    if (!pending.length) {
      toast("Pick a name first");
      els.combo.focus();
      return;
    }
    const value = { action: "tag", personSlugs: pending.slice(), note: els.noteInput.value.trim() };
    const keys = [item.key];
    if (alsoGroup && item.groupId) {
      for (const key of groupKeys.get(item.groupId)) {
        if (key === item.key) continue;
        if (isResolved(itemByKey.get(key))) continue;
        keys.push(key);
      }
    }
    const names = pending.map((s) => (rosterBySlug.get(s) || {}).name || s).join(", ");
    commit(keys, value, keys.length > 1 ? names + " on " + keys.length + " photos" : names);
    advance();
  }

  function markNotGuest() {
    const item = current();
    if (!item) return;
    commit([item.key], { action: "not-a-guest", personSlugs: [], note: els.noteInput.value.trim() }, "Not a guest");
    advance();
  }

  function markSkip() {
    const item = current();
    if (!item) return;
    commit([item.key], { action: "skip", personSlugs: [], note: els.noteInput.value.trim() }, "Skipped for later");
    advance();
  }

  function markRemove() {
    const item = current();
    if (!item) return;
    const tagged = item.existingPeople.length ? item.existingPeople : item.catalogPeople;
    if (!tagged.length) return;
    const slugs = tagged.filter((p) => p.slug).map((p) => p.slug);
    if (!slugs.length) return toast("That tag has no roster slug to remove");
    const reason = window.prompt(
      "Removing " + tagged.map((p) => p.name).join(", ") + " from " + item.catalogPath +
        ".\nWrite the reason (at least 20 characters). It is stored with the removal.",
      els.noteInput.value.trim()
    );
    if (reason === null) return;
    if (reason.trim().length < 20) return toast("A removal needs a written reason");
    commit([item.key], { action: "remove", personSlugs: slugs, note: reason.trim() }, "Removal recorded");
    advance();
  }

  function reopen() {
    const item = current();
    if (!item) return;
    commit([item.key], { action: "open", personSlugs: [], note: "" }, "Reopened");
    state.delete(item.key);
    save();
    render();
  }

  function choose(index) {
    const item = current();
    if (!item) return;
    const list = suggestions(item);
    const entry = list[index];
    if (!entry) return;
    if (!pending.includes(entry.person.slug)) pending.push(entry.person.slug);
    setQuery("");
    highlight = 0;
    render();
  }

  function acceptTyped() {
    const item = current();
    if (!item) return false;
    const list = suggestions(item);
    if (list.length) {
      choose(highlight);
      return true;
    }
    return false;
  }

  function goToKey(key) {
    currentKey = key;
    setQuery("");
    pending = [];
    render();
  }

  function step(delta) {
    const list = visible();
    if (!list.length) return;
    const index = list.findIndex((i) => i.key === currentKey);
    const next = list[Math.max(0, Math.min(list.length - 1, (index < 0 ? 0 : index) + delta))];
    if (next) goToKey(next.key);
  }

  function setQuery(value) {
    query = value;
    els.combo.value = value;
  }

  function cycleZoom(delta) {
    const order = ["tight", "wide", "full"];
    const index = order.indexOf(zoom);
    zoom = order[(index + (delta > 0 ? 1 : order.length - 1)) % order.length];
    save();
    const item = current();
    if (item) renderStage(item);
  }

  function setMode(next) {
    mode = next;
    currentIndex = 0;
    currentKey = "";
    save();
    render();
  }

  // ---------- export ----------

  function buildExport() {
    const decisions = [];
    for (const item of items) {
      const value = state.get(item.key);
      if (!value || value.imported) continue;
      if (value.action === "open") continue;
      decisions.push({
        key: item.key,
        action: value.action,
        personSlugs: value.personSlugs || [],
        note: value.note || ""
      });
    }
    return {
      schemaVersion: 1,
      tool: "naming-tool",
      buildFingerprint: model.buildFingerprint,
      exportedAt: new Date().toISOString(),
      decisions: decisions
    };
  }

  function download() {
    const payload = buildExport();
    if (!payload.decisions.length) return toast("Nothing to export yet");
    const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rachandzach-naming-decisions.json";
    link.click();
    URL.revokeObjectURL(url);
    toast("Downloaded " + payload.decisions.length + " decisions");
  }

  function restore(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let payload = null;
      try { payload = JSON.parse(String(reader.result)); } catch (error) { payload = null; }
      if (!payload || payload.schemaVersion !== 1 || payload.buildFingerprint !== model.buildFingerprint) {
        return toast("That file does not match this build");
      }
      let applied = 0;
      for (const decision of payload.decisions || []) {
        if (!itemByKey.has(decision.key)) continue;
        state.set(decision.key, {
          action: decision.action,
          personSlugs: decision.personSlugs || [],
          note: decision.note || ""
        });
        applied += 1;
      }
      save();
      render();
      toast("Restored " + applied + " decisions");
    };
    reader.readAsText(file);
  }

  // ---------- keyboard ----------

  const typing = () => document.activeElement === els.combo || document.activeElement === els.noteInput;

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey) {
      if (event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
      return;
    }
    if (els.drawer.classList.contains("open") || els.help.classList.contains("open")) {
      if (event.key === "Escape") {
        event.preventDefault();
        els.drawer.classList.remove("open");
        els.help.classList.remove("open");
      }
      return;
    }
    if (document.activeElement === els.noteInput) {
      if (event.key === "Escape") { event.preventDefault(); els.noteInput.blur(); }
      return;
    }

    const key = event.key;

    // Keys that work whether or not the name box has focus. None of them can
    // appear inside a person's name.
    if (key === "Enter") {
      event.preventDefault();
      if (query.trim() && acceptTyped()) {
        if (event.shiftKey) return;
      }
      saveCurrent(event.shiftKey);
      return;
    }
    if (key === "ArrowDown") { event.preventDefault(); highlight += 1; renderOptions(current()); return; }
    if (key === "ArrowUp") { event.preventDefault(); highlight = Math.max(0, highlight - 1); renderOptions(current()); return; }
    if (key === "Tab") { event.preventDefault(); step(event.shiftKey ? -1 : 1); return; }
    if (key === "Escape") {
      event.preventDefault();
      if (query) { setQuery(""); highlight = 0; render(); }
      else if (pending.length) { pending = []; render(); }
      else els.combo.blur();
      return;
    }
    if (key === "[") { event.preventDefault(); step(-1); return; }
    if (key === "]") { event.preventDefault(); step(1); return; }
    if (key === "-" || key === "_") { event.preventDefault(); cycleZoom(-1); return; }
    if (key === "=" || key === "+") { event.preventDefault(); cycleZoom(1); return; }
    if (key === "\\") { event.preventDefault(); saveCurrent(true); return; }
    if (key === "`") { event.preventDefault(); markNotGuest(); return; }
    if (key === ";") { event.preventDefault(); markSkip(); return; }
    if (key === "?") { event.preventDefault(); els.help.classList.add("open"); return; }
    if (key >= "1" && key <= "9") { event.preventDefault(); choose(Number(key) - 1); return; }

    if (typing()) return;

    // Command mode: single letters, available the moment an item is saved.
    const lower = key.toLowerCase();
    if (lower === "x") { event.preventDefault(); markNotGuest(); return; }
    if (lower === "s") { event.preventDefault(); markSkip(); return; }
    if (lower === "a") { event.preventDefault(); saveCurrent(true); return; }
    if (lower === "z") { event.preventDefault(); cycleZoom(1); return; }
    if (lower === "p") { event.preventDefault(); openRoster(); return; }
    if (lower === "r") { event.preventDefault(); markRemove(); return; }
    if (lower === "o") { event.preventDefault(); reopen(); return; }
    if (lower === "n") { event.preventDefault(); els.noteInput.focus(); return; }
    if (lower === "u") { event.preventDefault(); undo(); return; }
    if (key === "/") { event.preventDefault(); els.filter.focus(); return; }
    if (/^[a-z]$/.test(lower)) {
      els.combo.focus();
      setQuery(key);
      highlight = 0;
      renderOptions(current());
      event.preventDefault();
    }
  });

  els.combo.addEventListener("input", () => {
    query = els.combo.value;
    highlight = 0;
    renderOptions(current());
  });

  // ---------- roster drawer ----------

  function openRoster() {
    els.drawer.classList.add("open");
    els.rosterFilter.value = "";
    paintRoster("");
    els.rosterFilter.focus();
  }

  function paintRoster(filter) {
    const q = filter.trim().toLowerCase();
    els.rosterGrid.innerHTML = "";
    const list = roster.filter((p) => !q || p.name.toLowerCase().indexOf(q) !== -1);
    for (const person of list) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "rosterCard";
      const face = document.createElement("span");
      face.className = "face";
      if (person.faceUrl) {
        const img = document.createElement("img");
        img.src = person.faceUrl;
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = "";
        face.append(img);
      } else {
        face.textContent = initials(person.name);
      }
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = person.name;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = person.photoCount + " photos";
      card.append(face, name, count);
      card.addEventListener("click", () => {
        if (!pending.includes(person.slug)) pending.push(person.slug);
        els.drawer.classList.remove("open");
        render();
      });
      els.rosterGrid.append(card);
    }
    els.rosterCount.textContent = list.length + " of " + roster.length;
  }

  els.rosterFilter.addEventListener("input", () => paintRoster(els.rosterFilter.value));
  els.drawer.addEventListener("click", (event) => {
    if (event.target === els.drawer) els.drawer.classList.remove("open");
  });
  els.help.addEventListener("click", (event) => {
    if (event.target === els.help) els.help.classList.remove("open");
  });

  // ---------- wiring ----------

  els.filter.addEventListener("input", () => { currentKey = ""; currentIndex = 0; render(); });
  els.filter.addEventListener("keydown", (event) => { if (event.key === "Escape") { els.filter.value = ""; els.filter.blur(); render(); } });
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }
  els.saveButton.addEventListener("click", () => saveCurrent(false));
  els.applyGroup.addEventListener("click", () => saveCurrent(true));
  els.notGuest.addEventListener("click", markNotGuest);
  els.skipButton.addEventListener("click", markSkip);
  els.removeButton.addEventListener("click", markRemove);
  els.undoButton.addEventListener("click", undo);
  els.prevButton.addEventListener("click", () => step(-1));
  els.nextButton.addEventListener("click", () => step(1));
  els.zoomButton.addEventListener("click", () => cycleZoom(1));
  els.rosterButton.addEventListener("click", openRoster);
  els.helpButton.addEventListener("click", () => els.help.classList.add("open"));
  els.exportButton.addEventListener("click", download);
  els.restoreButton.addEventListener("click", () => els.restoreFile.click());
  els.restoreFile.addEventListener("change", () => {
    if (els.restoreFile.files && els.restoreFile.files[0]) restore(els.restoreFile.files[0]);
    els.restoreFile.value = "";
  });
  els.noteInput.addEventListener("change", () => {
    const item = current();
    if (!item) return;
    const value = state.get(item.key);
    if (!value) return;
    value.note = els.noteInput.value.trim();
    state.set(item.key, value);
    save();
  });

  els.undoButton.disabled = true;
  render();
  if (model.counts.priorDecisions) {
    toast(model.counts.priorDecisions + " decisions already imported are marked done");
  }
})();
`;

function renderHtml(model) {
  const shortcuts = [
    ["a–z", "start typing a name"],
    ["1 … 9", "pick that suggestion"],
    ["↑ ↓", "move the highlight"],
    ["Enter", "take the highlighted name, then save and go next"],
    ["Shift+Enter", "save and apply to the whole look-alike group"],
    ["\\", "apply to the whole look-alike group"],
    ["x  or  `", "not a guest / background face"],
    ["s  or  ;", "skip for later"],
    ["r", "remove a wrong tag already on the photo"],
    ["o", "reopen this item"],
    ["n", "write a note"],
    ["z  /  -  =", "cycle tight face, context, whole photo"],
    ["p", "open the roster with saved faces"],
    ["Tab / [ ]", "previous and next item"],
    ["u  or  ⌘Z", "undo the last decision"],
    ["Esc", "clear the typed name, then the picked names"],
    ["/", "filter the queue"],
    ["?", "this help"],
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Name the faces &middot; Rachel &amp; Zach</title>
  <style>${css}</style>
</head>
<body>
  <header>
    <div class="topbar">
      <div>
        <div class="kicker">Local face naming &middot; nothing leaves this Mac</div>
        <h1>Name the faces</h1>
      </div>
      <div class="headStats">
        <div class="stat"><div class="statValue" id="doneValue">0</div><div class="statLabel">Resolved</div></div>
        <div class="stat"><div class="statValue" id="openValue">0</div><div class="statLabel">Open</div></div>
        <div class="stat"><div class="statValue" id="skipValue">0</div><div class="statLabel">Skipped</div></div>
        <div class="stat"><div class="statValue" id="rateValue">0</div><div class="statLabel">This session</div></div>
      </div>
    </div>
    <div class="rail"><div class="railFill" id="railFill"></div></div>
    <div class="toolbar">
      <button type="button" data-mode="open">Open</button>
      <button type="button" data-mode="groups">Groups</button>
      <button type="button" data-mode="skipped">Skipped</button>
      <button type="button" data-mode="done">Done</button>
      <button type="button" data-mode="all">All</button>
      <input id="filter" type="search" placeholder="Filter (/)" aria-label="Filter the queue">
      <span class="spacer"></span>
      <span class="statLabel" id="counter"></span>
      <button type="button" id="rosterButton">Roster (p)</button>
      <button type="button" id="helpButton">Keys (?)</button>
      <button type="button" id="restoreButton">Restore</button>
      <input type="file" id="restoreFile" accept="application/json" hidden>
      <button type="button" class="primary" id="exportButton" disabled>Export decisions</button>
    </div>
  </header>

  <main>
    <div class="layout" id="layout">
      <section class="panel stage">
        <div class="stageTop">
          <div class="faceView" id="faceView"></div>
          <div class="contextView"><div class="contextWrap" id="contextWrap"></div></div>
        </div>
        <div class="stageBar">
          <button type="button" class="tiny" id="zoomButton">Zoom (z)</button>
          <span id="zoomLabel"></span>
          <span class="spacer"></span>
          <a id="openOriginal" href="#" target="_blank" rel="noreferrer" class="statLabel">Open the original</a>
        </div>
        <div class="groupStrip" id="groupStrip" hidden>
          <p class="label" id="groupLabel"></p>
          <div class="groupRow" id="groupRow"></div>
        </div>
      </section>

      <aside class="panel side">
        <div class="statusRow">
          <span class="pill" id="kindPill"></span>
          <span class="pill" id="statusPill" hidden></span>
        </div>
        <div class="meta">
          <div class="metaPath" id="metaPath"></div>
          <p class="metaNote" id="metaTagged"></p>
          <p class="metaNote" id="metaNote"></p>
        </div>

        <div class="comboWrap">
          <p class="label">Who is this?</p>
          <input class="comboInput" id="combo" type="text" autocomplete="off" spellcheck="false"
                 placeholder="Type a name, then Enter">
          <div class="chips" id="chips"></div>
          <div class="options" id="options"></div>
        </div>

        <details class="reference" id="reference" hidden>
          <summary id="referenceName">Saved faces</summary>
          <div class="referenceGrid" id="referenceGrid"></div>
        </details>

        <textarea class="noteInput" id="noteInput" rows="1" placeholder="Note (n)"></textarea>

        <div class="actions">
          <button type="button" class="primary wide" id="saveButton">Save &amp; next &nbsp;<kbd>Enter</kbd></button>
          <button type="button" class="wide" id="applyGroup" hidden>Apply to the whole group &nbsp;<kbd>\\</kbd></button>
          <button type="button" class="warn" id="notGuest">Not a guest <kbd>x</kbd></button>
          <button type="button" id="skipButton">Skip <kbd>s</kbd></button>
          <button type="button" class="warn" id="removeButton" hidden>Remove wrong tag <kbd>r</kbd></button>
          <button type="button" id="undoButton">Undo <kbd>u</kbd></button>
          <button type="button" id="prevButton">Previous</button>
          <button type="button" id="nextButton">Next</button>
        </div>
      </aside>
    </div>
    <div class="empty" id="empty">Nothing left in this view. Switch to All or Skipped, or export what you have.</div>
  </main>

  <div class="drawer" id="drawer">
    <div class="drawerCard">
      <div class="topbar">
        <div>
          <div class="kicker">Wedding roster</div>
          <strong id="rosterCount"></strong>
        </div>
        <input id="rosterFilter" type="search" placeholder="Filter names" aria-label="Filter the roster">
      </div>
      <div class="rosterGrid" id="rosterGrid"></div>
    </div>
  </div>

  <div class="drawer" id="help">
    <div class="drawerCard">
      <div class="topbar">
        <div>
          <div class="kicker">Keyboard</div>
          <strong>Hands stay on the keyboard</strong>
        </div>
        <span class="statLabel">Esc closes</span>
      </div>
      <div class="helpGrid">
        ${shortcuts
          .map(
            ([keys, description]) =>
              `<div class="helpRow"><kbd>${htmlEscape(keys)}</kbd><span>${htmlEscape(
                description,
              )}</span></div>`,
          )
          .join("\n        ")}
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>
  <script type="application/json" id="model">${jsonScript(model)}</script>
  <script>${clientJs}</script>
</body>
</html>
`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
