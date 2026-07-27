import { promises as fs } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyCorrection,
  csvRow,
  extractMetadata,
  parseCsv,
  readCorrections,
  slugify
} from "./lib/photo-metadata.mjs";

const rootDir = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const sourceDir =
  process.env.SOURCE_PHOTO_DIR || "/Users/zsoskin/Rachel & Zach - Ali Beck Photography 2";
const correctionsFile = join(rootDir, "metadata", "people-corrections.csv");
const agentReviewsDir = join(rootDir, "metadata", "agent-reviews");
const outDir = join(rootDir, "metadata", "sorted");
const excludedEvents = new Set(
  (process.env.GALLERY_EXCLUDE_EVENTS ?? "First Look")
    .split(",")
    .map((event) => event.trim())
    .filter(Boolean)
);
const makeSymlinks = process.env.SORT_SYMLINKS !== "0";

const eventOrder = [
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

function photoNumber(filename) {
  const match = filename.match(/(\d+)(?=\.[^.]+$)/);
  return match ? Number(match[1]) : null;
}

async function listPhotos() {
  const folders = (await fs.readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !excludedEvents.has(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const aIndex = eventOrder.indexOf(a);
      const bIndex = eventOrder.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

  const photos = [];
  for (const folder of folders) {
    const folderPath = join(sourceDir, folder);
    const files = (await fs.readdir(folderPath, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.(jpe?g)$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => {
        const aNumber = photoNumber(a) ?? Number.MAX_SAFE_INTEGER;
        const bNumber = photoNumber(b) ?? Number.MAX_SAFE_INTEGER;
        if (aNumber !== bNumber) return aNumber - bNumber;
        return a.localeCompare(b);
      });

    for (const file of files) {
      const sourcePath = join(folderPath, file);
      photos.push({
        event: folder,
        filename: file,
        sourcePath,
        relativePath: relative(sourceDir, sourcePath)
      });
    }
  }
  return photos;
}

async function replaceDir(path) {
  await fs.rm(path, { recursive: true, force: true });
  await fs.mkdir(path, { recursive: true });
}

async function safeSymlink(target, linkPath) {
  await fs.mkdir(dirname(linkPath), { recursive: true });
  await fs.rm(linkPath, { force: true });
  await fs.symlink(target, linkPath);
}

async function readAgentReviewNotes() {
  const reviews = new Map();
  const files = (await fs.readdir(agentReviewsDir).catch(() => []))
    .filter((file) => /^sheets-\d{2}-\d{2}\.csv$/.test(file))
    .sort();

  for (const file of files) {
    const text = await fs.readFile(join(agentReviewsDir, file), "utf8");
    const [headers, ...rows] = parseCsv(text);
    const headerIndex = new Map(headers.map((header, index) => [header.trim(), index]));

    for (const row of rows) {
      const path = row[headerIndex.get("path")]?.trim();
      if (!path) continue;

      reviews.set(path, {
        recommendation: row[headerIndex.get("recommendation")] || "",
        confidence: row[headerIndex.get("confidence")] || "",
        notes: row[headerIndex.get("notes")] || "",
        file
      });
    }
  }

  return reviews;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  if (makeSymlinks) {
    await replaceDir(join(outDir, "by-person"));
    await replaceDir(join(outDir, "unconfirmed"));
    await replaceDir(join(outDir, "no-person"));
  }

  const corrections = await readCorrections(correctionsFile);
  const agentReviewNotes = await readAgentReviewNotes();
  const photos = await listPhotos();
  const personRows = [csvRow(["person", "path", "event", "filename", "source", "notes"])];
  const photoRows = [csvRow(["path", "event", "filename", "people", "status", "correction_action", "notes"])];
  const unconfirmedRows = [csvRow(["path", "event", "filename", "reason", "agent_status", "notes"])];
  const peopleCounts = new Map();
  const statusCounts = new Map();

  for (const photo of photos) {
    const correction = corrections.get(photo.relativePath);
    if (correction?.action === "exclude") continue;

    const metadata = extractMetadata(await fs.readFile(photo.sourcePath));
    const embeddedPeople = metadata.people;
    const people = applyCorrection(embeddedPeople, correction);
    const status = people.length
      ? (correction?.action === "replace" || correction?.action === "add" ? "corrected_people" : "confirmed_people")
      : correction?.action === "ignore"
        ? "reviewed_no_person"
        : "unconfirmed";

    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    photoRows.push(csvRow([
      photo.relativePath,
      photo.event,
      photo.filename,
      people.join("; "),
      status,
      correction?.action || "",
      correction?.notes || ""
    ]));

    if (people.length) {
      for (const person of people) {
        peopleCounts.set(person, (peopleCounts.get(person) || 0) + 1);
        personRows.push(csvRow([
          person,
          photo.relativePath,
          photo.event,
          photo.filename,
          correction ? "correction_or_metadata" : "embedded_metadata",
          correction?.notes || ""
        ]));

        if (makeSymlinks) {
          const linkName = `${slugify(photo.event)}-${slugify(photo.filename)}`;
          await safeSymlink(photo.sourcePath, join(outDir, "by-person", slugify(person), linkName));
        }
      }
    } else if (status === "reviewed_no_person") {
      if (makeSymlinks) {
        const linkName = `${slugify(photo.event)}-${slugify(photo.filename)}`;
        await safeSymlink(photo.sourcePath, join(outDir, "no-person", linkName));
      }
    } else {
      unconfirmedRows.push(csvRow([
        photo.relativePath,
        photo.event,
        photo.filename,
        embeddedPeople.length ? "metadata_removed_by_correction" : "missing_people_metadata",
        agentReviewNotes.get(photo.relativePath)?.recommendation || "",
        agentReviewNotes.get(photo.relativePath)?.notes || correction?.notes || ""
      ]));

      if (makeSymlinks) {
        const linkName = `${slugify(photo.event)}-${slugify(photo.filename)}`;
        await safeSymlink(photo.sourcePath, join(outDir, "unconfirmed", linkName));
      }
    }
  }

  const peopleSummaryRows = [csvRow(["person", "photo_count"])];
  for (const [person, count] of [...peopleCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    peopleSummaryRows.push(csvRow([person, count]));
  }

  const statusRows = [csvRow(["status", "photo_count"])];
  for (const [status, count] of [...statusCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    statusRows.push(csvRow([status, count]));
  }

  await fs.writeFile(join(outDir, "person-photo-manifest.csv"), personRows.join(""));
  await fs.writeFile(join(outDir, "photo-status-manifest.csv"), photoRows.join(""));
  await fs.writeFile(join(outDir, "people-summary.csv"), peopleSummaryRows.join(""));
  await fs.writeFile(join(outDir, "unconfirmed-review-queue.csv"), unconfirmedRows.join(""));
  await fs.writeFile(join(outDir, "status-summary.csv"), statusRows.join(""));

  console.log(`Sorted ${photos.length} public photos into ${relative(rootDir, outDir)}`);
  for (const [status, count] of [...statusCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`${status}: ${count}`);
  }
  console.log(`People folders: ${peopleCounts.size}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
