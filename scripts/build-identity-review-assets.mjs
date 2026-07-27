import { execFile } from "node:child_process";
import { cpus } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import {
  csvEscape,
  csvRow,
  parseCsv,
  slugify
} from "./lib/photo-metadata.mjs";

const rootDir = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const sourceDir =
  process.env.SOURCE_PHOTO_DIR || "/Users/zsoskin/Rachel & Zach - Ali Beck Photography 2";
const queueFile = join(rootDir, "metadata", "sorted", "unconfirmed-review-queue.csv");
const personManifestFile = join(rootDir, "metadata", "sorted", "person-photo-manifest.csv");
const photoStatusFile = join(rootDir, "metadata", "sorted", "photo-status-manifest.csv");
const outDir = join(rootDir, "metadata", "identity-review");
const concurrency = Math.max(1, Math.min(Number(process.env.IDENTITY_REVIEW_CONCURRENCY || 4), cpus().length - 2));
const partialReviewMinFaceArea = Number(process.env.PARTIAL_REVIEW_MIN_FACE_AREA || 0.0075);

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}\n${stderr}`;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function mapLimit(items, limit, worker) {
  let index = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (index < items.length) {
      const itemIndex = index;
      index += 1;
      await worker(items[itemIndex], itemIndex);
    }
  });
  await Promise.all(workers);
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRegionAttributes(text) {
  const attributes = {};
  for (const match of text.matchAll(/([\w-]+:[\w-]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeXml(match[2]);
  }
  return attributes;
}

function parseFaceRegions(buffer) {
  const xml = buffer.toString("latin1");
  const dimensionsMatch = xml.match(/mwg-rs:AppliedToDimensions[^>]*stDim:w="([\d.]+)"[^>]*stDim:h="([\d.]+)"/i);
  const appliedWidth = dimensionsMatch ? Number(dimensionsMatch[1]) : null;
  const appliedHeight = dimensionsMatch ? Number(dimensionsMatch[2]) : null;
  if (!appliedWidth || !appliedHeight) return [];

  const regions = [];
  const descriptionPattern = /<rdf:Description\b([^>]*)>\s*<mwg-rs:Area\b([^>]*)\/>\s*<\/rdf:Description>/gi;
  for (const match of xml.matchAll(descriptionPattern)) {
    const description = parseRegionAttributes(match[1]);
    if (description["mwg-rs:Type"] !== "Face") continue;
    const area = parseRegionAttributes(match[2]);
    const width = Number(area["stArea:w"]);
    const height = Number(area["stArea:h"]);
    const centerX = Number(area["stArea:x"]);
    const centerY = Number(area["stArea:y"]);
    if (![width, height, centerX, centerY].every(Number.isFinite)) continue;
    regions.push({
      name: description["mwg-rs:Name"] || "",
      appliedWidth,
      appliedHeight,
      width,
      height,
      centerX,
      centerY,
      area: width * height
    });
  }
  return regions;
}

function cropGeometry(region, expand = 2.15) {
  const faceWidth = region.width * region.appliedWidth;
  const faceHeight = region.height * region.appliedHeight;
  const centerX = region.centerX * region.appliedWidth;
  const centerY = region.centerY * region.appliedHeight;
  const size = Math.max(faceWidth, faceHeight) * expand;
  const cropSize = Math.max(64, Math.round(size));
  const x = Math.max(0, Math.round(centerX - cropSize / 2));
  const y = Math.max(0, Math.round(centerY - cropSize / 2));
  const width = Math.min(cropSize, Math.round(region.appliedWidth - x));
  const height = Math.min(cropSize, Math.round(region.appliedHeight - y));
  return `${width}x${height}+${x}+${y}`;
}

function faceBox(region) {
  const x = Math.max(0, region.centerX - region.width / 2);
  const y = Math.max(0, region.centerY - region.height / 2);
  const width = Math.min(region.width, 1 - x);
  const height = Math.min(region.height, 1 - y);
  return {
    x,
    y,
    width,
    height,
    appliedWidth: region.appliedWidth,
    appliedHeight: region.appliedHeight,
    area: region.area
  };
}

function faceBoxFields(region) {
  if (!region) return ["", "", "", "", "", "", ""];
  const box = faceBox(region);
  return [
    box.x.toFixed(6),
    box.y.toFixed(6),
    box.width.toFixed(6),
    box.height.toFixed(6),
    String(Math.round(box.appliedWidth)),
    String(Math.round(box.appliedHeight)),
    box.area.toFixed(6)
  ];
}

async function readCsv(path) {
  const text = await fs.readFile(path, "utf8");
  const [headers, ...rows] = parseCsv(text);
  const headerIndex = new Map(headers.map((header, index) => [header.trim(), index]));
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header.trim(), row[index] || ""]))).filter(Boolean);
}

function photoId(relativePath, suffix = "") {
  const parsed = relativePath.replace(extname(relativePath), "");
  return `${slugify(parsed)}${suffix}`;
}

async function cropFace(input, output, region, size = "260x260") {
  await fs.mkdir(dirname(output), { recursive: true });
  await run("magick", [
    input,
    "-crop",
    cropGeometry(region),
    "+repage",
    "-auto-orient",
    "-resize",
    `${size}>`,
    "-strip",
    output
  ]);
}

async function makeMontage(inputs, output, options = {}) {
  await fs.mkdir(dirname(output), { recursive: true });
  if (!inputs.length) return;
  const args = inputs.flatMap((item) => ["-label", item.label, item.path]);
  await run("magick", [
    "montage",
    ...args,
    "-auto-orient",
    "-thumbnail",
    options.thumbnail || "300x300>",
    "-background",
    "#f7f3ed",
    "-fill",
    "#27231e",
    "-font",
    "/System/Library/Fonts/Helvetica.ttc",
    "-pointsize",
    options.pointSize || "10",
    "-geometry",
    options.geometry || "300x348+10+12",
    "-tile",
    options.tile || "4x",
    output
  ]);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  for (const generatedPath of [
    "reference-crops",
    "reference-people",
    "reference-sheets",
    "partial-crops",
    "partial-sheets",
    "unresolved-crops",
    "unresolved-sheets",
    "partial-crops.csv",
    "people-reference-index.csv",
    "reference-crops.csv",
    "unresolved-crops.csv"
  ]) {
    await fs.rm(join(outDir, generatedPath), { recursive: true, force: true });
  }

  const queue = await readCsv(queueFile);
  const personRows = await readCsv(personManifestFile);
  const photoStatusRows = await readCsv(photoStatusFile);
  const sourceByPerson = new Map();
  for (const row of personRows) {
    if (!row.person || !row.path) continue;
    const list = sourceByPerson.get(row.person) || [];
    list.push(row.path);
    sourceByPerson.set(row.person, list);
  }

  const unresolvedCropRows = [csvRow([
    "review_id",
    "path",
    "face_index",
    "crop",
    "box_x",
    "box_y",
    "box_w",
    "box_h",
    "applied_w",
    "applied_h",
    "area",
    "notes"
  ])];
  const unresolvedMontageInputs = [];

  await mapLimit(queue, concurrency, async (row, index) => {
    const sourcePath = join(sourceDir, row.path);
    const buffer = await fs.readFile(sourcePath);
    const regions = parseFaceRegions(buffer).filter((region) => !region.name);
    const reviewId = String(index + 1).padStart(3, "0");

    if (!regions.length) {
      const output = join(outDir, "unresolved-crops", `${reviewId}-${photoId(row.path)}--full.jpg`);
      await fs.mkdir(dirname(output), { recursive: true });
      await run("magick", [sourcePath, "-auto-orient", "-resize", "520x520>", "-strip", output]);
      unresolvedCropRows.push(csvRow([
        reviewId,
        row.path,
        "full",
        relative(rootDir, output),
        ...faceBoxFields(null),
        row.notes || "no Lightroom face box"
      ]));
      unresolvedMontageInputs.push({ path: output, label: `${reviewId} full\n${row.path}\n${row.notes || ""}` });
      return;
    }

    for (const [regionIndex, region] of regions.entries()) {
      const faceIndex = String(regionIndex + 1).padStart(2, "0");
      const output = join(outDir, "unresolved-crops", `${reviewId}-${photoId(row.path, `--face-${faceIndex}`)}.jpg`);
      await cropFace(sourcePath, output, region, "280x280");
      unresolvedCropRows.push(csvRow([
        reviewId,
        row.path,
        faceIndex,
        relative(rootDir, output),
        ...faceBoxFields(region),
        row.notes || ""
      ]));
      unresolvedMontageInputs.push({ path: output, label: `${reviewId}.${faceIndex}\n${row.path}\n${row.notes || ""}` });
    }
  });

  const referenceRows = [csvRow(["person", "path", "face_index", "crop", "area"])];
  const people = [...sourceByPerson.keys()].sort((a, b) => a.localeCompare(b));
  const personSheetInputs = [];

  await mapLimit(people, concurrency, async (person) => {
    const candidates = [];
    const paths = [...new Set(sourceByPerson.get(person) || [])];
    for (const path of paths) {
      if (candidates.length >= 12) break;
      const sourcePath = join(sourceDir, path);
      const buffer = await fs.readFile(sourcePath).catch(() => null);
      if (!buffer) continue;
      const regions = parseFaceRegions(buffer)
        .map((region, index) => ({ ...region, index }))
        .filter((region) => region.name === person)
        .sort((a, b) => b.area - a.area);
      for (const region of regions.slice(0, 2)) {
        candidates.push({ path, sourcePath, region });
      }
    }

    const selected = candidates
      .sort((a, b) => b.region.area - a.region.area)
      .slice(0, 6);
    if (!selected.length) return;

    const personInputs = [];
    for (const [index, item] of selected.entries()) {
      const faceIndex = String(index + 1).padStart(2, "0");
      const output = join(outDir, "reference-crops", slugify(person), `${faceIndex}-${photoId(item.path)}.jpg`);
      await cropFace(item.sourcePath, output, item.region, "220x220");
      referenceRows.push(csvRow([person, item.path, faceIndex, relative(rootDir, output), item.region.area.toFixed(6)]));
      personInputs.push({ path: output, label: `${person}\n${item.path}` });
    }

    const personSheet = join(outDir, "reference-people", `${slugify(person)}.jpg`);
    await makeMontage(personInputs, personSheet, {
      thumbnail: "190x190>",
      geometry: "190x232+8+10",
      tile: "3x",
      pointSize: "9"
    });
    personSheetInputs.push({ person, path: personSheet, label: `${person}\n${selected.length} refs` });
  });

  await fs.writeFile(join(outDir, "unresolved-crops.csv"), unresolvedCropRows.join(""));

  const partialCropRows = [csvRow([
    "review_id",
    "path",
    "face_index",
    "crop",
    "existing_people",
    "box_x",
    "box_y",
    "box_w",
    "box_h",
    "applied_w",
    "applied_h",
    "area",
    "notes"
  ])];
  const partialMontageInputs = [];
  let partialReviewIndex = 0;
  const partialCandidates = photoStatusRows
    .filter((row) => row.status === "confirmed_people")
    .filter((row) => row.people?.trim());

  await mapLimit(partialCandidates, concurrency, async (row) => {
    const sourcePath = join(sourceDir, row.path);
    const buffer = await fs.readFile(sourcePath).catch(() => null);
    if (!buffer) return;
    const regions = parseFaceRegions(buffer)
      .map((region, index) => ({ ...region, index }))
      .filter((region) => !region.name && region.area >= partialReviewMinFaceArea)
      .sort((a, b) => b.area - a.area);
    for (const region of regions) {
      partialReviewIndex += 1;
      const reviewId = `P${String(partialReviewIndex).padStart(3, "0")}`;
      const faceIndex = String(region.index + 1).padStart(2, "0");
      const output = join(outDir, "partial-crops", `${reviewId}-${photoId(row.path, `--face-${faceIndex}`)}.jpg`);
      await cropFace(sourcePath, output, region, "280x280");
      partialCropRows.push(csvRow([
        reviewId,
        row.path,
        faceIndex,
        relative(rootDir, output),
        row.people || "",
        ...faceBoxFields(region),
        "tagged photo has an additional visible unnamed face"
      ]));
      partialMontageInputs.push({
        path: output,
        label: `${reviewId}.${faceIndex}\n${row.path}\nTagged: ${row.people || ""}`
      });
    }
  });

  await fs.writeFile(join(outDir, "partial-crops.csv"), partialCropRows.join(""));
  await fs.writeFile(join(outDir, "reference-crops.csv"), referenceRows.join(""));

  for (let index = 0; index < unresolvedMontageInputs.length; index += 16) {
    const batch = unresolvedMontageInputs.slice(index, index + 16);
    const sheetNumber = String(index / 16 + 1).padStart(2, "0");
    await makeMontage(batch, join(outDir, "unresolved-sheets", `unresolved-${sheetNumber}.jpg`), {
      thumbnail: "300x300>",
      geometry: "300x360+10+12",
      tile: "4x",
      pointSize: "9"
    });
  }

  for (let index = 0; index < partialMontageInputs.length; index += 16) {
    const batch = partialMontageInputs.slice(index, index + 16);
    const sheetNumber = String(index / 16 + 1).padStart(2, "0");
    await makeMontage(batch, join(outDir, "partial-sheets", `partial-${sheetNumber}.jpg`), {
      thumbnail: "300x300>",
      geometry: "300x370+10+12",
      tile: "4x",
      pointSize: "9"
    });
  }

  const sortedPersonSheets = personSheetInputs.sort((a, b) => a.person.localeCompare(b.person));
  for (let index = 0; index < sortedPersonSheets.length; index += 20) {
    const batch = sortedPersonSheets.slice(index, index + 20);
    const sheetNumber = String(index / 20 + 1).padStart(2, "0");
    await makeMontage(batch, join(outDir, "reference-sheets", `references-${sheetNumber}.jpg`), {
      thumbnail: "230x230>",
      geometry: "230x274+10+12",
      tile: "4x",
      pointSize: "10"
    });
  }

  const peopleIndexRows = [csvRow(["person", "sheet"])];
  for (const item of sortedPersonSheets) {
    peopleIndexRows.push(csvRow([item.person, relative(rootDir, item.path)]));
  }
  await fs.writeFile(join(outDir, "people-reference-index.csv"), peopleIndexRows.join(""));

  console.log(`Built identity review assets for ${queue.length} queued photos.`);
  console.log(`Unresolved crop tiles: ${unresolvedMontageInputs.length}.`);
  console.log(`Partial tagged-photo crop tiles: ${partialMontageInputs.length} at min face area ${partialReviewMinFaceArea}.`);
  console.log(`Reference people with crops: ${sortedPersonSheets.length}.`);
  console.log(`Wrote ${relative(rootDir, outDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
