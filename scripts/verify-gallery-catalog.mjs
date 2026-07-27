#!/usr/bin/env node
// Packet 12B: reconcile the read-only clean-master manifest against the
// local gallery catalog (src/generated/gallery-v2.json) and, when a local
// database is reachable, the rachandzach_photos table.
//
// Scope boundary: this script proves COUNTS and IDENTITY (image_data_hash)
// line up across the three layers -- master manifest, local catalog JSON,
// and (optionally) the database. It does NOT recompute file_sha256 for every
// photo; see scripts/verify-original-integrity.mjs for the sampled
// byte-level check (local sha256 vs catalog, catalog vs remote object
// metadata). "Every approved photo has an existing original object" is
// proven here against the read-only master (a catalog hash with no matching
// valid master row is reported under hashDiff.missingFromMaster); remote
// storage-object existence is verify-original-integrity.mjs's job.
//
// Hard gate for this packet: local only, no cloud resources. There is no
// default --db-env-file. Without one, the database section is reported
// "skipped" with an unblock command, and the script still exits 0 on a
// clean catalog-vs-master reconciliation. When a --db-env-file IS supplied,
// this script refuses to connect to anything but a loopback host
// (127.0.0.1 / localhost / ::1) -- even if pointed at cloud credentials by
// mistake, it will not connect.
//
// Usage:
//   node scripts/verify-gallery-catalog.mjs
//     [--master <dir> | --source <dir>] [--catalog <file>]
//     [--db-env-file <file>] [--report <file>] [--help]

import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCleanMasterManifest } from "./lib/clean-master-manifest.mjs";
import {
  parseSyncCatalog,
  readCredentialsFromEnvFile,
} from "../src/lib/import/sync-contracts.ts";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const DEFAULT_MASTER_ROOT =
  process.env.WEDDING_MASTER_ROOT ||
  process.env.SOURCE_PHOTO_DIR ||
  "/Users/zsoskin/Rachel & Zach - Wedding Master Clean";
const DEFAULT_CATALOG_PATH = resolve(repoRoot, "src/generated/gallery-v2.json");
const DEFAULT_REPORT_PATH = resolve(repoRoot, "metadata/verify/gallery-catalog-report.json");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const USAGE =
  "Usage: verify-gallery-catalog.mjs [--master <dir>] [--catalog <file>] " +
  "[--db-env-file <file>] [--report <file>]";

export function parseArgs(argv) {
  const args = {
    masterRoot: DEFAULT_MASTER_ROOT,
    catalogPath: DEFAULT_CATALOG_PATH,
    dbEnvFile: null,
    reportPath: DEFAULT_REPORT_PATH,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--master" || arg === "--source") args.masterRoot = argv[++i];
    else if (arg === "--catalog") args.catalogPath = argv[++i];
    else if (arg === "--db-env-file") args.dbEnvFile = argv[++i];
    else if (arg === "--report") args.reportPath = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export function isLoopbackHost(urlString) {
  try {
    // WHATWG URL.hostname keeps brackets around an IPv6 literal (e.g. "[::1]");
    // strip them so "::1" compares correctly against LOOPBACK_HOSTS.
    const hostname = new URL(urlString).hostname.replace(/^\[|\]$/g, "");
    return LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/** Set-diff of image_data_hash values between the master and the catalog. */
export function diffImageHashes(masterHashes, catalogHashes) {
  const missingFromCatalog = [...masterHashes].filter((h) => !catalogHashes.has(h)).sort();
  const missingFromMaster = [...catalogHashes].filter((h) => !masterHashes.has(h)).sort();
  return { missingFromCatalog, missingFromMaster };
}

/**
 * Compares two slug->count maps (events or people). Returns mismatches for
 * slugs present on both sides plus slugs present on only one side.
 */
export function reconcileCountMaps(masterCounts, catalogCounts) {
  const mismatches = [];
  const onlyInMaster = [];
  const onlyInCatalog = [];
  const slugs = new Set([...masterCounts.keys(), ...catalogCounts.keys()]);
  for (const slug of [...slugs].sort()) {
    const inMaster = masterCounts.has(slug);
    const inCatalog = catalogCounts.has(slug);
    if (inMaster && inCatalog) {
      const masterCount = masterCounts.get(slug);
      const catalogCount = catalogCounts.get(slug);
      if (masterCount !== catalogCount) {
        mismatches.push({ slug, masterCount, catalogCount });
      }
    } else if (inMaster) {
      onlyInMaster.push(slug);
    } else {
      onlyInCatalog.push(slug);
    }
  }
  return { mismatches, onlyInMaster, onlyInCatalog };
}

export function buildDbUnblockNotice() {
  return (
    "Local Postgres is not available in this environment (no Docker / local Supabase stack). " +
    "To enable database reconciliation: install Docker Desktop, run `supabase start` from the " +
    "repo root, then re-run this script with --db-env-file pointing at a LOCAL-ONLY env file " +
    "containing the printed SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. This script only ever " +
    "connects to a loopback host (127.0.0.1 / localhost / ::1); it refuses cloud credentials " +
    "even if --db-env-file points at one, per this packet's no-cloud-resources hard gate."
  );
}

async function writeReport(reportPath, report) {
  await fs.mkdir(dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function checkDatabase(args, catalogData, deps) {
  if (!args.dbEnvFile) {
    return {
      attempted: false,
      reachable: false,
      reason: "no --db-env-file supplied",
      unblock: buildDbUnblockNotice(),
    };
  }
  let credentials;
  try {
    credentials = await readCredentialsFromEnvFile(resolve(args.dbEnvFile));
  } catch (error) {
    return {
      attempted: false,
      reachable: false,
      reason: `could not read --db-env-file: ${error instanceof Error ? error.message : error}`,
      unblock: buildDbUnblockNotice(),
    };
  }
  if (!isLoopbackHost(credentials.url)) {
    let host = credentials.url;
    try {
      host = new URL(credentials.url).hostname;
    } catch {
      // keep raw value
    }
    return {
      attempted: false,
      reachable: false,
      reason:
        `refused: SUPABASE_URL host "${host}" is not a loopback address; this script never ` +
        "connects to a cloud project (packet hard gate: local only)",
      unblock: buildDbUnblockNotice(),
    };
  }
  try {
    const client = deps.dbClientFactory
      ? await deps.dbClientFactory(credentials)
      : await createRealClient(credentials);
    const { count, error } = await client
      .from("rachandzach_photos")
      .select("*", { count: "exact", head: true })
      .eq("source", "master")
      .eq("status", "published");
    if (error) throw new Error(error.message ?? "select failed");
    const catalogCount = catalogData.photos.length;
    const sample = catalogData.photos.slice(0, 5).map((p) => p.imageDataHash);
    let sampleMissing = [];
    if (sample.length > 0) {
      const { data: rows, error: sampleError } = await client
        .from("rachandzach_photos")
        .select("image_data_hash")
        .in("image_data_hash", sample);
      if (sampleError) throw new Error(sampleError.message ?? "sample select failed");
      const present = new Set((rows ?? []).map((r) => r.image_data_hash));
      sampleMissing = sample.filter((h) => !present.has(h));
    }
    const ok = count === catalogCount && sampleMissing.length === 0;
    return {
      attempted: true,
      reachable: true,
      dbCount: count,
      catalogCount,
      sampleChecked: sample.length,
      sampleMissing,
      ok,
    };
  } catch (error) {
    return {
      attempted: true,
      reachable: false,
      reason: error instanceof Error ? error.message : String(error),
      unblock: buildDbUnblockNotice(),
    };
  }
}

async function createRealClient(credentials) {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(credentials.url, credentials.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * verifyGalleryCatalog(argv[, deps]) -> Promise<{exitCode, report}>
 * deps.dbClientFactory(credentials) injects the database client (tests).
 * deps.log(...) overrides console.log (tests).
 */
export async function verifyGalleryCatalog(rawArgs, deps = {}) {
  const args = parseArgs(rawArgs);
  const log = deps.log ?? console.log;
  if (args.help) {
    log(USAGE);
    return { exitCode: 0, report: null };
  }

  log(`[verify-gallery-catalog] Reading clean master manifest (read-only): ${args.masterRoot}`);
  const master = await loadCleanMasterManifest(args.masterRoot, {
    computeSha256: false,
    extractExif: false,
  });

  log(`[verify-gallery-catalog] Reading local catalog: ${args.catalogPath}`);
  const catalogRaw = JSON.parse(await fs.readFile(resolve(args.catalogPath), "utf8"));
  const catalogData = parseSyncCatalog(catalogRaw);

  const masterHashes = new Set(master.photos.map((p) => p.imageDataHash));
  const catalogHashes = new Set(catalogData.photos.map((p) => p.imageDataHash));
  const hashDiff = diffImageHashes(masterHashes, catalogHashes);

  const masterEventCounts = new Map(master.events.map((e) => [e.slug, e.photoCount]));
  const catalogEventCounts = new Map(catalogData.events.map((e) => [e.slug, e.photoCount]));
  const eventDiff = reconcileCountMaps(masterEventCounts, catalogEventCounts);

  const masterPersonCounts = new Map(master.people.map((p) => [p.slug, p.photoCount]));
  const catalogPersonCounts = new Map(catalogData.people.map((p) => [p.slug, p.photoCount]));
  const personDiff = reconcileCountMaps(masterPersonCounts, catalogPersonCounts);

  const countsMatch = master.photos.length === catalogData.photos.length;

  const dbSection = await checkDatabase(args, catalogData, deps);

  const problems = [];
  if (!countsMatch) {
    problems.push(
      `photo count mismatch: master has ${master.photos.length} valid photos, catalog has ${catalogData.photos.length}`,
    );
  }
  if (hashDiff.missingFromCatalog.length > 0) {
    problems.push(
      `${hashDiff.missingFromCatalog.length} master photo(s) not yet reflected in the local catalog`,
    );
  }
  if (hashDiff.missingFromMaster.length > 0) {
    problems.push(
      `${hashDiff.missingFromMaster.length} catalog photo(s) have no matching valid source row in the master (missing original or rejected on re-validation)`,
    );
  }
  const eventProblemCount =
    eventDiff.mismatches.length + eventDiff.onlyInMaster.length + eventDiff.onlyInCatalog.length;
  if (eventProblemCount > 0) {
    problems.push(
      `event reconciliation failed for ${eventProblemCount} event(s) ` +
        `(${eventDiff.mismatches.length} count mismatch, ${eventDiff.onlyInMaster.length} only in master, ` +
        `${eventDiff.onlyInCatalog.length} only in catalog)`,
    );
  }
  const personProblemCount =
    personDiff.mismatches.length + personDiff.onlyInMaster.length + personDiff.onlyInCatalog.length;
  if (personProblemCount > 0) {
    problems.push(
      `person reconciliation failed for ${personProblemCount} person(s) ` +
        `(${personDiff.mismatches.length} count mismatch, ${personDiff.onlyInMaster.length} only in master, ` +
        `${personDiff.onlyInCatalog.length} only in catalog)`,
    );
  }
  if (dbSection.attempted && dbSection.reachable && !dbSection.ok) {
    problems.push("database reconciliation failed (see report for details)");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    masterRoot: args.masterRoot,
    catalogPath: resolve(args.catalogPath),
    scopeNote:
      "Counts and image_data_hash identity only; file_sha256 is sampled separately by verify-original-integrity.mjs.",
    master: {
      manifestRows: master.stats.manifestRows,
      validPhotos: master.photos.length,
      rejectedRows: master.stats.rejectedRows,
      issues: master.stats.issues.slice(0, 50),
      events: master.events.length,
      people: master.people.length,
    },
    catalog: {
      photos: catalogData.photos.length,
      events: catalogData.events.length,
      people: catalogData.people.length,
      generatedAt: catalogData.generatedAt,
    },
    countsMatch,
    hashDiff,
    eventDiff,
    personDiff,
    database: dbSection,
    problems,
    ok: problems.length === 0,
  };

  await writeReport(args.reportPath, report);

  log(
    `[verify-gallery-catalog] master valid photos=${master.photos.length} catalog photos=${catalogData.photos.length} ` +
      `(${countsMatch ? "match" : "MISMATCH"})`,
  );
  log(
    `[verify-gallery-catalog] hash diff: ${hashDiff.missingFromCatalog.length} missing-from-catalog, ` +
      `${hashDiff.missingFromMaster.length} missing-from-master`,
  );
  log(
    `[verify-gallery-catalog] events: ${eventDiff.mismatches.length} mismatched of ${master.events.length}; ` +
      `people: ${personDiff.mismatches.length} mismatched of ${master.people.length}`,
  );
  log(
    dbSection.attempted
      ? `[verify-gallery-catalog] database: ${
          dbSection.reachable ? (dbSection.ok ? "reconciled" : "MISMATCH") : `unreachable (${dbSection.reason})`
        }`
      : `[verify-gallery-catalog] database: skipped (${dbSection.reason})`,
  );
  log(`[verify-gallery-catalog] report written to ${args.reportPath}`);
  log(
    problems.length === 0
      ? "[verify-gallery-catalog] PASS"
      : `[verify-gallery-catalog] FAIL: ${problems.join("; ")}`,
  );

  return { exitCode: problems.length === 0 ? 0 : 1, report };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const { exitCode } = await verifyGalleryCatalog(process.argv.slice(2));
    process.exit(exitCode);
  } catch (error) {
    console.error("[verify-gallery-catalog] fatal:", error instanceof Error ? error.message : error);
    process.exit(2);
  }
}
