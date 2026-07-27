import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const sourceDir =
  process.env.SOURCE_PHOTO_DIR || "/Users/zsoskin/Rachel & Zach - Ali Beck Photography 2";
const outDir = join(rootDir, "metadata", "audit");
const excludedEvents = new Set(
  (process.env.GALLERY_EXCLUDE_EVENTS ?? "First Look")
    .split(",")
    .map((event) => event.trim())
    .filter(Boolean)
);

const ignoredKeywords = new Set(["Wedding", "Rachel & Zach"]);
const displayNameOverrides = new Map([
  ["Rach", "Rachel Casciano"],
  ["Rachel", "Rachel Casciano"],
  ["Zach", "Zach Soskin"]
]);

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

function normalizeName(value) {
  const decoded = decodeXml(value);
  return displayNameOverrides.get(decoded) || decoded;
}

function isUsefulName(value) {
  if (!value || ignoredKeywords.has(value)) return false;
  if (/^\d+([.,]\s*\d+)*$/.test(value)) return false;
  if (value.length > 60) return false;
  return true;
}

function extractSection(xml, tag) {
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "i");
  return xml.match(expression)?.[0] || "";
}

function extractListItems(xml) {
  return [...xml.matchAll(/<rdf:li(?:\s[^>]*)?>([^<]+)<\/rdf:li>/gi)].map((match) => decodeXml(match[1]));
}

function extractPeople(buffer) {
  const xml = buffer.toString("latin1");
  const names = new Set();

  for (const match of xml.matchAll(/mwg-rs:Name="([^"]+)"/gi)) {
    names.add(decodeXml(match[1]));
  }

  for (const tag of ["dc:subject", "lr:weightedFlatSubject", "lr:hierarchicalSubject"]) {
    const section = extractSection(xml, tag);
    for (const item of extractListItems(section)) {
      if (!ignoredKeywords.has(item)) names.add(item);
    }
  }

  return [...new Set([...names].map(normalizeName).filter(isUsefulName))].sort((a, b) => a.localeCompare(b));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values) {
  return `${values.map(csvEscape).join(",")}\n`;
}

async function listPhotos() {
  const events = (await fs.readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !excludedEvents.has(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const photos = [];
  for (const event of events) {
    const eventDir = join(sourceDir, event);
    const files = (await fs.readdir(eventDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.(jpe?g)$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (const file of files) {
      const sourcePath = join(eventDir, file);
      photos.push({
        event,
        file,
        sourcePath,
        relativePath: relative(sourceDir, sourcePath)
      });
    }
  }
  return photos;
}

async function makeContactSheet(batch, index) {
  const sheetPath = join(outDir, "review-sheets", `missing-people-${String(index + 1).padStart(2, "0")}.jpg`);
  await fs.mkdir(dirname(sheetPath), { recursive: true });
  const inputs = batch.flatMap((photo) => ["-label", photo.relativePath, photo.sourcePath]);
  await run("magick", [
    "montage",
    ...inputs,
    "-auto-orient",
    "-thumbnail",
    "280x280>",
    "-background",
    "#f7f3ed",
    "-fill",
    "#27231e",
    "-font",
    "/System/Library/Fonts/Helvetica.ttc",
    "-pointsize",
    "10",
    "-geometry",
    "280x330+10+12",
    "-tile",
    "4x",
    sheetPath
  ]);
  return sheetPath;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const photos = await listPhotos();
  const folderCounts = new Map();
  const personCounts = new Map();
  const missing = [];
  const rows = [];

  rows.push(csvRow(["path", "event", "filename", "people_count", "people"]));

  for (const photo of photos) {
    const people = extractPeople(await fs.readFile(photo.sourcePath));
    const folder = folderCounts.get(photo.event) || { total: 0, tagged: 0 };
    folder.total += 1;
    if (people.length) folder.tagged += 1;
    folderCounts.set(photo.event, folder);

    for (const person of people) {
      personCounts.set(person, (personCounts.get(person) || 0) + 1);
    }

    if (!people.length) missing.push(photo);
    rows.push(csvRow([photo.relativePath, photo.event, photo.file, people.length, people.join("; ")]));
  }

  await fs.writeFile(join(outDir, "photo-people-audit.csv"), rows.join(""));

  const folderRows = [csvRow(["event", "tagged", "total", "coverage_pct"])];
  for (const [event, counts] of [...folderCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    folderRows.push(csvRow([event, counts.tagged, counts.total, ((counts.tagged / counts.total) * 100).toFixed(1)]));
  }
  await fs.writeFile(join(outDir, "folder-coverage.csv"), folderRows.join(""));

  const peopleRows = [csvRow(["person", "photo_count"])];
  for (const [person, count] of [...personCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    peopleRows.push(csvRow([person, count]));
  }
  await fs.writeFile(join(outDir, "people-counts.csv"), peopleRows.join(""));

  const missingRows = [csvRow(["path", "event", "filename", "suggested_action", "people", "notes"])];
  for (const photo of missing) {
    missingRows.push(csvRow([photo.relativePath, photo.event, photo.file, "", "", ""]));
  }
  await fs.writeFile(join(outDir, "missing-people-review.csv"), missingRows.join(""));

  const reviewBatches = [];
  const batchSize = Number(process.env.AUDIT_CONTACT_SHEET_BATCH || 24);
  for (let index = 0; index < missing.length; index += batchSize) {
    const batch = missing.slice(index, index + batchSize);
    const sheetPath = await makeContactSheet(batch, reviewBatches.length);
    reviewBatches.push({
      sheet: relative(rootDir, sheetPath),
      photos: batch.map((photo) => photo.relativePath)
    });
  }
  await fs.writeFile(join(outDir, "review-batches.json"), `${JSON.stringify(reviewBatches, null, 2)}\n`);

  console.log(`Audited ${photos.length} public photos. Missing people metadata: ${missing.length}.`);
  console.log(`Wrote ${relative(rootDir, outDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
