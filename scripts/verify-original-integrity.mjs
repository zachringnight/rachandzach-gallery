#!/usr/bin/env node
// Packet 12B: sampled originals integrity check.
//
// Recomputes SHA-256 over a SAMPLED set of source originals (default 100)
// and compares each against the catalog's recorded file_sha256 (plus an
// on-disk size check). Optionally also compares catalog rows against REMOTE
// object metadata -- size and the fileSha256 custom metadata written at
// upload time, via the Storage .info() API and a SQL row select -- never
// downloading object bytes back. Full-archive mode (--full) samples every
// catalog photo; it is for manual launch-day use only and is never part of
// automated verification (npm run verify:originals always samples).
//
// Hard gate for this packet: local only, no cloud resources. --remote is
// opt-in, and even then this script runs the exact same fail-closed gate as
// scripts/sync-gallery-*.mjs (--project-ref + --allowlist + --env-file) but
// FORCES localMode internally, so it can never reach a cloud project no
// matter what credentials --env-file points at. Verifying against the real
// cloud project is a separate, manual, future step outside this packet.
//
// Usage:
//   node scripts/verify-original-integrity.mjs [--sample <n> | --full]
//     [--catalog <file>] [--source <dir> | --master <dir>] [--seed <n>]
//     [--remote --project-ref <ref> --allowlist <ref,...> --env-file <file>]
//     [--report <file>] [--help]

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Stream } from "./lib/clean-master-manifest.mjs";
import {
  parseSyncCatalog,
  readCredentialsFromEnvFile,
  assertExecutionAllowed,
  originalObjectPath,
  ORIGINALS_BUCKET,
} from "../src/lib/import/sync-contracts.ts";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const DEFAULT_MASTER_ROOT =
  process.env.WEDDING_MASTER_ROOT ||
  process.env.SOURCE_PHOTO_DIR ||
  "/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean";
const DEFAULT_CATALOG_PATH = resolve(repoRoot, "src/generated/gallery-v2.json");
const DEFAULT_REPORT_PATH = resolve(repoRoot, "metadata/verify/original-integrity-report.json");
const DEFAULT_SAMPLE_SIZE = 100;
/** Fixed default seed: reproducible samples across runs unless overridden. */
const DEFAULT_SEED = 20260722;

const USAGE =
  "Usage: verify-original-integrity.mjs [--sample <n> | --full] [--catalog <file>] " +
  "[--source <dir>] [--seed <n>] [--remote --project-ref <ref> --allowlist <ref,...> " +
  "--env-file <file>] [--report <file>]";

export function parseArgs(argv) {
  const args = {
    catalogPath: DEFAULT_CATALOG_PATH,
    sourceRoot: DEFAULT_MASTER_ROOT,
    sampleSize: DEFAULT_SAMPLE_SIZE,
    sampleExplicit: false,
    full: false,
    seed: DEFAULT_SEED,
    remote: false,
    projectRef: null,
    allowlist: [],
    envFile: null,
    reportPath: DEFAULT_REPORT_PATH,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--catalog") args.catalogPath = argv[++i];
    else if (arg === "--source" || arg === "--master") args.sourceRoot = argv[++i];
    else if (arg === "--sample") {
      args.sampleSize = Number(argv[++i]);
      args.sampleExplicit = true;
    } else if (arg === "--full") args.full = true;
    else if (arg === "--seed") args.seed = Number(argv[++i]);
    else if (arg === "--remote") args.remote = true;
    else if (arg === "--project-ref") args.projectRef = argv[++i];
    else if (arg === "--allowlist")
      args.allowlist = String(argv[++i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (arg === "--env-file") args.envFile = argv[++i];
    else if (arg === "--report") args.reportPath = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.full && args.sampleExplicit) {
    throw new Error("--full and --sample are mutually exclusive.");
  }
  if (!args.full && (!Number.isInteger(args.sampleSize) || args.sampleSize < 1)) {
    throw new Error("--sample must be a positive integer.");
  }
  if (!Number.isInteger(args.seed)) {
    throw new Error("--seed must be an integer.");
  }
  return args;
}

/** mulberry32: small, fast, deterministic PRNG from an integer seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic sample selection. Sorts by imageDataHash first so the result
 * does not depend on the catalog file's on-disk photo order, then either
 * returns everything (--full) or draws a seeded partial Fisher-Yates sample.
 */
export function selectSample(photos, options = {}) {
  const { sampleSize = DEFAULT_SAMPLE_SIZE, full = false, seed = DEFAULT_SEED } = options;
  const sorted = [...photos].sort((a, b) => a.imageDataHash.localeCompare(b.imageDataHash));
  if (full) return sorted;
  const n = Math.min(sampleSize, sorted.length);
  const pool = [...sorted];
  const rand = mulberry32(seed);
  const picked = [];
  for (let i = 0; i < n; i += 1) {
    const index = Math.floor(rand() * pool.length);
    picked.push(pool[index]);
    pool.splice(index, 1);
  }
  return picked;
}

/** Recomputes sha256 for one photo's source file and compares to the catalog. */
export async function verifyLocalPhoto(photo, sourceRoot) {
  const absolutePath = join(sourceRoot, photo.originalRelativePath);
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (error) {
    return {
      imageDataHash: photo.imageDataHash,
      path: photo.originalRelativePath,
      ok: false,
      reason: `missing_file: ${error instanceof Error ? error.message : error}`,
    };
  }
  if (stat.size !== photo.originalBytes) {
    return {
      imageDataHash: photo.imageDataHash,
      path: photo.originalRelativePath,
      ok: false,
      reason: `size_mismatch: on-disk ${stat.size} != catalog originalBytes ${photo.originalBytes}`,
    };
  }
  const actualSha256 = await sha256Stream(absolutePath);
  if (actualSha256 !== photo.fileSha256) {
    return {
      imageDataHash: photo.imageDataHash,
      path: photo.originalRelativePath,
      ok: false,
      reason: `sha256_mismatch: recomputed ${actualSha256} != catalog fileSha256 ${photo.fileSha256}`,
    };
  }
  return { imageDataHash: photo.imageDataHash, path: photo.originalRelativePath, ok: true };
}

function buildRemoteUnblockNotice() {
  return (
    "Remote checks are opt-in and were not run: pass --remote --project-ref <ref> " +
    "--allowlist <ref,...> --env-file <path>. Even then this script only ever connects to a " +
    "loopback Supabase stack (127.0.0.1 / localhost / ::1) -- it refuses cloud credentials " +
    "unconditionally, per this packet's no-cloud-resources hard gate. Verifying the real " +
    "cloud project is a separate, manual, future step, not part of this script."
  );
}

/**
 * Compares one catalog photo against remote object metadata: the
 * rachandzach_photos row (SQL) and the originals-bucket object's .info()
 * (Storage API: size + the fileSha256 custom metadata written at upload
 * time). Never downloads object bytes.
 */
export async function verifyRemotePhoto(client, photo) {
  const objectPath = originalObjectPath(photo);
  const reasons = [];

  const { data: row, error: rowError } = await client
    .from("rachandzach_photos")
    .select("file_sha256,original_bytes,original_object")
    .eq("image_data_hash", photo.imageDataHash)
    .maybeSingle();
  if (rowError) {
    reasons.push(`db select failed: ${rowError.message ?? "unknown"}`);
  } else if (!row) {
    reasons.push("db row not found for image_data_hash");
  } else {
    if (row.file_sha256 !== photo.fileSha256) {
      reasons.push(`db file_sha256 mismatch (${row.file_sha256})`);
    }
    if (row.original_bytes !== photo.originalBytes) {
      reasons.push(`db original_bytes mismatch (${row.original_bytes})`);
    }
    if (row.original_object !== objectPath) {
      reasons.push(`db original_object mismatch (${row.original_object})`);
    }
  }

  const { data: info, error: infoError } = await client.storage.from(ORIGINALS_BUCKET).info(objectPath);
  if (infoError) {
    reasons.push(`storage info failed: ${infoError.message ?? "unknown"}`);
  } else if (!info) {
    reasons.push("storage object not found");
  } else {
    if (info.size !== photo.originalBytes) {
      reasons.push(`storage size mismatch (${info.size})`);
    }
    const remoteSha = info.metadata?.fileSha256;
    if (remoteSha !== photo.fileSha256) {
      reasons.push(`storage metadata fileSha256 mismatch (${remoteSha ?? "absent"})`);
    }
  }

  return { imageDataHash: photo.imageDataHash, objectPath, ok: reasons.length === 0, reasons };
}

async function createRealClient(credentials) {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(credentials.url, credentials.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function checkRemote(args, sampledPhotos, deps) {
  if (!args.remote) {
    return { attempted: false, reason: "no --remote flag supplied", unblock: buildRemoteUnblockNotice() };
  }
  let credentials;
  try {
    if (!args.envFile) throw new Error("--remote requires --env-file");
    credentials = await readCredentialsFromEnvFile(resolve(args.envFile));
    // Always forced local, regardless of what --env-file points at: this
    // packet's hard gate is stricter than the general sync-script gate,
    // which legitimately allows cloud hosts for its own (separate) job.
    assertExecutionAllowed(
      {
        execute: true,
        projectRef: args.projectRef,
        allowedProjectRefs: args.allowlist,
        envFilePath: args.envFile,
        localMode: true,
      },
      credentials,
    );
  } catch (error) {
    return {
      attempted: false,
      reachable: false,
      reason: error instanceof Error ? error.message : String(error),
      unblock: buildRemoteUnblockNotice(),
    };
  }

  try {
    const client = deps.remoteClientFactory
      ? await deps.remoteClientFactory(credentials)
      : await createRealClient(credentials);
    const results = [];
    for (const photo of sampledPhotos) {
      results.push(await verifyRemotePhoto(client, photo));
    }
    const mismatches = results.filter((r) => !r.ok);
    return {
      attempted: true,
      reachable: true,
      checked: results.length,
      mismatches,
      ok: mismatches.length === 0,
    };
  } catch (error) {
    return {
      attempted: true,
      reachable: false,
      reason: error instanceof Error ? error.message : String(error),
      unblock: buildRemoteUnblockNotice(),
    };
  }
}

async function writeReport(reportPath, report) {
  await fs.mkdir(dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

/**
 * verifyOriginalIntegrity(argv[, deps]) -> Promise<{exitCode, report}>
 * deps.remoteClientFactory(credentials) injects the remote client (tests).
 * deps.log(...) overrides console.log (tests).
 */
export async function verifyOriginalIntegrity(rawArgs, deps = {}) {
  const args = parseArgs(rawArgs);
  const log = deps.log ?? console.log;
  if (args.help) {
    log(USAGE);
    return { exitCode: 0, report: null };
  }

  const catalogRaw = JSON.parse(await fs.readFile(resolve(args.catalogPath), "utf8"));
  const catalogData = parseSyncCatalog(catalogRaw);

  const sample = selectSample(catalogData.photos, {
    sampleSize: args.sampleSize,
    full: args.full,
    seed: args.seed,
  });
  log(
    `[verify-original-integrity] ${
      args.full ? "FULL-ARCHIVE (manual launch-day mode)" : `sampled ${sample.length}/${catalogData.photos.length}`
    } photo(s) against ${args.sourceRoot}`,
  );

  const localResults = [];
  for (const photo of sample) {
    localResults.push(await verifyLocalPhoto(photo, args.sourceRoot));
  }
  const localMismatches = localResults.filter((r) => !r.ok);

  const remote = await checkRemote(args, sample, deps);

  const problems = [];
  if (localMismatches.length > 0) {
    problems.push(
      `${localMismatches.length}/${sample.length} sampled original(s) failed local sha256/size verification`,
    );
  }
  if (remote.attempted && remote.reachable && !remote.ok) {
    problems.push(
      `${remote.mismatches.length}/${remote.checked} sampled photo(s) failed remote metadata verification`,
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    catalogPath: resolve(args.catalogPath),
    sourceRoot: args.sourceRoot,
    mode: args.full ? "full" : "sample",
    sampleSize: sample.length,
    catalogSize: catalogData.photos.length,
    seed: args.seed,
    local: {
      checked: localResults.length,
      mismatches: localMismatches,
      ok: localMismatches.length === 0,
    },
    remote,
    problems,
    ok: problems.length === 0,
  };
  await writeReport(args.reportPath, report);

  log(
    `[verify-original-integrity] local sha256: ${localResults.length - localMismatches.length}/${localResults.length} matched`,
  );
  log(
    remote.attempted
      ? `[verify-original-integrity] remote: ${
          remote.reachable ? (remote.ok ? "reconciled" : "MISMATCH") : `unreachable (${remote.reason})`
        }`
      : `[verify-original-integrity] remote: skipped (${remote.reason})`,
  );
  log(`[verify-original-integrity] report written to ${args.reportPath}`);
  log(
    problems.length === 0
      ? "[verify-original-integrity] PASS"
      : `[verify-original-integrity] FAIL: ${problems.join("; ")}`,
  );

  return { exitCode: problems.length === 0 ? 0 : 1, report };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const { exitCode } = await verifyOriginalIntegrity(process.argv.slice(2));
    process.exit(exitCode);
  } catch (error) {
    console.error("[verify-original-integrity] fatal:", error instanceof Error ? error.message : error);
    process.exit(2);
  }
}
