/**
 * Model and page for the private, local face-naming session.
 *
 * Read-only on every image source. Photographs are shown from the preview
 * derivatives the import already produced under `metadata/import/`; the
 * wedding originals and the clean master are never opened here.
 *
 * Face grouping is a presentation aid only. Similar-looking faces are put side
 * by side so one person can be named once instead of six times. The page never
 * says who it thinks someone is, and every member of a group is shown so the
 * identification stays a human one.
 */

import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { join } from "node:path";

import { parseCsv } from "./photo-metadata.mjs";

// Fallback grouping thresholds, for faces the pipeline's own clusters do not
// place (those clusters are the primary stacking; see buildNamingModel). The
// signature run's calibration puts impostor P99 at 0.244 and genuine P05 at
// 0.577, so 0.5/0.4 still sits far above noise; the original 0.6/0.5 was set
// before that calibration existed and left most of the queue unstacked. A
// wrong stack is visible, not silent: every member renders on screen and can
// be answered individually.
const GROUP_EDGE = 0.5;
const GROUP_MIN_PAIR = 0.4;
const GROUP_MAX = 24;
// Room left around a detected face box, as a multiple of its longest side.
const CROP_TIGHT = 2.1;
const CROP_WIDE = 4.4;

export const SOURCE_DIR_NAME = "Rachel & Zach - Ali Beck Photography 2";

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

function encodePath(repoRelativePath) {
  return repoRelativePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
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
 * Square crop window around a normalized face box, in the terms the page
 * renders it: x/y is the top-left corner as a fraction of the whole image and
 * size is the side length as a fraction of the image's shorter edge.
 */
function cropWindow(box, aspectRatio, padding) {
  const width = aspectRatio >= 1 ? aspectRatio : 1;
  const height = aspectRatio >= 1 ? 1 : 1 / aspectRatio;
  const side = Math.min(
    Math.max(box.width * width, box.height * height) * padding,
    Math.min(width, height),
  );
  const centerX = (box.x + box.width / 2) * width;
  const centerY = (box.y + box.height / 2) * height;
  return {
    x: round(clamp(centerX - side / 2, 0, width - side) / width),
    y: round(clamp(centerY - side / 2, 0, height - side) / height),
    size: round(side),
  };
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
  if (filename === "manual-confirmed-matches.csv") return "earlier note";
  return "earlier review";
}

async function readSuggestionRows(reviewDir) {
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
    for (const row of await readCsvFile(join(reviewDir, file))) {
      if (!row.path || row.recommendation !== "replace" || !row.people) continue;
      for (const person of splitPeople(row.people)) {
        rows.push({ path: row.path, person, source: suggestionSourceName(file) });
      }
    }
  }
  return rows;
}

async function readDetections(detectionsFile) {
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
 * face_index no longer lines up with the detector's ordering. Geometry does.
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
  return bestScore >= 0.2 && best ? { face: best, iou: bestScore } : null;
}

/** Average-link agglomerative grouping over the reviewed faces only. */
function groupFaces(entries) {
  const clusters = entries.map((entry) => ({ members: [entry] }));
  for (;;) {
    let bestPair = null;
    let bestScore = GROUP_EDGE;
    for (let a = 0; a < clusters.length; a += 1) {
      for (let b = a + 1; b < clusters.length; b += 1) {
        if (clusters[a].members.length + clusters[b].members.length > GROUP_MAX) continue;
        let total = 0;
        let weakest = 1;
        for (const left of clusters[a].members) {
          for (const right of clusters[b].members) {
            const score = cosine(left.embedding, right.embedding);
            total += score;
            if (score < weakest) weakest = score;
          }
        }
        if (weakest < GROUP_MIN_PAIR) continue;
        const average = total / (clusters[a].members.length * clusters[b].members.length);
        if (average > bestScore) {
          bestScore = average;
          bestPair = [a, b];
        }
      }
    }
    if (!bestPair) break;
    clusters[bestPair[0]].members.push(...clusters[bestPair[1]].members);
    clusters.splice(bestPair[1], 1);
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

/**
 * Build everything the page needs. Pure with respect to the repository: it
 * only reads.
 *
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {string} options.assetBase prefix the page puts in front of every
 *   repo-relative asset path ("/" when served, "../../" for a static file).
 */
export async function buildNamingModel({ repoRoot, assetBase = "/", readOnly = false }) {
  const reviewDir = join(repoRoot, "metadata", "identity-review");
  const derivativesRoot = join(repoRoot, "metadata", "import", "derivatives", "previews");
  const committedFacesRoot = join(repoRoot, "public", "faces");

  const [
    queueRows,
    unresolvedRows,
    partialRows,
    referenceCropRows,
    suggestionRows,
    catalog,
    attendees,
    detections,
    ledger,
  ] = await Promise.all([
    readCsvFile(join(repoRoot, "metadata", "sorted", "unconfirmed-review-queue.csv")),
    readCsvFile(join(reviewDir, "unresolved-crops.csv")),
    readCsvFile(join(reviewDir, "partial-crops.csv")),
    readCsvFile(join(reviewDir, "reference-crops.csv")),
    readSuggestionRows(reviewDir),
    readJsonFile(join(repoRoot, "src", "generated", "gallery-v2.json")),
    readJsonFile(join(repoRoot, "metadata", "wedding-attendees.json"), { attendees: [] }),
    readDetections(join(repoRoot, "metadata", "faces", "detections.jsonl")),
    readJsonFile(join(reviewDir, "naming-decisions.json"), { schemaVersion: 1, entries: {} }),
  ]);

  if (!Array.isArray(catalog?.photos) || !Array.isArray(catalog?.people)) {
    throw new Error("Naming tool: src/generated/gallery-v2.json is missing photos or people");
  }

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

  // Everyone the catalog knows plus every seated attendee, so a face can be
  // named even when that person has no photographs yet.
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
      return {
        slug: person.slug,
        name: person.name,
        photoCount: person.photoCount,
        faceUrl: existsSync(faceFile) ? encodePath("public/faces/" + person.slug + ".webp") : null,
        cropUrls: (cropsByPerson.get(person.name) || []).map(encodePath),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "en-US"));

  const rosterByName = new Map(roster.map((person) => [person.name.toLowerCase(), person]));
  const rosterFinal = new Map(roster.map((person) => [person.slug, person]));
  const resolvePerson = (name) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) return null;
    return rosterByName.get(trimmed.toLowerCase()) || rosterFinal.get(slugify(trimmed)) || null;
  };

  const suggestionsByPath = new Map();
  for (const row of suggestionRows) {
    const person = resolvePerson(row.person);
    if (!person) continue;
    const list = suggestionsByPath.get(row.path) || [];
    if (list.some((item) => item.slug === person.slug)) continue;
    list.push({ slug: person.slug, source: row.source });
    suggestionsByPath.set(row.path, list);
  }

  const queueByPath = new Map(queueRows.map((row) => [row.path, row]));
  const uncatalogued = new Set();
  let undisplayable = 0;

  function derivativeUrl(photoId, preferred) {
    for (const filename of preferred) {
      if (existsSync(join(derivativesRoot, photoId, filename))) {
        return encodePath("metadata/import/derivatives/previews/" + photoId + "/" + filename);
      }
    }
    return null;
  }

  function buildItem(row, kind) {
    const photo = photoByReviewPath.get(row.path);
    if (!photo) {
      uncatalogued.add(row.path);
      return null;
    }
    const photoUrl =
      derivativeUrl(photo.imageDataHash, ["1600.webp", "960.webp", "2400.jpeg"]) ||
      (row.crop ? encodePath(row.crop) : null);
    if (!photoUrl) {
      undisplayable += 1;
      return null;
    }
    const box = boxFromRow(row);
    const detection = detectionByReviewPath.get(row.path);
    const match = matchDetection(detection, box);
    const aspectRatio = photo.width && photo.height ? photo.width / photo.height : 1;
    const faceLabel = row.face_index || "full";
    const existing = splitPeople(row.existing_people)
      .map((name) => resolvePerson(name))
      .filter(Boolean);
    const catalogPeople = (photo.peopleSlugs || [])
      .map((slug) => rosterFinal.get(slug))
      .filter(Boolean);
    const known = existing.length ? existing : catalogPeople;
    return {
      key: kind + ":" + row.path + ":" + faceLabel,
      kind,
      path: row.path,
      catalogPath: photo.originalRelativePath,
      photoId: photo.imageDataHash,
      event: (photo.eventSlug || "").replace(/-/g, " "),
      filename: row.path.split("/").pop() || "",
      faceLabel,
      faceIndex: match ? match.face.i : null,
      scope: box ? "face" : "photo",
      photoUrl,
      thumbUrl: derivativeUrl(photo.imageDataHash, ["480.webp", "960.webp"]) || photoUrl,
      originalUrl: "/original/" + encodePath(row.path),
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
      fallbackCropUrl: row.crop ? encodePath(row.crop) : null,
      otherFaces: (detection?.faces || [])
        .filter((face) => !match || face.i !== match.face.i)
        .slice(0, 24)
        .map((face) => ({
          x: round(face.bbox[0] / detection.dw),
          y: round(face.bbox[1] / detection.dh),
          width: round((face.bbox[2] - face.bbox[0]) / detection.dw),
          height: round((face.bbox[3] - face.bbox[1]) / detection.dh),
        })),
      knownPeople: known.map((person) => ({ slug: person.slug, name: person.name })),
      notes: row.notes || queueByPath.get(row.path)?.notes || "",
      suggestions: suggestionsByPath.get(row.path) || [],
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

  // Stacks. Primary source: the pipeline's own unresolved clusters
  // (build-face-signatures.py), which cluster the WHOLE archive's detections
  // and are calibrated against 5,000+ confirmed tags, so they stack far more
  // of the queue than the conservative in-tool grouper ever could. Faces the
  // pipeline did not cluster fall back to that grouper, unchanged. Decisions
  // survive re-stacking either way: the ledger keys on the face, not the
  // stack, and the fingerprint does not cover grouping.
  const clusterOfFace = new Map();
  const signaturesPath = join(repoRoot, "metadata", "faces", "signatures.json");
  if (existsSync(signaturesPath)) {
    const signatures = JSON.parse(await fs.readFile(signaturesPath, "utf8"));
    for (const cluster of signatures.unresolvedClusters ?? []) {
      for (const member of cluster.members ?? []) {
        clusterOfFace.set(member.photoId + ":" + member.faceIndex, cluster.clusterId);
      }
    }
  }

  // Synthetic queue items: every unresolved-cluster face the June CSVs never
  // queued. The pipeline clusters the whole archive, so most cluster members
  // have no CSV row at all; without this they were reachable only through a
  // separate export/import tool. Keys are "cluster:" + catalogPath + ":" +
  // detector faceIndex - a namespace no CSV key can produce (CSV keys start
  // with "missing:" or "partial:" and use review-style paths), and stable
  // across rebuilds because both parts come from the committed catalog and the
  // detector run, not from queue ordering. The decisions ledger depends on
  // that stability.
  const photoById = new Map(catalog.photos.map((photo) => [photo.imageDataHash, photo]));
  const detectionByPhotoId = new Map();
  for (const record of detections.values()) detectionByPhotoId.set(record.photoId, record);
  // A face already reachable through a CSV row must not appear twice. CSV rows
  // resolve to detector face indexes through matchDetection, so photoId +
  // faceIndex is the identity both worlds share.
  const csvCoveredFaces = new Set(
    items
      .filter((item) => item.faceIndex !== null)
      .map((item) => item.photoId + ":" + item.faceIndex),
  );
  let fromClusters = 0;
  let fromClustersUncatalogued = 0;
  for (const [faceKey, clusterId] of clusterOfFace) {
    if (csvCoveredFaces.has(faceKey)) continue;
    const separator = faceKey.lastIndexOf(":");
    const photoId = faceKey.slice(0, separator);
    const faceIndex = Number(faceKey.slice(separator + 1));
    const photo = photoById.get(photoId);
    const detection = detectionByPhotoId.get(photoId);
    const face = detection?.faces?.find((candidate) => candidate.i === faceIndex);
    if (!photo || !face) {
      // Not in the catalog (Sneak Peek duplicates the import consolidated
      // away) or the detector record is gone. Same exclusion the CSV path
      // applies, counted separately so the report stays honest.
      fromClustersUncatalogued += 1;
      continue;
    }
    const photoUrl = derivativeUrl(photo.imageDataHash, ["1600.webp", "960.webp", "2400.jpeg"]);
    if (!photoUrl) {
      undisplayable += 1;
      continue;
    }
    const reviewPath = photo.originalRelativePath.replace(/^\d{2} /, "");
    const aspectRatio = photo.width && photo.height ? photo.width / photo.height : 1;
    const box = {
      x: face.bbox[0] / detection.dw,
      y: face.bbox[1] / detection.dh,
      width: (face.bbox[2] - face.bbox[0]) / detection.dw,
      height: (face.bbox[3] - face.bbox[1]) / detection.dh,
    };
    items.push({
      key: "cluster:" + photo.originalRelativePath + ":" + faceIndex,
      kind: "cluster",
      path: reviewPath,
      catalogPath: photo.originalRelativePath,
      photoId: photo.imageDataHash,
      event: (photo.eventSlug || "").replace(/-/g, " "),
      filename: reviewPath.split("/").pop() || "",
      faceLabel: String(faceIndex),
      faceIndex,
      scope: "face",
      photoUrl,
      thumbUrl: derivativeUrl(photo.imageDataHash, ["480.webp", "960.webp"]) || photoUrl,
      originalUrl: "/original/" + encodePath(reviewPath),
      aspectRatio: round(aspectRatio),
      box: {
        x: round(box.x),
        y: round(box.y),
        width: round(box.width),
        height: round(box.height),
      },
      tightCrop: cropWindow(box, aspectRatio, CROP_TIGHT),
      wideCrop: cropWindow(box, aspectRatio, CROP_WIDE),
      fallbackCropUrl: null,
      otherFaces: (detection.faces || [])
        .filter((candidate) => candidate.i !== faceIndex)
        .slice(0, 24)
        .map((candidate) => ({
          x: round(candidate.bbox[0] / detection.dw),
          y: round(candidate.bbox[1] / detection.dh),
          width: round((candidate.bbox[2] - candidate.bbox[0]) / detection.dw),
          height: round((candidate.bbox[3] - candidate.bbox[1]) / detection.dh),
        })),
      knownPeople: (photo.peopleSlugs || [])
        .map((slug) => rosterFinal.get(slug))
        .filter(Boolean)
        .map((person) => ({ slug: person.slug, name: person.name })),
      notes: queueByPath.get(reviewPath)?.notes || "",
      suggestions: suggestionsByPath.get(reviewPath) || [],
      // The cluster id above is this face's stack; no centroid attachment is
      // ever needed, so the embedding has no build-time job either.
      embedding: null,
      groupId: null,
    });
    fromClusters += 1;
  }

  // Cluster centroids, for queue faces the pipeline saw but did not place:
  // computed here from the members' own embeddings, since signatures.json
  // does not publish unresolved centroids. Attachment threshold 0.45 comes
  // from the build's calibration (impostor P99 = 0.244, genuine P05 = 0.577):
  // above it, two faces are overwhelmingly the same person, and every stack
  // member is shown on screen anyway, so a rare wrong attach is visible and
  // individually answerable rather than silently propagated.
  const STACK_ATTACH = 0.45;
  const embeddingOfFace = new Map();
  for (const detection of detectionByReviewPath.values()) {
    for (const face of detection.faces || []) {
      if (face.emb) {
        embeddingOfFace.set(detection.photoId + ":" + face.i, decodeEmbedding(face.emb));
      }
    }
  }
  const clusterCentroids = new Map();
  for (const [faceKey, clusterId] of clusterOfFace) {
    const embedding = embeddingOfFace.get(faceKey);
    if (!embedding) continue;
    if (!clusterCentroids.has(clusterId)) clusterCentroids.set(clusterId, []);
    clusterCentroids.get(clusterId).push(embedding);
  }
  for (const [clusterId, embeddings] of clusterCentroids) {
    const centroid = embeddings[0].map((_, index) => {
      let total = 0;
      for (const embedding of embeddings) total += embedding[index];
      return total / embeddings.length;
    });
    const norm = Math.hypot(...centroid) || 1;
    clusterCentroids.set(clusterId, centroid.map((value) => value / norm));
  }

  const stackMembers = new Map();
  const fallbackPool = [];
  for (const item of items) {
    let clusterId =
      item.faceIndex === null
        ? undefined
        : clusterOfFace.get(item.photoId + ":" + item.faceIndex);
    if (!clusterId && item.embedding) {
      let bestScore = STACK_ATTACH;
      for (const [candidateId, centroid] of clusterCentroids) {
        const score = cosine(item.embedding, centroid);
        if (score > bestScore) {
          bestScore = score;
          clusterId = candidateId;
        }
      }
    }
    if (clusterId) {
      if (!stackMembers.has(clusterId)) stackMembers.set(clusterId, []);
      stackMembers.get(clusterId).push(item.key);
    } else if (item.embedding) {
      fallbackPool.push({ key: item.key, embedding: item.embedding });
    }
  }
  let groups = [
    ...[...stackMembers.entries()]
      .filter(([, keys]) => keys.length > 1)
      .map(([clusterId, keys]) => ({ id: clusterId, keys })),
    ...groupFaces(fallbackPool),
  ].sort((left, right) => right.keys.length - left.keys.length);
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  for (const group of groups) {
    for (const key of group.keys) itemByKey.get(key).groupId = group.id;
  }

  // Quality floors: nobody should be asked to put a name to a face that is
  // too small or too blurred to recognize. Same floors the cluster report
  // uses (face fraction 0.03, Laplacian-variance focus 25, measured in
  // metadata/faces/cluster-face-quality.json); a face with no measurement is
  // judged on size alone rather than hidden. One deliberate exception: a
  // soft face KEEPS its place when it stacks with a sharp one, because
  // naming the sharp face names the whole stack, so the soft members cost
  // no extra squinting and tagging them is the point of the stack. Only
  // stacks with no recognizable member, and lone unrecognizable faces, are
  // dropped. Already-decided faces always stay.
  const QUALITY_MIN_FRAC = 0.03;
  const QUALITY_MIN_FOCUS = 25;
  const qualityByFace = new Map();
  const qualityPath = join(repoRoot, "metadata", "faces", "cluster-face-quality.json");
  if (existsSync(qualityPath)) {
    for (const entry of JSON.parse(await fs.readFile(qualityPath, "utf8"))) {
      if (entry?.faceKey) qualityByFace.set(entry.faceKey, entry);
    }
  }
  const recognizable = (item) => {
    if (item.faceIndex === null) return true;
    const detection = detectionByReviewPath.get(item.path);
    const face = detection?.faces?.find((f) => f.i === item.faceIndex);
    const frac = face
      ? (face.bbox[3] - face.bbox[1]) / Math.max(detection.dw, detection.dh)
      : null;
    if (frac !== null && frac < QUALITY_MIN_FRAC) return false;
    const measured = qualityByFace.get(item.photoId + ":" + item.faceIndex);
    if (measured && measured.focus < QUALITY_MIN_FOCUS) return false;
    return true;
  };
  const keptKeys = new Set();
  for (const item of items) {
    if (ledger?.entries?.[item.key] || recognizable(item)) keptKeys.add(item.key);
  }
  for (const group of groups) {
    if (group.keys.some((key) => keptKeys.has(key))) {
      for (const key of group.keys) keptKeys.add(key);
    }
  }
  const droppedUnrecognizable = items.length - keptKeys.size;
  const keptItems = items.filter((item) => keptKeys.has(item.key));
  items.length = 0;
  items.push(...keptItems);
  groups = groups.filter((group) => group.keys.some((key) => keptKeys.has(key)));
  // Embeddings are a build-time input only. They never reach the page.
  for (const item of items) delete item.embedding;

  // Biggest groups first: naming twelve faces at once is the cheapest work in
  // the queue, so it should be the first work offered.
  const groupOrder = new Map(groups.map((group, index) => [group.id, index]));
  items.sort((left, right) => {
    const leftGroup = left.groupId ? groupOrder.get(left.groupId) : Number.MAX_SAFE_INTEGER;
    const rightGroup = right.groupId ? groupOrder.get(right.groupId) : Number.MAX_SAFE_INTEGER;
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    const scopeDelta = Number(left.scope === "photo") - Number(right.scope === "photo");
    if (scopeDelta) return scopeDelta;
    const suggestionDelta =
      Number(right.suggestions.length > 0) - Number(left.suggestions.length > 0);
    if (suggestionDelta) return suggestionDelta;
    return (
      left.catalogPath.localeCompare(right.catalogPath) ||
      String(left.faceLabel).localeCompare(String(right.faceLabel))
    );
  });

  const buildFingerprint = fingerprint([
    "naming-tool-v3",
    ...items.map((item) => [item.key, item.photoId, item.catalogPath, item.faceIndex].join("|")),
    ...roster.map((person) => person.slug),
  ]);

  const entries = ledger?.entries && typeof ledger.entries === "object" ? ledger.entries : {};
  const decided = {};
  for (const item of items) {
    const prior = entries[item.key];
    if (!prior) continue;
    decided[item.key] = {
      action: prior.action,
      personSlugs: Array.isArray(prior.personSlugs) ? prior.personSlugs : [],
      note: prior.note || "",
      decidedAt: prior.decidedAt || "",
    };
  }

  return {
    schemaVersion: 1,
    tool: "naming-tool",
    assetBase,
    readOnly,
    buildFingerprint,
    builtAt: new Date().toISOString(),
    counts: {
      items: items.length,
      missing: items.filter((item) => item.kind === "missing").length,
      partial: items.filter((item) => item.kind === "partial").length,
      // Recounted after the quality filter, so it reflects the queue as
      // served rather than as synthesized.
      fromClusters: items.filter((item) => item.kind === "cluster").length,
      fromClustersUncatalogued,
      droppedUnrecognizable,
      groups: groups.length,
      grouped: groups.reduce((total, group) => total + group.keys.length, 0),
      roster: roster.length,
      alreadyDecided: Object.keys(decided).length,
      uncatalogued: uncatalogued.size,
      undisplayable,
    },
    groups,
    roster,
    items,
    decided,
  };
}

/* ------------------------------------------------------------------ page */

const css = String.raw`
  :root {
    color-scheme: light;
    --bg: #f4f1ea;
    --surface: #fffdf8;
    --surface-soft: #faf6ee;
    --ink: #2b241d;
    --muted: #776d61;
    --line: #ded5c7;
    --sage: #3f5a49;
    --sage-soft: #e7eee6;
    --gold: #bf9b5f;
    --danger: #8d4d3d;
    --stage: #1d1a16;
    --shadow: 0 14px 34px rgba(43, 36, 29, 0.09);
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
    min-height: 36px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--surface);
    padding: 0 12px;
    font-size: 13px;
    font-weight: 750;
    cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: var(--sage); }
  button:disabled { opacity: 0.4; cursor: default; }
  button.primary { border-color: var(--sage); background: var(--sage); color: #fffdf8; }
  button.gold { border-color: var(--gold); background: #fbf4e5; color: #6f5520; }
  button.warn { border-color: #d9b6aa; background: #fff7f4; color: var(--danger); }
  button.active { border-color: var(--sage); background: var(--sage-soft); }
  button.tiny { min-height: 26px; padding: 0 8px; font-size: 12px; font-weight: 700; }
  kbd {
    display: inline-block;
    min-width: 17px;
    margin-left: 6px;
    border: 1px solid rgba(43, 36, 29, 0.22);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 0 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    font-weight: 700;
    opacity: 0.75;
  }

  header {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
    padding: 8px 18px;
  }
  h1 { margin: 0; font-family: "Iowan Old Style", Georgia, serif; font-size: 19px; font-weight: 500; }
  .progressText { font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .progressText span { color: var(--muted); font-weight: 750; }
  .rail { flex: 1 1 160px; height: 7px; border-radius: 999px; background: #e6e0d4; overflow: hidden; min-width: 120px; }
  .railFill { width: 0%; height: 100%; background: linear-gradient(90deg, var(--sage), var(--gold)); transition: width 180ms ease; }
  .spacer { flex: 1 1 auto; }
  .headNote { color: var(--muted); font-size: 11.5px; font-weight: 750; }

  main { padding: 12px 18px 20px; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 14px; align-items: start; }
  .panel { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); box-shadow: var(--shadow); }
  .stage { padding: 12px; display: grid; gap: 10px; }
  .stageTop { display: flex; gap: 12px; align-items: stretch; }
  .faceView {
    position: relative;
    flex: 0 0 auto;
    width: min(58vh, 560px);
    aspect-ratio: 1 / 1;
    overflow: hidden;
    border-radius: 9px;
    background: var(--stage);
  }
  .faceView img { position: absolute; display: block; max-width: none; }
  .faceView.contain img { inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .contextView {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 9px;
    background: var(--stage);
  }
  .contextWrap { position: relative; display: inline-block; max-width: 100%; max-height: min(58vh, 560px); }
  .contextWrap img { display: block; max-width: 100%; max-height: min(58vh, 560px); width: auto; }
  .marker { position: absolute; border: 2px solid #f6d476; border-radius: 4px; box-shadow: 0 0 0 9999px rgba(29, 26, 22, 0.45); pointer-events: none; }
  .marker.other { border-color: rgba(255, 253, 248, 0.5); border-style: dashed; box-shadow: none; }
  .stageBar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; color: var(--muted); font-size: 12px; font-weight: 750; }

  .groupStrip { display: grid; gap: 6px; }
  .groupLabel { margin: 0; color: #6f5520; font-size: 12.5px; font-weight: 800; }
  .groupRow { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 3px; }
  .groupFace { position: relative; flex: 0 0 auto; width: 96px; height: 96px; padding: 0; overflow: hidden; border-radius: 8px; background: var(--stage); }
  .groupFace > span.inner { position: absolute; inset: 0; overflow: hidden; }
  .groupFace img { position: absolute; display: block; max-width: none; }
  .groupFace.current { outline: 3px solid var(--gold); outline-offset: -3px; }
  .groupFace .badge { position: absolute; left: 3px; bottom: 3px; border-radius: 4px; background: rgba(29, 26, 22, 0.8); padding: 1px 5px; color: #fffdf8; font-size: 10px; font-weight: 800; }
  .groupFace.done .badge { background: var(--sage); }

  .side { display: grid; gap: 10px; padding: 13px; align-content: start; }
  .pillRow { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .pill { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; }
  .pill.partial { border-color: var(--gold); background: #fbf4e5; color: #6f5520; }
  .pill.done { border-color: var(--sage); background: var(--sage-soft); color: var(--sage); }
  .pill.none { border-color: #d9b6aa; background: #fff7f4; color: var(--danger); }
  .meta { display: grid; gap: 2px; }
  .metaNote { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
  .label { margin: 0 0 4px; color: var(--muted); font-size: 10px; font-weight: 850; text-transform: uppercase; letter-spacing: 0.08em; }

  .combo { width: 100%; min-height: 46px; border: 2px solid var(--sage); border-radius: 8px; background: #fff; padding: 0 12px; font-size: 17px; font-weight: 750; }
  .combo:focus { outline: none; box-shadow: 0 0 0 3px rgba(63, 90, 73, 0.16); }
  .options { display: grid; gap: 2px; }
  .option {
    display: grid;
    grid-template-columns: 17px 38px minmax(0, 1fr) auto;
    align-items: center;
    gap: 9px;
    width: 100%;
    min-height: 44px;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    padding: 2px 6px;
    text-align: left;
    font-size: 14px;
    font-weight: 750;
  }
  .option:hover { background: var(--surface-soft); }
  .option.highlight { border-color: var(--sage); background: var(--sage-soft); }
  .option .num { color: var(--muted); font-size: 11px; font-weight: 800; text-align: center; }
  .option .thumb { width: 38px; height: 38px; border-radius: 6px; background: #e9e1d5; overflow: hidden; display: grid; place-items: center; color: var(--muted); font-size: 12px; }
  .option .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .option .who { min-width: 0; overflow-wrap: anywhere; }
  .option .hint { color: var(--muted); font-size: 11px; font-weight: 700; white-space: nowrap; max-width: 118px; overflow: hidden; text-overflow: ellipsis; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--sage); border-radius: 999px; background: var(--sage-soft); padding: 3px 5px 3px 10px; font-size: 13px; font-weight: 800; }
  .chip button { min-height: 19px; width: 19px; border: 0; border-radius: 999px; background: rgba(63, 90, 73, 0.18); padding: 0; line-height: 1; font-size: 12px; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .actions button { min-height: 42px; }
  .actions .wide { grid-column: 1 / -1; }
  .noteInput { width: 100%; min-height: 34px; border: 1px solid var(--line); border-radius: 6px; background: #fff; padding: 7px 10px; font-size: 13px; resize: vertical; }
  .savedFaces { display: flex; gap: 5px; flex-wrap: wrap; }
  .savedFaces img { width: 64px; height: 64px; object-fit: cover; border: 1px solid var(--line); border-radius: 6px; background: #e9e1d5; }

  .drawer { position: fixed; inset: 0; z-index: 20; display: none; background: rgba(43, 36, 29, 0.45); }
  .drawer.open { display: grid; place-items: center; }
  .drawerCard { width: min(1040px, 94vw); max-height: 86vh; overflow: hidden; display: grid; grid-template-rows: auto 1fr; gap: 10px; border-radius: 12px; background: var(--surface); box-shadow: 0 30px 70px rgba(43, 36, 29, 0.3); padding: 16px; }
  .drawerHead { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .drawerCard input[type="search"] { min-height: 36px; border: 1px solid var(--line); border-radius: 7px; background: #fff; padding: 0 10px; min-width: 220px; }
  .rosterGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; overflow-y: auto; padding-right: 4px; }
  .rosterCard { display: grid; gap: 4px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-soft); padding: 6px; text-align: center; }
  .rosterCard:hover { border-color: var(--sage); }
  .rosterCard .face { width: 100%; aspect-ratio: 1 / 1; border-radius: 6px; background: #e9e1d5; overflow: hidden; display: grid; place-items: center; color: var(--muted); font-size: 16px; font-weight: 800; }
  .rosterCard .face img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .rosterCard .name { font-size: 12px; font-weight: 800; line-height: 1.2; overflow-wrap: anywhere; }
  .rosterCard .count { color: var(--muted); font-size: 10px; font-weight: 800; }
  .helpGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 5px 20px; overflow-y: auto; }
  .helpRow { display: flex; align-items: baseline; gap: 9px; font-size: 13px; }
  .helpRow strong { min-width: 108px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .helpRow span { color: var(--muted); font-weight: 700; }

  .empty { display: none; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 30px; font-size: 16px; font-weight: 750; }
  .empty.visible { display: block; }
  .toast { position: fixed; left: 50%; bottom: 18px; z-index: 30; transform: translate(-50%, 12px); opacity: 0; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); box-shadow: var(--shadow); padding: 9px 18px; font-size: 13.5px; font-weight: 800; pointer-events: none; transition: opacity 120ms ease, transform 120ms ease; }
  .toast.visible { opacity: 1; transform: translate(-50%, 0); }
  .toast.bad { border-color: #d9b6aa; color: var(--danger); }
  [hidden] { display: none !important; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  @media (max-width: 1180px) {
    .layout { grid-template-columns: 1fr; }
    .stageTop { flex-direction: column; }
    .faceView { width: 100%; }
  }
`;

const clientJs = String.raw`
(() => {
  "use strict";
  const model = JSON.parse(document.getElementById("model").textContent);
  const base = model.assetBase;
  const items = model.items;
  const roster = model.roster;
  const rosterBySlug = new Map(roster.map((p) => [p.slug, p]));
  const itemByKey = new Map(items.map((i) => [i.key, i]));
  const order = new Map(items.map((i, index) => [i.key, index]));
  const groupKeys = new Map(model.groups.map((g) => [g.id, g.keys]));
  const prefsKey = "rzNamingToolPlace:" + model.buildFingerprint;

  // The server holds the truth; this map is the page's copy of it.
  const state = new Map(Object.entries(model.decided));
  let mode = "open";
  let currentKey = localStorage.getItem(prefsKey) || "";
  let zoom = "tight";
  let query = "";
  let highlight = 0;
  let pending = [];
  let undoDepth = 0;
  let sessionCount = 0;
  const sessionStart = Date.now();
  let toastTimer = null;
  let busy = false;

  const els = {};
  for (const node of document.querySelectorAll("[id]")) els[node.id] = node;

  const url = (path) => path ? (path.charAt(0) === "/" ? path : base + path) : "";

  function statusOf(item) {
    const r = state.get(item.key);
    return r ? r.action : "open";
  }
  function isAnswered(item) {
    const s = statusOf(item);
    return s === "tag" || s === "not-a-guest" || s === "too-blurry" || s === "remove";
  }

  function visible() {
    return items.filter((item) => {
      const s = statusOf(item);
      if (mode === "open") return !isAnswered(item) && s !== "skip";
      if (mode === "skip") return s === "skip";
      if (mode === "done") return isAnswered(item);
      return true;
    });
  }

  function current() {
    const list = visible();
    if (!list.length) return null;
    const found = list.find((i) => i.key === currentKey);
    if (found) return found;
    const position = currentKey && order.has(currentKey) ? order.get(currentKey) : -1;
    const next = list.find((i) => order.get(i.key) > position) || list[0];
    currentKey = next.key;
    return next;
  }

  function toast(text, bad) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = text;
    els.toast.className = "toast visible" + (bad ? " bad" : "");
    toastTimer = window.setTimeout(() => els.toast.classList.remove("visible"), bad ? 3200 : 1300);
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

  // ---------- suggestions ----------

  function rank(person, q) {
    const name = person.name.toLowerCase();
    if (name === q) return 0;
    if (name.indexOf(q) === 0) return 1;
    const words = name.split(/\s+/);
    if (words.some((w) => w.indexOf(q) === 0)) return 2;
    if (words.map((w) => w.charAt(0)).join("").indexOf(q) === 0) return 3;
    if (name.indexOf(q) !== -1) return 4;
    return -1;
  }

  function suggestions(item) {
    const q = query.trim().toLowerCase();
    const chosen = new Set(pending);
    let out;
    if (!q) {
      out = [];
      for (const s of item.suggestions) {
        const person = rosterBySlug.get(s.slug);
        if (person && !chosen.has(person.slug)) out.push({ person: person, hint: s.source });
      }
      for (const known of item.knownPeople) {
        if (chosen.has(known.slug) || out.some((o) => o.person.slug === known.slug)) continue;
        const person = rosterBySlug.get(known.slug);
        if (person) out.push({ person: person, hint: "in this photo" });
      }
      for (const person of recent) {
        if (out.length >= 8) break;
        if (chosen.has(person.slug) || out.some((o) => o.person.slug === person.slug)) continue;
        out.push({ person: person, hint: "just used" });
      }
      out = out.slice(0, 9);
    } else {
      const scored = [];
      for (const person of roster) {
        if (chosen.has(person.slug)) continue;
        const r = rank(person, q);
        if (r < 0) continue;
        scored.push({ person: person, r: r });
      }
      scored.sort((a, b) => a.r - b.r || b.person.photoCount - a.person.photoCount || a.person.name.localeCompare(b.person.name));
      out = scored.slice(0, 9).map((s) => ({ person: s.person, hint: s.person.photoCount + " photos" }));
    }
    return out;
  }

  const recent = [];
  function remember(slugs) {
    for (const slug of slugs) {
      const person = rosterBySlug.get(slug);
      if (!person) continue;
      const at = recent.findIndex((p) => p.slug === slug);
      if (at >= 0) recent.splice(at, 1);
      recent.unshift(person);
    }
    recent.length = Math.min(recent.length, 10);
  }

  // ---------- rendering ----------

  function renderStage(item) {
    const crop = item.tightCrop ? (zoom === "tight" ? item.tightCrop : zoom === "wide" ? item.wideCrop : null) : null;
    els.faceView.innerHTML = "";
    const face = document.createElement("img");
    face.decoding = "async";
    face.alt = "";
    if (crop) {
      els.faceView.classList.remove("contain");
      face.src = url(item.photoUrl);
      Object.assign(face.style, cropStyle(crop, item.aspectRatio));
    } else {
      els.faceView.classList.add("contain");
      face.src = url(item.fallbackCropUrl || item.photoUrl);
    }
    els.faceView.append(face);

    els.contextWrap.innerHTML = "";
    const wide = document.createElement("img");
    wide.src = url(item.photoUrl);
    wide.alt = "";
    wide.decoding = "async";
    els.contextWrap.append(wide);
    const boxes = item.box ? [{ box: item.box, main: true }] : [];
    for (const other of item.otherFaces) boxes.push({ box: other, main: false });
    for (const entry of boxes) {
      const marker = document.createElement("div");
      marker.className = "marker" + (entry.main ? "" : " other");
      marker.style.left = (entry.box.x * 100).toFixed(3) + "%";
      marker.style.top = (entry.box.y * 100).toFixed(3) + "%";
      marker.style.width = (entry.box.width * 100).toFixed(3) + "%";
      marker.style.height = (entry.box.height * 100).toFixed(3) + "%";
      els.contextWrap.append(marker);
    }
    els.zoomLabel.textContent = item.tightCrop
      ? (zoom === "tight" ? "close up" : zoom === "wide" ? "with surroundings" : "whole photo")
      : "whole photo, no face box on this one";
  }

  function renderGroup(item) {
    const keys = item.groupId ? groupKeys.get(item.groupId) : null;
    els.groupStrip.hidden = !keys;
    els.applyGroup.hidden = !keys;
    els.tooBlurryGroup.hidden = !keys;
    els.notSureGroup.hidden = !keys;
    els.notGuestGroup.hidden = !keys;
    if (!keys) return;
    const open = keys.filter((k) => !isAnswered(itemByKey.get(k))).length;
    els.groupLabel.textContent =
      "These " + keys.length + " look like the same person. Check them, then one name covers all " +
      open + " that are still open.";
    const inherited = nameAlreadyOnStack(item);
    const inheritedNames = inherited
      ? inherited.map((slug) => (rosterBySlug.get(slug) || {}).name || slug).join(", ")
      : "";
    // Say the name when the stack already has one, so "apply it to the rest"
    // reads as an offer rather than something to discover.
    els.applyGroup.textContent = inheritedNames && !pending.length
      ? inheritedNames + " in all " + open
      : "Same person in all " + open;
    els.groupRow.innerHTML = "";
    for (const key of keys) {
      const member = itemByKey.get(key);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "groupFace" + (key === item.key ? " current" : "") + (isAnswered(member) ? " done" : "");
      button.title = member.catalogPath;
      const inner = document.createElement("span");
      inner.className = "inner";
      const img = document.createElement("img");
      img.decoding = "async";
      img.alt = "";
      img.src = url(member.thumbUrl);
      if (member.tightCrop) Object.assign(img.style, cropStyle(member.tightCrop, member.aspectRatio));
      else { img.style.width = "100%"; img.style.height = "100%"; img.style.objectFit = "cover"; }
      inner.append(img);
      const badge = document.createElement("span");
      badge.className = "badge";
      const r = state.get(key);
      badge.textContent = r && r.action === "tag"
        ? ((rosterBySlug.get((r.personSlugs || [])[0]) || {}).name || "named").split(" ")[0]
        : member.event;
      button.append(inner, badge);
      button.addEventListener("click", () => { currentKey = key; pending = []; setQuery(""); render(); });
      els.groupRow.append(button);
    }
  }

  function renderChips() {
    els.chips.innerHTML = "";
    for (const slug of pending) {
      const person = rosterBySlug.get(slug);
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.append(document.createTextNode(person ? person.name : slug));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.addEventListener("click", () => { pending = pending.filter((s) => s !== slug); render(); });
      chip.append(remove);
      els.chips.append(chip);
    }
  }

  // Whatever is on screen is exactly what a number key or Enter can choose.
  // Nothing re-derives the list at the moment of the keystroke, so a name can
  // never be saved that was not the one being looked at.
  let shown = [];

  function renderOptions(item) {
    const list = suggestions(item);
    shown = list;
    if (highlight >= list.length) highlight = Math.max(0, list.length - 1);
    els.options.innerHTML = "";
    if (!list.length) {
      const note = document.createElement("p");
      note.className = "metaNote";
      note.textContent = query.trim()
        ? "No guest by that name. Check the spelling, or press P to browse everyone."
        : "Start typing a name.";
      els.options.append(note);
      return;
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
        img.src = url(entry.person.faceUrl);
        img.loading = "lazy";
        img.alt = "";
        thumb.append(img);
      } else {
        thumb.textContent = initials(entry.person.name);
      }
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = entry.person.name;
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = entry.hint || "";
      button.append(num, thumb, who, hint);
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => pick(index, true));
      els.options.append(button);
    });
  }

  function paintHighlight() {
    els.options.querySelectorAll(".option").forEach((button, index) => {
      button.classList.toggle("highlight", index === highlight);
    });
  }

  function renderSavedFaces() {
    const slug = pending.length ? pending[pending.length - 1] : null;
    const person = slug ? rosterBySlug.get(slug) : null;
    els.savedFacesWrap.hidden = !person;
    if (!person) return;
    els.savedFacesLabel.textContent = "Saved faces for " + person.name;
    els.savedFaces.innerHTML = "";
    const urls = person.faceUrl ? [person.faceUrl].concat(person.cropUrls) : person.cropUrls.slice();
    if (!urls.length) {
      const note = document.createElement("p");
      note.className = "metaNote";
      note.textContent = "No saved photo of this guest yet.";
      els.savedFaces.append(note);
      return;
    }
    for (const item of urls.slice(0, 5)) {
      const img = document.createElement("img");
      img.src = url(item);
      img.loading = "lazy";
      img.alt = "";
      els.savedFaces.append(img);
    }
  }

  function renderProgress() {
    let answered = 0;
    let skipped = 0;
    for (const item of items) {
      if (isAnswered(item)) answered += 1;
      else if (statusOf(item) === "skip") skipped += 1;
    }
    els.railFill.style.width = (items.length ? (answered / items.length) * 100 : 0).toFixed(2) + "%";
    const minutes = (Date.now() - sessionStart) / 60000;
    els.progressText.innerHTML =
      answered + " of " + items.length + " done" +
      "<span> &middot; " + (items.length - answered - skipped) + " to go" +
      (skipped ? " &middot; " + skipped + " not sure" : "") +
      (sessionCount && minutes > 0.5 ? " &middot; " + (sessionCount / minutes).toFixed(1) + " a minute" : "") +
      "</span>";
    els.skipMode.textContent = "Not sure (" + skipped + ")";
    els.undoButton.disabled = undoDepth === 0 || busy;
  }

  function render() {
    for (const button of document.querySelectorAll("[data-mode]")) {
      button.classList.toggle("active", button.dataset.mode === mode);
    }
    const item = current();
    els.layout.hidden = !item;
    els.empty.classList.toggle("visible", !item);
    renderProgress();
    if (!item) return;
    localStorage.setItem(prefsKey, item.key);

    const r = state.get(item.key);
    els.kindPill.textContent = item.kind === "partial" ? "One more face here" : "No names yet";
    els.kindPill.className = "pill" + (item.kind === "partial" ? " partial" : "");
    const status = statusOf(item);
    els.statusPill.hidden = status === "open";
    els.statusPill.className = "pill " + (status === "tag" ? "done" : "none");
    els.statusPill.textContent =
      status === "tag"
        ? (r.personSlugs || []).map((s) => (rosterBySlug.get(s) || {}).name || s).join(", ")
        : status === "not-a-guest" ? "Not a guest"
        : status === "too-blurry" ? "Too blurry to name"
        : status === "remove" ? "Name removed"
        : status === "skip" ? "Not sure" : "";
    els.changeButton.hidden = status === "open";

    els.metaPath.textContent = item.event + " · " + item.filename;
    els.metaKnown.textContent = item.knownPeople.length
      ? "Also in this photo: " + item.knownPeople.map((p) => p.name).join(", ")
      : "";
    els.metaKnown.hidden = item.knownPeople.length === 0;
    els.metaNote.textContent = item.notes;
    els.metaNote.hidden = !item.notes;
    els.removeButton.hidden = item.knownPeople.length === 0;
    els.openOriginal.href = item.originalUrl;

    renderStage(item);
    renderGroup(item);
    renderChips();
    renderOptions(item);
    renderSavedFaces();
    els.noteInput.value = r && r.note ? r.note : "";
    els.combo.focus();
    prefetch();
  }

  // Keep several upcoming photographs decoded and in cache so the next face is
  // already on screen the moment this one is answered.
  const warmed = new Set();
  function prefetch() {
    const list = visible();
    const at = list.findIndex((i) => i.key === currentKey);
    for (let offset = 1; offset <= 8; offset += 1) {
      const next = list[at + offset];
      if (!next) break;
      for (const path of [next.photoUrl, next.thumbUrl]) {
        if (!path || warmed.has(path)) continue;
        warmed.add(path);
        const img = new Image();
        img.decoding = "async";
        img.src = url(path);
      }
    }
  }

  // ---------- talking to the local server ----------

  async function post(endpoint, body) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || ("Save failed (" + response.status + ")"));
    }
    return payload;
  }

  function applyResult(payload) {
    for (const [key, value] of Object.entries(payload.decided || {})) {
      if (value === null) state.delete(key);
      else state.set(key, value);
    }
    undoDepth = payload.undoDepth || 0;
  }

  async function decide(keys, action, personSlugs, note, label) {
    if (model.readOnly) {
      toast("This is a preview. Run npm run tag to answer.", true);
      return;
    }
    if (busy) return;
    busy = true;
    els.combo.disabled = true;
    try {
      const payload = await post("/api/decide", {
        buildFingerprint: model.buildFingerprint,
        keys: keys,
        action: action,
        personSlugs: personSlugs || [],
        note: note || ""
      });
      applyResult(payload);
      sessionCount += keys.length;
      remember(personSlugs || []);
      advanceFrom(keys[0]);
      if (label) toast(label);
    } catch (error) {
      toast(String(error.message || error), true);
      render();
    } finally {
      busy = false;
      els.combo.disabled = false;
      els.combo.focus();
    }
  }

  async function undo() {
    if (busy) return;
    busy = true;
    try {
      const payload = await post("/api/undo", { buildFingerprint: model.buildFingerprint });
      applyResult(payload);
      sessionCount = Math.max(0, sessionCount - (payload.reverted || 0));
      if (payload.focusKey) currentKey = payload.focusKey;
      pending = [];
      setQuery("");
      render();
      toast(payload.reverted ? "Undone" : "Nothing to undo");
    } catch (error) {
      toast(String(error.message || error), true);
    } finally {
      busy = false;
      els.combo.focus();
    }
  }

  function advanceFrom(key) {
    const position = order.get(key);
    const list = visible();
    const next = list.find((i) => order.get(i.key) > position) || list[0] || null;
    currentKey = next ? next.key : "";
    pending = [];
    setQuery("");
    highlight = 0;
    render();
  }

  // ---------- actions ----------

  function pick(index, save) {
    const item = current();
    if (!item) return;
    const entry = shown[index];
    if (!entry) return;
    if (!pending.includes(entry.person.slug)) pending.push(entry.person.slug);
    setQuery("");
    highlight = 0;
    if (save) saveNames(false);
    else render();
  }

  /**
   * "Same person in all", from whatever state the box is in: a name typed
   * but not yet taken, names already staged, or nothing typed at all because
   * this face was just named and the rest of its stack should follow.
   */
  function saveNamesToStack() {
    if (query.trim()) pick(highlight, false);
    if (!pending.length) {
      const inherited = nameAlreadyOnStack(current());
      if (inherited) pending = inherited;
    }
    saveNames(true);
  }

  /**
   * The name already given to some face in this stack, newest first, or null.
   *
   * This is what makes "I named one, now apply it to the rest" a single
   * keystroke. Naming a face advances the cursor to the next open one, so by
   * the time the guest reaches for "same person in all" the named face is
   * behind them and the box is empty; without this the action could only
   * report that nothing was typed.
   */
  function nameAlreadyOnStack(item) {
    if (!item) return null;
    const own = state.get(item.key);
    if (own && own.action === "tag" && (own.personSlugs || []).length) {
      return [...own.personSlugs];
    }
    if (!item.groupId) return null;
    let best = null;
    for (const key of groupKeys.get(item.groupId) || []) {
      const record = state.get(key);
      if (!record || record.action !== "tag" || !(record.personSlugs || []).length) continue;
      if (!best || String(record.decidedAt || "") >= String(best.decidedAt || "")) best = record;
    }
    return best ? [...best.personSlugs] : null;
  }

  function saveNames(alsoGroup) {
    const item = current();
    if (!item) return;
    if (!pending.length) { toast("Type a name first"); els.combo.focus(); return; }
    const keys = [item.key];
    if (alsoGroup && item.groupId) {
      for (const key of groupKeys.get(item.groupId)) {
        if (key !== item.key && !isAnswered(itemByKey.get(key))) keys.push(key);
      }
    }
    const names = pending.map((s) => (rosterBySlug.get(s) || {}).name || s).join(", ");
    decide(keys, "tag", pending.slice(), els.noteInput.value.trim(),
      keys.length > 1 ? names + " on " + keys.length + " photos" : names);
  }

  function notAGuest(wholeStack) {
    const item = current();
    if (!item) return;
    const keys = stackKeys(item, wholeStack);
    decide(keys, "not-a-guest", [], els.noteInput.value.trim(),
      keys.length > 1 ? "Not a guest, all " + keys.length : "Not a guest");
  }

  /**
   * The face under the cursor, plus its stack when a whole-stack form was
   * asked for. Already-answered members are left alone, exactly as naming a
   * stack does: a confirmed name must never be overwritten by a sweep, both
   * because it is the more considered answer and because the name is already
   * written into the additions overlay, which a ledger-only action does not
   * unwind.
   */
  function stackKeys(item, wholeStack) {
    const keys = [item.key];
    if (wholeStack && item.groupId) {
      for (const key of groupKeys.get(item.groupId)) {
        if (key !== item.key && !isAnswered(itemByKey.get(key))) keys.push(key);
      }
    }
    return keys;
  }

  function notSure(wholeStack) {
    const item = current();
    if (!item) return;
    const keys = stackKeys(item, wholeStack);
    decide(keys, "skip", [], els.noteInput.value.trim(),
      keys.length > 1 ? "Not sure, all " + keys.length : "Marked not sure");
  }

  /**
   * Too blurred or too small to name, which is a different answer from "not
   * sure who this is": nobody could name it, so it should never come back.
   * The whole-stack form matters because look-alike stacks are built from
   * face geometry, so a soft face usually arrives with its equally soft
   * siblings from the same distant frame.
   */
  function tooBlurry(wholeStack) {
    const item = current();
    if (!item) return;
    const keys = stackKeys(item, wholeStack);
    decide(keys, "too-blurry", [], els.noteInput.value.trim(),
      keys.length > 1 ? "Too blurry, all " + keys.length : "Too blurry to name");
  }

  function removeName() {
    const item = current();
    if (!item || !item.knownPeople.length) return;
    const reason = window.prompt(
      "Take " + item.knownPeople.map((p) => p.name).join(", ") + " off " + item.filename +
        "?\n\nWrite why, in a sentence. It is kept with the change.",
      els.noteInput.value.trim()
    );
    if (reason === null) return;
    if (reason.trim().length < 20) { toast("Please write a full sentence", true); return; }
    decide([item.key], "remove", item.knownPeople.map((p) => p.slug), reason.trim(), "Name removed");
  }

  function reopen() {
    const item = current();
    if (!item || statusOf(item) === "open") return;
    decide([item.key], "reopen", [], "", "Back to open");
    currentKey = item.key;
  }

  function setQuery(value) {
    query = value;
    els.combo.value = value;
  }

  function moveHighlight(delta) {
    if (!shown.length) return;
    highlight = (highlight + delta + shown.length) % shown.length;
    paintHighlight();
  }

  function cycleZoom() {
    const steps = ["tight", "wide", "full"];
    zoom = steps[(steps.indexOf(zoom) + 1) % steps.length];
    const item = current();
    if (item) renderStage(item);
    els.combo.focus();
  }

  function step(delta) {
    const list = visible();
    if (!list.length) return;
    const at = list.findIndex((i) => i.key === currentKey);
    const next = list[Math.max(0, Math.min(list.length - 1, (at < 0 ? 0 : at) + delta))];
    if (next) { currentKey = next.key; pending = []; setQuery(""); highlight = 0; render(); }
  }

  function setMode(next) { mode = next; currentKey = ""; render(); }

  // ---------- keyboard ----------
  // The name box keeps focus, so letters always type. Every command is a key
  // that cannot appear in a guest's name.

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey) {
      if (event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
      return;
    }
    const open = els.roster.classList.contains("open") || els.help.classList.contains("open");
    if (open) {
      if (event.key === "Escape") {
        event.preventDefault();
        els.roster.classList.remove("open");
        els.help.classList.remove("open");
        els.combo.focus();
      }
      return;
    }
    if (document.activeElement === els.noteInput) {
      if (event.key === "Escape") { event.preventDefault(); els.noteInput.blur(); els.combo.focus(); }
      return;
    }

    const key = event.key;
    if (key === "Enter") {
      event.preventDefault();
      // Shift+Enter always means "same person in every photo in this stack",
      // as the on-screen button and the help table both say. It used to mean
      // that ONLY when the search box was already empty: with a name typed,
      // the shift was read as "take the name but stay", so the most natural
      // gesture in the tool (type the name, shift-enter to apply it to the
      // whole row) silently answered one face. Staging a typed name and then
      // saving to the stack is what both readings wanted.
      if (event.shiftKey) { saveNamesToStack(); return; }
      if (query.trim()) pick(highlight, true);
      else saveNames(false);
      return;
    }
    if (key === "ArrowDown") { event.preventDefault(); moveHighlight(1); return; }
    if (key === "ArrowUp") { event.preventDefault(); moveHighlight(-1); return; }
    if (key === ",") { event.preventDefault(); pick(highlight, false); return; }
    if (key >= "1" && key <= "9") { event.preventDefault(); pick(Number(key) - 1, !event.shiftKey); return; }
    if (key === "Escape") {
      event.preventDefault();
      // Shift+Esc is an explicit chord, so it skips the clear-first layering
      // and always sweeps the stack. Nothing is written to a photograph and
      // undo covers it, so a stray press costs one keystroke.
      if (event.shiftKey) { notSure(true); return; }
      if (query) { setQuery(""); highlight = 0; renderOptions(current()); }
      else if (pending.length) { pending = []; render(); }
      else notSure(false);
      return;
    }
    if (key === "Tab") { event.preventDefault(); step(event.shiftKey ? -1 : 1); return; }
    // Shift+minus sweeps the stack, matching Shift+Enter, Shift+Esc and {.
    // It used to be a plain alias for the single-face form.
    if (key === "-") { event.preventDefault(); notAGuest(false); return; }
    if (key === "_") { event.preventDefault(); notAGuest(true); return; }
    if (key === "[") { event.preventDefault(); tooBlurry(false); return; }
    if (key === "{") { event.preventDefault(); tooBlurry(true); return; }
    if (key === "=" || key === "+") { event.preventDefault(); cycleZoom(); return; }
    if (key === "?" || key === "/") { event.preventDefault(); els.help.classList.add("open"); return; }
    if (key === "\\") { event.preventDefault(); saveNamesToStack(); return; }
    if (query.trim() === "" && (key === "p" || key === "P")) { event.preventDefault(); openRoster(); return; }
  });

  els.combo.addEventListener("input", () => {
    query = els.combo.value;
    highlight = 0;
    const item = current();
    if (item) renderOptions(item);
  });
  els.combo.addEventListener("blur", () => {
    // Losing focus costs a keystroke, so take it straight back unless a
    // dialog or the note box wants it.
    window.setTimeout(() => {
      if (busy) return;
      const active = document.activeElement;
      if (active === els.noteInput || active === els.rosterFilter) return;
      if (els.roster.classList.contains("open") || els.help.classList.contains("open")) return;
      if (active && active.tagName === "BUTTON") return;
      els.combo.focus();
    }, 0);
  });

  // ---------- roster ----------

  function openRoster() {
    els.roster.classList.add("open");
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
        img.src = url(person.faceUrl);
        img.loading = "lazy";
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
        els.roster.classList.remove("open");
        render();
      });
      els.rosterGrid.append(card);
    }
    els.rosterCount.textContent = list.length + " of " + roster.length + " guests";
  }

  els.rosterFilter.addEventListener("input", () => paintRoster(els.rosterFilter.value));
  for (const drawer of [els.roster, els.help]) {
    drawer.addEventListener("click", (event) => {
      if (event.target === drawer) { drawer.classList.remove("open"); els.combo.focus(); }
    });
  }

  // ---------- wiring ----------

  for (const button of document.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }
  els.saveButton.addEventListener("click", () => saveNames(false));
  els.applyGroup.addEventListener("click", () => saveNames(true));
  els.notGuest.addEventListener("click", () => notAGuest(false));
  els.notGuestGroup.addEventListener("click", () => notAGuest(true));
  els.tooBlurry.addEventListener("click", () => tooBlurry(false));
  els.tooBlurryGroup.addEventListener("click", () => tooBlurry(true));
  els.notSure.addEventListener("click", () => notSure(false));
  els.notSureGroup.addEventListener("click", () => notSure(true));
  els.removeButton.addEventListener("click", removeName);
  els.changeButton.addEventListener("click", reopen);
  els.undoButton.addEventListener("click", undo);
  els.prevButton.addEventListener("click", () => step(-1));
  els.nextButton.addEventListener("click", () => step(1));
  els.zoomButton.addEventListener("click", cycleZoom);
  els.rosterButton.addEventListener("click", openRoster);
  els.helpButton.addEventListener("click", () => els.help.classList.add("open"));
  els.noteInput.addEventListener("change", () => {
    const item = current();
    if (!item || !state.has(item.key)) return;
    post("/api/note", {
      buildFingerprint: model.buildFingerprint,
      key: item.key,
      note: els.noteInput.value.trim()
    }).then(applyResult).catch((error) => toast(String(error.message || error), true));
  });
  window.addEventListener("beforeunload", (event) => {
    if (!busy) return;
    event.preventDefault();
    event.returnValue = "";
  });

  if (model.readOnly) {
    els.headNote.textContent = "Preview only — run npm run tag to answer";
    els.headNote.style.color = "var(--danger)";
  }
  render();
  els.combo.focus();
})();
`;

export function renderNamingPage(model) {
  const shortcuts = [
    ["type a name", "search the guest list"],
    ["Enter", "that is them, save and go to the next face"],
    ["1 … 9", "pick that name from the list and save"],
    ["↑ ↓", "move up and down the list"],
    ["Shift+Enter or \\", "same person in every photo in the row below; with an empty box it reuses the name already on the row"],
    ["Shift+1 … 9 or ,", "add the name but stay, to name a second person"],
    ["Esc", "clear what you typed; on an empty box, mark not sure"],
    ["Shift+Esc", "not sure, all of them in the row below"],
    ["− (minus)", "not a wedding guest"],
    ["_  (Shift+minus)", "not a guest, all of them in the row below"],
    ["[", "too blurry or too small to name, do not ask again"],
    ["{  (Shift+[)", "too blurry, all of them in the row below"],
    ["= (equals)", "close up / with surroundings / whole photo"],
    ["Tab / Shift+Tab", "next and previous face without answering"],
    ["⌘Z", "undo the last answer"],
    ["P", "browse the whole guest list"],
    ["?", "these shortcuts"],
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Who is this? &middot; Rachel &amp; Zach</title>
  <style>${css}</style>
</head>
<body>
  <header>
    <h1>Who is this?</h1>
    <div class="progressText" id="progressText"></div>
    <div class="rail"><div class="railFill" id="railFill"></div></div>
    <button type="button" data-mode="open">Still to do</button>
    <button type="button" id="skipMode" data-mode="skip">Not sure</button>
    <button type="button" data-mode="done">Answered</button>
    <button type="button" data-mode="all">All</button>
    <span class="spacer"></span>
    <span class="headNote">Saved as you go</span>
    <button type="button" id="rosterButton">Guest list<kbd>P</kbd></button>
    <button type="button" id="helpButton">Shortcuts<kbd>?</kbd></button>
  </header>

  <main>
    <div class="layout" id="layout">
      <section class="panel stage">
        <div class="stageTop">
          <div class="faceView" id="faceView"></div>
          <div class="contextView"><div class="contextWrap" id="contextWrap"></div></div>
        </div>
        <div class="stageBar">
          <button type="button" class="tiny" id="zoomButton">Zoom</button>
          <span id="zoomLabel"></span>
          <span class="spacer"></span>
          <a id="openOriginal" href="#" target="_blank" rel="noreferrer" class="headNote">See the full-size photo</a>
        </div>
        <div class="groupStrip" id="groupStrip" hidden>
          <p class="groupLabel" id="groupLabel"></p>
          <div class="groupRow" id="groupRow"></div>
        </div>
      </section>

      <aside class="panel side">
        <div class="pillRow">
          <span class="pill" id="kindPill"></span>
          <span class="pill" id="statusPill" hidden></span>
          <span class="spacer"></span>
          <button type="button" class="tiny" id="changeButton" hidden>Change this</button>
        </div>
        <div class="meta">
          <p class="metaNote" id="metaPath"></p>
          <p class="metaNote" id="metaKnown"></p>
          <p class="metaNote" id="metaNote"></p>
        </div>

        <div>
          <p class="label">Type a name, then press Enter</p>
          <input class="combo" id="combo" type="text" autocomplete="off" autocapitalize="off"
                 spellcheck="false" placeholder="Start typing…">
        </div>
        <div class="chips" id="chips"></div>
        <div class="options" id="options"></div>

        <div id="savedFacesWrap" hidden>
          <p class="label" id="savedFacesLabel"></p>
          <div class="savedFaces" id="savedFaces"></div>
        </div>

        <textarea class="noteInput" id="noteInput" rows="1" placeholder="Note (optional)"></textarea>

        <div class="actions">
          <button type="button" class="primary wide" id="saveButton">That's them<kbd>Enter</kbd></button>
          <button type="button" class="gold wide" id="applyGroup" hidden>Same person in all<kbd>\\</kbd></button>
          <button type="button" id="notSure">Not sure<kbd>Esc</kbd></button>
          <button type="button" id="notSureGroup" hidden>Not sure, all<kbd>&#8679;Esc</kbd></button>
          <button type="button" class="warn" id="notGuest">Not a guest<kbd>&minus;</kbd></button>
          <button type="button" class="warn" id="notGuestGroup" hidden>Not a guest, all<kbd>_</kbd></button>
          <button type="button" id="tooBlurry">Too blurry<kbd>[</kbd></button>
          <button type="button" id="tooBlurryGroup" hidden>Too blurry, all<kbd>{</kbd></button>
          <button type="button" id="undoButton" disabled>Undo<kbd>&#8984;Z</kbd></button>
          <button type="button" class="warn" id="removeButton" hidden>A name here is wrong</button>
          <button type="button" id="prevButton">Back</button>
          <button type="button" id="nextButton">Next</button>
        </div>
      </aside>
    </div>
    <div class="empty" id="empty">Nothing left in this view. Try <strong>All</strong> or <strong>Not sure</strong>.</div>
  </main>

  <div class="drawer" id="roster">
    <div class="drawerCard">
      <div class="drawerHead">
        <strong id="rosterCount"></strong>
        <input id="rosterFilter" type="search" placeholder="Find a guest" aria-label="Find a guest">
      </div>
      <div class="rosterGrid" id="rosterGrid"></div>
    </div>
  </div>

  <div class="drawer" id="help">
    <div class="drawerCard">
      <div class="drawerHead">
        <strong>Keyboard shortcuts</strong>
        <span class="headNote">Esc closes</span>
      </div>
      <div class="helpGrid">
        ${shortcuts
          .map(
            ([keys, description]) =>
              `<div class="helpRow"><strong>${htmlEscape(keys)}</strong><span>${htmlEscape(
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
