#!/usr/bin/env node
// Read-only importer for the Wedding Master Clean archive.
//
// Modes:
//   node scripts/build-gallery-v2.mjs --verify-only
//     Validates the manifest against the current source bytes: parses the CSV,
//     streams SHA-256 for every photo, re-verifies image_data_hash via
//     exiftool, confirms zero source writes, and emits the catalog + report.
//     Writes NO derivatives.
//   node scripts/build-gallery-v2.mjs
//     Everything above plus derivative generation (staged, verified, atomic),
//     with fileSha256 and imageDataHash re-verified after generation. Any
//     source change aborts the run.
//
// The source tree is never opened for writing. image_data_hash provenance:
// exiftool -ImageDataHash (default ImageHashType=MD5) over image data,
// excluding metadata -- discovered in scripts/prepare-clean-master.py and
// re-verified per file when exiftool is available.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  loadCleanMasterManifest,
  sha256Stream,
  EXCLUDED_DIRECTORIES
} from "./lib/clean-master-manifest.mjs";
import { applyTrackedCatalogOverlays } from "./lib/catalog-overlays.mjs";
import { generateDerivatives } from "./lib/image-derivatives.mjs";

const execFileAsync = promisify(execFile);

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_SOURCE_ROOT =
  process.env.WEDDING_MASTER_ROOT ||
  "/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean";

function parseArgs(argv) {
  const args = {
    verifyOnly: false,
    sourceRoot: DEFAULT_SOURCE_ROOT,
    catalogOut: join(repoRoot, "src", "generated", "gallery-v2.json"),
    reportOut: join(repoRoot, "metadata", "import", "gallery-import-report.json"),
    derivativesRoot: join(repoRoot, "metadata", "import", "derivatives"),
    skipImageHashVerify: false,
    incremental: false,
    limit: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--verify-only") args.verifyOnly = true;
    else if (arg === "--skip-image-hash-verify") args.skipImageHashVerify = true;
    else if (arg === "--incremental") args.incremental = true;
    else if (arg === "--source-root") args.sourceRoot = argv[++index];
    else if (arg === "--catalog-out") args.catalogOut = argv[++index];
    else if (arg === "--report-out") args.reportOut = argv[++index];
    else if (arg === "--derivatives-dir") args.derivativesRoot = argv[++index];
    else if (arg === "--limit") args.limit = Number(argv[++index]);
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: build-gallery-v2.mjs [--verify-only] [--incremental] [--source-root <dir>] " +
          "[--derivatives-dir <dir>] [--catalog-out <file>] [--report-out <file>] " +
          "[--skip-image-hash-verify] [--limit <n>]"
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

function formatGiB(bytes) {
  return (bytes / 1024 ** 3).toFixed(2);
}

function makeProgressPrinter(label) {
  const interactive = process.stdout.isTTY;
  let lastPrinted = 0;
  return ({ filesDone, totalFiles, bytesDone, totalBytes }) => {
    const finished = filesDone === totalFiles;
    const shouldPrint = interactive
      ? finished || filesDone - lastPrinted >= 10
      : finished || filesDone - lastPrinted >= 100;
    if (!shouldPrint) return;
    lastPrinted = filesDone;
    const percent = totalBytes > 0 ? Math.round((bytesDone / totalBytes) * 100) : 100;
    const line =
      `${label} ${filesDone}/${totalFiles} files, ` +
      `${formatGiB(bytesDone)}/${formatGiB(totalBytes)} GiB (${percent}%)`;
    if (interactive) {
      process.stdout.write(`\r${line}${finished ? "\n" : ""}`);
    } else {
      console.log(line);
    }
  };
}

async function statSnapshot(paths) {
  const snapshot = new Map();
  for (const path of paths) {
    const stat = await fs.stat(path);
    snapshot.set(path, { size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return snapshot;
}

function diffSnapshots(before, after) {
  const changes = [];
  for (const [path, prev] of before) {
    const next = after.get(path);
    if (!next || next.size !== prev.size || next.mtimeMs !== prev.mtimeMs) {
      changes.push(path);
    }
  }
  return changes;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function detectExiftool() {
  try {
    const { stdout } = await execFileAsync("exiftool", ["-ver"]);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function exiftoolImageHashes(paths, onBatch) {
  const hashes = new Map();
  const errors = [];
  const batches = chunk(paths, 160);
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    let stdout = "";
    try {
      // -api ImageHashType=MD5 pins the algorithm so a user-level
      // .ExifTool_config cannot silently change what is being compared.
      ({ stdout } = await execFileAsync(
        "exiftool",
        ["-json", "-ImageDataHash", "-api", "ImageHashType=MD5", "-charset", "filename=UTF8", ...batch],
        { maxBuffer: 1024 * 1024 * 64 }
      ));
    } catch (error) {
      // exiftool exits nonzero when ANY file in the batch errors, but still
      // prints JSON for the files it processed. Keep those results; files that
      // are missing from them surface individually as unverified/mismatched.
      stdout = typeof error?.stdout === "string" ? error.stdout : "";
      errors.push({
        batch: index + 1,
        message: String(error?.stderr || error?.message || error).trim().slice(0, 500)
      });
    }
    if (stdout.trim()) {
      try {
        for (const record of JSON.parse(stdout)) {
          hashes.set(record.SourceFile, String(record.ImageDataHash ?? "").toLowerCase());
        }
      } catch {
        // Unparseable batch output: its files simply stay unverified and are
        // reported per file by the caller.
      }
    }
    onBatch?.(index + 1, batches.length);
  }
  return { hashes, errors };
}

async function writeJson(path, value) {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.verifyOnly ? "verify-only" : "full-import";
  console.log(`build-gallery-v2 (${mode})`);
  console.log(`Source root (read-only): ${args.sourceRoot}`);

  // Read the manifest ONCE: the recorded manifestSha256 describes the exact
  // bytes the loader parses (no second read, no TOCTOU gap).
  const manifestPath = join(args.sourceRoot, "_Metadata", "photo-manifest.csv");
  const manifestBuffer = await fs.readFile(manifestPath);
  const manifestSha256 = createHash("sha256").update(manifestBuffer).digest("hex");

  // Pass 1: manifest validation, streaming SHA-256, embedded EXIF/XMP.
  // The pre-read stat snapshot is captured INSIDE the loader, during row
  // validation and before any source content is streamed, so the end-of-run
  // diff covers the hashing/EXIF pass too.
  let preStat = null;
  const catalog = await loadCleanMasterManifest(args.sourceRoot, {
    manifestText: manifestBuffer.toString("utf8"),
    onProgress: makeProgressPrinter("verify"),
    onSourceStat: (entries) => {
      preStat = new Map(
        entries.map((entry) => [entry.path, { size: entry.size, mtimeMs: entry.mtimeMs }])
      );
    }
  });
  const catalogOverlays = await applyTrackedCatalogOverlays(catalog, repoRoot);
  if (Number.isInteger(args.limit) && args.limit > 0) {
    catalog.photos = catalog.photos.slice(0, args.limit);
  }

  const absolutePaths = catalog.photos.map((photo) =>
    join(args.sourceRoot, photo.originalRelativePath)
  );
  if (!preStat) {
    preStat = await statSnapshot(absolutePaths);
  }

  // Provenance: scripts/prepare-clean-master.py generated image_data_hash with
  // exiftool -ImageDataHash (default ImageHashType = MD5 over image data,
  // excluding metadata). Reproducible, so verify it directly when exiftool exists.
  const exiftoolVersion = args.skipImageHashVerify ? null : await detectExiftool();
  let imageHashMismatches = [];
  let imageHashErrors = [];
  let imageHashVerified = 0;
  let imageHashDecision;
  if (exiftoolVersion) {
    imageHashDecision =
      "reproducible: exiftool ImageDataHash (ImageHashType=MD5) over image data; " +
      "re-computed for every photo and compared against the manifest";
    console.log(`Re-verifying image_data_hash with exiftool ${exiftoolVersion}...`);
    const { hashes: hashesByPath, errors: batchErrors } = await exiftoolImageHashes(
      absolutePaths,
      (done, total) => {
        console.log(`image-hash batch ${done}/${total}`);
      }
    );
    imageHashErrors = batchErrors;
    for (const photo of catalog.photos) {
      const absolute = join(args.sourceRoot, photo.originalRelativePath);
      const computed = hashesByPath.get(absolute);
      if (computed === photo.imageDataHash) {
        imageHashVerified += 1;
      } else {
        imageHashMismatches.push({
          path: photo.originalRelativePath,
          manifest: photo.imageDataHash,
          computed: computed ?? null
        });
      }
    }
  } else {
    imageHashDecision = args.skipImageHashVerify
      ? "skipped by flag: image_data_hash treated as opaque stable identity; integrity via fileSha256 only"
      : "exiftool unavailable: image_data_hash treated as opaque stable identity; integrity via fileSha256 only";
    console.log(imageHashDecision);
  }

  // Derivative generation (full mode only). Staged, verified, atomic; then the
  // source is re-hashed and any change aborts the run.
  let derivativesGenerated = 0;
  let derivativesReused = 0;
  let derivativeBytes = 0;
  if (!args.verifyOnly) {
    console.log(
      `Generating derivatives into ${args.derivativesRoot}` +
        (args.incremental ? " (incremental: verified existing outputs are reused)" : "")
    );
    let done = 0;
    for (const photo of catalog.photos) {
      const absolute = join(args.sourceRoot, photo.originalRelativePath);
      const { objects, reused } = await generateDerivatives(photo, absolute, args.derivativesRoot, {
        incremental: args.incremental
      });
      photo.previewObjects = objects.map(({ bytes: _bytes, ...object }) => object);
      derivativesGenerated += objects.length - reused;
      derivativesReused += reused;
      derivativeBytes += objects.reduce((sum, object) => sum + object.bytes, 0);
      done += 1;
      if (done % 25 === 0 || done === catalog.photos.length) {
        console.log(`derivatives ${done}/${catalog.photos.length} photos`);
      }
      const postSha = await sha256Stream(absolute);
      if (postSha !== photo.fileSha256) {
        throw new Error(
          `ABORT: fileSha256 changed for ${photo.originalRelativePath} during derivative generation`
        );
      }
    }
    if (exiftoolVersion) {
      console.log("Re-verifying image_data_hash after derivative generation...");
      const { hashes: postHashes, errors: postErrors } = await exiftoolImageHashes(
        absolutePaths,
        () => {}
      );
      imageHashErrors.push(...postErrors);
      for (const photo of catalog.photos) {
        const absolute = join(args.sourceRoot, photo.originalRelativePath);
        if (!postHashes.has(absolute)) {
          // A per-file exiftool error left this file unverified in the post
          // pass; report it instead of mistaking a gap for a source change.
          console.warn(
            `WARN: post-generation image_data_hash unavailable for ${photo.originalRelativePath}`
          );
          imageHashErrors.push({
            file: photo.originalRelativePath,
            message: "post-generation ImageDataHash unavailable (exiftool error); file unverified"
          });
          continue;
        }
        if (postHashes.get(absolute) !== photo.imageDataHash) {
          throw new Error(
            `ABORT: image_data_hash changed for ${photo.originalRelativePath} during derivative generation`
          );
        }
      }
    }
  }

  // Source-write detection: size+mtime for every photo must be unchanged
  // across the whole run (pre-read snapshot taken before pass 1 hashing).
  // With --limit, diff only the paths that stayed in scope.
  const postStat = await statSnapshot(absolutePaths);
  const preStatInScope = new Map(
    absolutePaths.map((path) => [path, preStat.get(path)]).filter(([, value]) => value)
  );
  const statChanges = diffSnapshots(preStatInScope, postStat);

  // duplicateIds counts duplicates present in the EMITTED catalog only.
  // Rows the loader rejected for duplicate_hash never reached the catalog;
  // they are reported separately as duplicatesRejected and do not gate.
  const uniqueIds = new Set(catalog.photos.map((photo) => photo.id));
  const duplicateIds = catalog.photos.length - uniqueIds.size;
  const duplicatesRejected = catalog.stats.issues.filter(
    (issue) => issue.type === "duplicate_hash"
  ).length;

  const report = {
    mode,
    generatedAt: new Date().toISOString(),
    sourceRoot: args.sourceRoot,
    manifestPath,
    manifestSha256,
    limit: args.limit,
    exclusions: EXCLUDED_DIRECTORIES,
    imageDataHash: {
      algorithm:
        "exiftool ImageDataHash (pinned via -api ImageHashType=MD5) over image data, excluding metadata; " +
        "originally produced by scripts/prepare-clean-master.py",
      reproducible: Boolean(exiftoolVersion),
      decision: imageHashDecision,
      exiftoolVersion,
      verified: imageHashVerified,
      mismatches: imageHashMismatches,
      errors: imageHashErrors
    },
    counts: {
      manifestRows: catalog.stats.manifestRows,
      uniquePrimaryPhotos: catalog.photos.length,
      duplicateIds,
      duplicatesRejected,
      rejectedRows: catalog.stats.rejectedRows,
      events: catalog.events.length,
      people: catalog.people.length,
      photosWithCapturedAt: catalog.photos.filter((photo) => photo.capturedAt !== null).length,
      photosWithKeywords: catalog.photos.filter((photo) => photo.keywords.length > 0).length,
      metadataReadErrors: catalog.stats.metadataErrors?.length ?? 0
    },
    bytes: {
      totalOriginalBytes: catalog.stats.totalOriginalBytes,
      totalOriginalGiB: Number(formatGiB(catalog.stats.totalOriginalBytes)),
      sha256HashedFiles: catalog.photos.length
    },
    sourceIntegrity: {
      sourceWrites: statChanges.length,
      statChanges,
      imageHashChanges: imageHashMismatches.length
    },
    derivatives: args.verifyOnly
      ? { generated: 0, note: "verify-only: no derivatives written" }
      : {
          generated: derivativesGenerated,
          reused: derivativesReused,
          incremental: args.incremental,
          bytes: derivativeBytes,
          root: args.derivativesRoot
        },
    issues: catalog.stats.issues,
    metadataErrors: catalog.stats.metadataErrors ?? [],
    catalogOverlays
  };

  await writeJson(args.catalogOut, catalog);
  await writeJson(args.reportOut, report);
  console.log(`Wrote ${relative(repoRoot, args.catalogOut)}`);
  console.log(`Wrote ${relative(repoRoot, args.reportOut)}`);

  console.log(
    `Result: ${catalog.photos.length} unique primary photos, ` +
      `${duplicateIds} duplicate IDs (${duplicatesRejected} duplicate rows rejected), ` +
      `${statChanges.length} source writes, ` +
      `${imageHashMismatches.length} source hash changes, ` +
      `${catalog.stats.rejectedRows} rejected rows.`
  );

  // duplicate_hash rejections are quarantined rows, already excluded from the
  // catalog; they are reported but do not fail the done-check gate.
  const blockingIssues = catalog.stats.issues.filter(
    (issue) => issue.type !== "duplicate_hash"
  );
  const failed =
    statChanges.length > 0 ||
    imageHashMismatches.length > 0 ||
    duplicateIds > 0 ||
    blockingIssues.length > 0;
  if (failed) {
    console.error("Verification FAILED. See the report for details.");
    process.exit(1);
  }
  console.log("Verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
