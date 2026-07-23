// Read-only loader for the Wedding Master Clean photo manifest.
//
// The manifest (_Metadata/photo-manifest.csv) is the catalog source of truth.
// This module never opens a source file for writing: it parses the CSV,
// validates each row against the current bytes on disk, streams SHA-256
// hashes, and reads embedded EXIF/XMP via exifr. image_data_hash is treated
// as the stable visual identity; it was produced by exiftool's ImageDataHash
// (MD5 over image data, excluding metadata) and is re-verified out-of-band by
// the importer CLI.
import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import exifr from "exifr";
import { buildDerivativePlan } from "./image-derivatives.mjs";

export const EVENT_ORDER = [
  "Day 1",
  "Getting Ready",
  "First Look",
  "Ceremony Details",
  "Ceremony",
  "Friends & Family",
  "Cocktail Hour",
  "Reception Details",
  "Reception",
  "Dancing",
  "Sunset",
  "After Party",
  "Sneak Peek",
  "Film"
];

export const EXCLUDED_DIRECTORIES = ["_Review", "_Metadata", "By Person"];

export const MANIFEST_COLUMNS = [
  "output_path",
  "source_path",
  "event",
  "filename",
  "image_data_hash",
  "width",
  "height",
  "source_file_size",
  "output_file_size",
  "review_status",
  "correction_action",
  "lightroom_people",
  "google_people",
  "people_added",
  "final_people",
  "metadata_mode"
];

const IMAGE_DATA_HASH_PATTERN = /^[0-9a-f]{32}$/;

/**
 * RFC-4180-style CSV parser: quoted fields may contain commas, quotes,
 * newlines. Returns one record per row with the 1-based line number where the
 * row starts, so validation errors can name the offending manifest line.
 */
export function parseCsvWithLines(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowStartLine = 1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push({ cells: row, line: rowStartLine });
      row = [];
      field = "";
      line += 1;
      rowStartLine = line;
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push({ cells: row, line: rowStartLine });
  }
  return rows.filter((record) => record.cells.some((value) => value.trim() !== ""));
}

/** Back-compat shape: rows as plain string arrays, blank rows dropped. */
export function parseCsv(text) {
  return parseCsvWithLines(text).map((record) => record.cells);
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normalizes a "; "-separated people list: trims entries, collapses internal
 * whitespace, drops empties, and de-duplicates. Display labels stay
 * authoritative -- no casing or spelling changes beyond whitespace cleanup.
 */
export function normalizePeople(raw) {
  const names = String(raw ?? "")
    .split(";")
    .map((name) => name.replace(/\s+/g, " ").trim())
    .filter((name) => name.length > 0);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export function classifyOrientation(width, height) {
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
}

// EXIF Orientation values 5-8 rotate the image 90 degrees, so encoded
// width/height must be swapped to get display (oriented) dimensions.
const EXIF_ORIENTATION_NAMES = new Map([
  ["horizontal (normal)", 1],
  ["mirror horizontal", 2],
  ["rotate 180", 3],
  ["mirror vertical", 4],
  ["mirror horizontal and rotate 270 cw", 5],
  ["rotate 90 cw", 6],
  ["mirror horizontal and rotate 90 cw", 7],
  ["rotate 270 cw", 8]
]);

/** Accepts exifr's numeric or translated string form; returns 1-8 or null. */
export function normalizeExifOrientation(value) {
  if (value == null) return null;
  if (Number.isInteger(value) && value >= 1 && value <= 8) return value;
  return EXIF_ORIENTATION_NAMES.get(String(value).trim().toLowerCase()) ?? null;
}

export function orientationSwapsDimensions(exifOrientation) {
  return Number.isInteger(exifOrientation) && exifOrientation >= 5 && exifOrientation <= 8;
}

export function sha256Stream(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

const EXIF_DATETIME_PATTERN = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const EXIF_OFFSET_PATTERN = /^[+-]\d{2}:\d{2}$/;

export function formatCapturedAt(dateTimeOriginal, offsetTimeOriginal) {
  const match = EXIF_DATETIME_PATTERN.exec(String(dateTimeOriginal ?? "").trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const offset = String(offsetTimeOriginal ?? "").trim();
  const suffix = EXIF_OFFSET_PATTERN.test(offset) ? offset : "";
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${suffix}`;
}

function normalizeKeywords(...sources) {
  const keywords = new Set();
  for (const source of sources) {
    const values = Array.isArray(source) ? source : source != null ? [source] : [];
    for (const value of values) {
      const text = String(value).replace(/\s+/g, " ").trim();
      if (text) keywords.add(text);
    }
  }
  return [...keywords].sort((a, b) => a.localeCompare(b));
}

/**
 * Reads capturedAt + keywords + EXIF Orientation from embedded EXIF/XMP/IPTC.
 * Read-only; missing stays null/empty. A parse exception is recorded in
 * `error` so the report can distinguish "no metadata" from "read failed";
 * either way the photo still imports with null/empty metadata.
 */
export async function readEmbeddedMetadata(path) {
  let parsed = null;
  let error = null;
  try {
    parsed = await exifr.parse(path, {
      tiff: true,
      exif: true,
      xmp: true,
      iptc: true,
      reviveValues: false
    });
  } catch (cause) {
    parsed = null;
    error = String(cause?.message ?? cause);
  }
  if (!parsed) {
    return { capturedAt: null, keywords: [], orientation: null, error };
  }
  return {
    capturedAt: formatCapturedAt(parsed.DateTimeOriginal, parsed.OffsetTimeOriginal),
    keywords: normalizeKeywords(parsed.subject, parsed.Keywords),
    orientation: normalizeExifOrientation(parsed.Orientation),
    error: null
  };
}

const EXCLUDED_DIRECTORIES_LOWER = EXCLUDED_DIRECTORIES.map((dir) => dir.toLowerCase());

// Case-insensitive: the source volume (APFS) resolves paths case-insensitively,
// so "by person/..." must be excluded exactly like "By Person/...".
function isExcludedPath(relativePath) {
  const lower = relativePath.toLowerCase();
  return EXCLUDED_DIRECTORIES_LOWER.some(
    (dir) => lower === dir || lower.startsWith(`${dir}/`)
  );
}

// Only a path SEGMENT equal to ".." is traversal; "photo..jpg" is a filename.
function hasTraversalSegment(relativePath) {
  return relativePath.split("/").some((segment) => segment === "..");
}

function eventSortIndex(name) {
  const index = EVENT_ORDER.indexOf(name);
  return index === -1 ? EVENT_ORDER.length : index;
}

function resolveManifestLocation(path) {
  if (path.toLowerCase().endsWith(".csv")) {
    return { manifestPath: path, root: dirname(dirname(path)) };
  }
  return { manifestPath: join(path, "_Metadata", "photo-manifest.csv"), root: path };
}

/**
 * Loads the clean-master manifest into a GalleryCatalog.
 *
 * @param {string} path Root of the clean master (or the manifest CSV itself).
 * @param {object} [options]
 * @param {boolean} [options.computeSha256=true] Stream SHA-256 per source file.
 * @param {boolean} [options.extractExif=true] Read capturedAt/keywords/orientation via exifr.
 * @param {string} [options.manifestText] Pre-read manifest text; when given the
 *   CSV is not read again, so a caller-computed manifest hash describes the
 *   exact bytes that were parsed.
 * @param {(progress: {filesDone:number,totalFiles:number,bytesDone:number,totalBytes:number}) => void} [options.onProgress]
 * @param {(snapshot: Array<{path:string,size:number,mtimeMs:number}>) => void} [options.onSourceStat]
 *   Invoked with a per-file stat snapshot taken during row validation, BEFORE
 *   any source content is read (hashing/EXIF), so source-write detection can
 *   cover the whole run.
 * @returns {Promise<import("../../src/types/gallery").GalleryCatalog>}
 */
export async function loadCleanMasterManifest(path, options = {}) {
  const { computeSha256 = true, extractExif = true, onProgress, onSourceStat } = options;
  const { manifestPath, root } = resolveManifestLocation(resolve(path));

  const text = options.manifestText ?? (await fs.readFile(manifestPath, "utf8"));
  const rows = parseCsvWithLines(text);
  if (rows.length === 0) {
    throw new Error(`Manifest is empty: ${manifestPath}`);
  }

  const header = rows[0].cells.map((cell) => cell.trim());
  const missingColumns = MANIFEST_COLUMNS.filter((column) => !header.includes(column));
  if (missingColumns.length > 0) {
    throw new Error(
      `Manifest ${manifestPath} is missing required columns: ${missingColumns.join(", ")}`
    );
  }
  const columnIndex = new Map(header.map((column, index) => [column, index]));
  const cell = (row, column) => (row[columnIndex.get(column)] ?? "").trim();

  const dataRows = rows.slice(1);
  const issues = [];
  const seenHashes = new Set();
  const candidates = [];

  for (const { cells: row, line } of dataRows) {
    // Row width must match the header exactly. A shifted row (extra or missing
    // unquoted comma) would silently misattribute every later column, so it is
    // rejected loudly with its manifest line number.
    if (row.length !== header.length) {
      issues.push({
        type: "bad_row",
        path: (row[columnIndex.get("output_path")] ?? "").trim() || null,
        imageDataHash: null,
        message: `Row at line ${line} has ${row.length} columns, expected ${header.length}`
      });
      continue;
    }

    const relativePath = cell(row, "output_path");
    const imageDataHash = cell(row, "image_data_hash").toLowerCase();
    const event = cell(row, "event");
    const filename = cell(row, "filename") || basename(relativePath);
    const width = Number(cell(row, "width"));
    const height = Number(cell(row, "height"));
    const declaredBytes = Number(cell(row, "output_file_size"));

    const reject = (type, message, extra = {}) => {
      issues.push({ type, path: relativePath || null, imageDataHash: imageDataHash || null, message, ...extra });
    };

    if (!relativePath) {
      reject("bad_row", "Row has no output_path");
      continue;
    }
    if (isExcludedPath(relativePath) || hasTraversalSegment(relativePath)) {
      reject("excluded_path", `Path is inside an excluded directory: ${relativePath}`);
      continue;
    }
    if (!IMAGE_DATA_HASH_PATTERN.test(imageDataHash)) {
      reject("bad_hash", `image_data_hash is not a 32-char lowercase hex value: "${cell(row, "image_data_hash")}"`);
      continue;
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      reject("bad_dimensions", `Invalid dimensions ${cell(row, "width")}x${cell(row, "height")}`);
      continue;
    }
    if (seenHashes.has(imageDataHash)) {
      reject("duplicate_hash", `Duplicate image_data_hash also claimed by an earlier row`);
      continue;
    }

    const absolutePath = join(root, relativePath);
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      reject("missing_file", `Source file not found: ${relativePath}`);
      continue;
    }
    if (Number.isFinite(declaredBytes) && declaredBytes > 0 && stat.size !== declaredBytes) {
      reject(
        "size_mismatch",
        `On-disk size ${stat.size} differs from manifest output_file_size ${declaredBytes}`
      );
      continue;
    }

    seenHashes.add(imageDataHash);
    candidates.push({
      relativePath,
      absolutePath,
      imageDataHash,
      event,
      filename,
      width,
      height,
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      people: normalizePeople(cell(row, "final_people"))
    });
  }

  // Pre-read stat snapshot: taken from the validation stats above, before any
  // source content is streamed, so a write during hashing or EXIF extraction
  // is detectable by the caller's end-of-run diff.
  onSourceStat?.(
    candidates.map((candidate) => ({
      path: candidate.absolutePath,
      size: candidate.bytes,
      mtimeMs: candidate.mtimeMs
    }))
  );

  const totalFiles = candidates.length;
  const totalBytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0);
  let filesDone = 0;
  let bytesDone = 0;

  const personNamesBySlug = new Map();
  const personCounts = new Map();
  const eventCounts = new Map();
  const metadataErrors = [];
  const photos = [];

  for (const candidate of candidates) {
    const fileSha256 = computeSha256 ? await sha256Stream(candidate.absolutePath) : "";
    const embedded = extractExif
      ? await readEmbeddedMetadata(candidate.absolutePath)
      : { capturedAt: null, keywords: [], orientation: null, error: null };
    if (embedded.error) {
      // Non-fatal: the photo imports with null/empty metadata, but the report
      // can now separate "metadata absent" from "metadata read failed".
      metadataErrors.push({ path: candidate.relativePath, message: embedded.error });
    }

    // Manifest width/height are ENCODED dimensions (exiftool ImageWidth /
    // ImageHeight ignore the Orientation tag). Derivatives are generated with
    // autoOrient, so the catalog and every derivative plan must use ORIENTED
    // (display) dimensions: swap for Orientation 5-8.
    const swap = orientationSwapsDimensions(embedded.orientation);
    const displayWidth = swap ? candidate.height : candidate.width;
    const displayHeight = swap ? candidate.width : candidate.height;

    const peopleSlugs = [];
    for (const name of candidate.people) {
      const slug = slugify(name);
      if (!slug) continue;
      peopleSlugs.push(slug);
      if (!personNamesBySlug.has(slug)) personNamesBySlug.set(slug, name);
      personCounts.set(slug, (personCounts.get(slug) ?? 0) + 1);
    }
    peopleSlugs.sort((a, b) => a.localeCompare(b));
    eventCounts.set(candidate.event, (eventCounts.get(candidate.event) ?? 0) + 1);

    const record = {
      id: candidate.imageDataHash,
      imageDataHash: candidate.imageDataHash,
      fileSha256,
      originalRelativePath: candidate.relativePath,
      originalFilename: candidate.filename,
      originalBytes: candidate.bytes,
      width: displayWidth,
      height: displayHeight,
      orientation: classifyOrientation(displayWidth, displayHeight),
      eventSlug: slugify(candidate.event),
      capturedAt: embedded.capturedAt,
      peopleSlugs,
      keywords: embedded.keywords,
      previewObjects: [],
      source: "photographer",
      status: "approved"
    };
    record.previewObjects = buildDerivativePlan(record).map((plan) => ({
      objectPath: plan.objectPath,
      width: plan.width,
      height: plan.height,
      format: plan.format,
      cacheControl: plan.cacheControl
    }));
    photos.push({ ...record, eventName: candidate.event });

    filesDone += 1;
    bytesDone += candidate.bytes;
    onProgress?.({ filesDone, totalFiles, bytesDone, totalBytes });
  }

  photos.sort((a, b) => {
    const eventDelta = eventSortIndex(a.eventName) - eventSortIndex(b.eventName);
    if (eventDelta !== 0) return eventDelta;
    if (a.eventName !== b.eventName) return a.eventName.localeCompare(b.eventName);
    return a.originalRelativePath.localeCompare(b.originalRelativePath, undefined, { numeric: true });
  });

  const events = [...eventCounts.entries()]
    .sort((a, b) => {
      const delta = eventSortIndex(a[0]) - eventSortIndex(b[0]);
      return delta !== 0 ? delta : a[0].localeCompare(b[0]);
    })
    .map(([name, photoCount], index) => ({
      name,
      slug: slugify(name),
      order: index,
      photoCount
    }));

  const people = [...personNamesBySlug.entries()]
    .map(([slug, name]) => ({ slug, name, photoCount: personCounts.get(slug) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    generatedAt: new Date().toISOString(),
    sourceRoot: root,
    photos: photos.map(({ eventName: _eventName, ...record }) => record),
    people,
    events,
    stats: {
      manifestRows: dataRows.length,
      importedPhotos: photos.length,
      rejectedRows: issues.length,
      people: people.length,
      events: events.length,
      totalOriginalBytes: totalBytes,
      issues,
      metadataErrors
    }
  };
}
