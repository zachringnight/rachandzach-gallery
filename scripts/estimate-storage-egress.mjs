#!/usr/bin/env node
// Packet 12B: storage and egress cost estimator.
//
// Plan rates are INPUTS, never hardcoded truth: every rate below has a
// documented source and date, ships only as an overridable DEFAULT, and can
// be replaced wholesale with --rates <file.json> or nudged individually with
// --rate flags. Re-verify at https://supabase.com/pricing before trusting a
// number from this tool for a real budget decision.
//
// Catalog size and average original bytes are read from the REAL local
// catalog (src/generated/gallery-v2.json). Average preview byte sizes are
// sampled from REAL derivative files on disk when available
// (metadata/import/derivatives/previews/**) and fall back to documented
// constants (this catalog's own measured averages as of 2026-07-22) when
// no local derivatives exist.
//
// Models preview egress two ways, per scenario:
//   "hourly"   -- signed preview URLs rotate every hour, which busts the CDN
//                 and browser cache on every rotation (a fresh token is
//                 always a cache miss). Egress scales with guest-hours.
//   "long-ttl" -- preview URLs are issued for a long TTL (default 24h) and
//                 memoized server-side, so repeat views of the same object
//                 by anyone within the TTL window are cache hits. Egress is
//                 capped near the size of the unique catalog preview set.
// A "direct" scenario type is also supported for fixed stress-test
// ceilings (a target total egress number, not derived from guest behavior).
//
// This script makes no network calls; it only reads local files.
//
// Usage:
//   node scripts/estimate-storage-egress.mjs
//     [--catalog <file>] [--derivatives-dir <dir>]
//     [--rates <file.json>] [--scenarios <file.json>]
//     [--preview-tier <width>] [--format-weight-avif <n>] [--format-weight-webp <n>]
//     [--long-ttl-hours <n>] [--guest-headroom-gb <n>] [--hourly-fetch-gb <n>]
//     [--plan-base-fee <n>] [--included-storage-gb <n>] [--storage-overage-usd-per-gb <n>]
//     [--included-uncached-egress-gb <n>] [--included-cached-egress-gb <n>]
//     [--egress-uncached-usd-per-gb <n>] [--egress-cached-usd-per-gb <n>]
//     [--report <file>] [--help]

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const DEFAULT_CATALOG_PATH = resolve(repoRoot, "src/generated/gallery-v2.json");
const DEFAULT_DERIVATIVES_DIR = resolve(repoRoot, "metadata/import/derivatives/previews");
const DEFAULT_REPORT_PATH = resolve(repoRoot, "metadata/verify/storage-egress-estimate.json");
const DEFAULT_MAX_SAMPLE_FILES = 4000;

const USAGE =
  "Usage: estimate-storage-egress.mjs [--catalog <file>] [--derivatives-dir <dir>] " +
  "[--rates <file.json>] [--scenarios <file.json>] [--preview-tier <width>] " +
  "[--long-ttl-hours <n>] [--guest-headroom-gb <n>] [--report <file>]";

/**
 * Defaults sourced from docs/0719_Supabase_Decision_v1.md, verified
 * 2026-07-22 against https://supabase.com/pricing. These are INPUTS, not
 * permanent truth -- override with --rates <file.json> or the --rate-*
 * flags below; re-verify before trusting a number for a real decision.
 */
export const DEFAULT_RATES = {
  _source: "docs/0719_Supabase_Decision_v1.md, verified 2026-07-22 against supabase.com/pricing",
  asOf: "2026-07-22",
  planBaseFeeUsdPerMonth: 25,
  includedStorageGb: 100,
  storageOverageUsdPerGb: 0.021,
  includedUncachedEgressGb: 250,
  includedCachedEgressGb: 250,
  egressUncachedOverageUsdPerGb: 0.09,
  egressCachedOverageUsdPerGb: 0.03,
  /**
   * Guest-browsing preview fetch rate under HOURLY signed-URL rotation, in
   * GB per guest per browsing hour. This is a modeling ASSUMPTION (the
   * decision brief's own working number for "roughly 0.1 GB per guest per
   * hour"), not a measured constant. Override with --hourly-fetch-gb.
   */
  hourlyFetchGbPerGuestHour: 0.1,
};

/**
 * Real per-tier average bytes measured from this catalog's own derivatives
 * on 2026-07-22 (metadata/import/derivatives/previews, ~6100 files
 * sampled). Used only when --derivatives-dir has nothing to sample, e.g. a
 * fresh checkout before `npm run gallery:import` has produced derivatives.
 */
export const FALLBACK_TIER_BYTES = {
  "480.avif": 23145,
  "480.webp": 31214,
  "960.avif": 60318,
  "960.webp": 85170,
  "1600.avif": 141822,
  "1600.webp": 212635,
  "2400.jpeg": 1112065,
};

const STORAGE_TIER_FILES = [
  "480.avif",
  "480.webp",
  "960.avif",
  "960.webp",
  "1600.avif",
  "1600.webp",
  "2400.jpeg",
];

/**
 * Illustrative default scenarios. Assumption INPUTS (guest counts, browsing
 * hours, download counts) are similar in spirit to the ones worked by hand
 * in docs/0719_Supabase_Decision_v1.md, but every output number here is
 * computed fresh from these formulas against the real catalog -- not copied
 * from that document. Override wholesale with --scenarios <file.json>.
 */
export const DEFAULT_SCENARIOS = [
  {
    key: "quiet",
    label: "Quiet month",
    egressModel: "guest-behavior",
    previewMode: "long-ttl",
    guests: 15,
    browsingHoursPerGuest: 0.5,
    fullArchiveDownloads: 0,
    personalSetDownloads: 40,
    personalSetAvgPhotos: 1,
  },
  {
    key: "launch-mitigated",
    label: "Launch month, mitigated (long preview TTL)",
    egressModel: "guest-behavior",
    previewMode: "long-ttl",
    guests: 100,
    browsingHoursPerGuest: 2,
    fullArchiveDownloads: 10,
    personalSetDownloads: 40,
    personalSetAvgPhotos: 100,
  },
  {
    key: "launch-worst-case",
    label: "Launch month, worst case (hourly rotation kept)",
    egressModel: "guest-behavior",
    previewMode: "hourly",
    guests: 100,
    browsingHoursPerGuest: 8,
    fullArchiveDownloads: 25,
    personalSetDownloads: 50,
    personalSetAvgPhotos: 100,
  },
  {
    key: "extreme-ceiling",
    label: "Extreme ceiling",
    egressModel: "direct",
    uncachedGb: 750,
    cachedGb: 250,
  },
];

export function parseArgs(argv) {
  const args = {
    catalogPath: DEFAULT_CATALOG_PATH,
    derivativesDir: DEFAULT_DERIVATIVES_DIR,
    ratesPath: null,
    scenariosPath: null,
    previewTier: 960,
    formatWeights: { avif: 0.7, webp: 0.3 },
    longTtlHours: 24,
    guestHeadroomGb: 10,
    maxSampleFiles: DEFAULT_MAX_SAMPLE_FILES,
    rateOverrides: {},
    reportPath: DEFAULT_REPORT_PATH,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--catalog") args.catalogPath = argv[++i];
    else if (arg === "--derivatives-dir") args.derivativesDir = argv[++i];
    else if (arg === "--rates") args.ratesPath = argv[++i];
    else if (arg === "--scenarios") args.scenariosPath = argv[++i];
    else if (arg === "--preview-tier") args.previewTier = Number(argv[++i]);
    else if (arg === "--format-weight-avif") args.formatWeights.avif = Number(argv[++i]);
    else if (arg === "--format-weight-webp") args.formatWeights.webp = Number(argv[++i]);
    else if (arg === "--long-ttl-hours") args.longTtlHours = Number(argv[++i]);
    else if (arg === "--guest-headroom-gb") args.guestHeadroomGb = Number(argv[++i]);
    else if (arg === "--max-sample-files") args.maxSampleFiles = Number(argv[++i]);
    else if (arg === "--hourly-fetch-gb") args.rateOverrides.hourlyFetchGbPerGuestHour = Number(argv[++i]);
    else if (arg === "--plan-base-fee") args.rateOverrides.planBaseFeeUsdPerMonth = Number(argv[++i]);
    else if (arg === "--included-storage-gb") args.rateOverrides.includedStorageGb = Number(argv[++i]);
    else if (arg === "--storage-overage-usd-per-gb")
      args.rateOverrides.storageOverageUsdPerGb = Number(argv[++i]);
    else if (arg === "--included-uncached-egress-gb")
      args.rateOverrides.includedUncachedEgressGb = Number(argv[++i]);
    else if (arg === "--included-cached-egress-gb")
      args.rateOverrides.includedCachedEgressGb = Number(argv[++i]);
    else if (arg === "--egress-uncached-usd-per-gb")
      args.rateOverrides.egressUncachedOverageUsdPerGb = Number(argv[++i]);
    else if (arg === "--egress-cached-usd-per-gb")
      args.rateOverrides.egressCachedOverageUsdPerGb = Number(argv[++i]);
    else if (arg === "--report") args.reportPath = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

/** Pure merge: DEFAULT_RATES <- file overrides <- flag overrides. */
export function mergeRates(fileOverrides = {}, flagOverrides = {}) {
  return { ...DEFAULT_RATES, ...fileOverrides, ...flagOverrides };
}

async function resolveRates(args) {
  let fileOverrides = {};
  if (args.ratesPath) {
    fileOverrides = JSON.parse(await fs.readFile(resolve(args.ratesPath), "utf8"));
  }
  return mergeRates(fileOverrides, args.rateOverrides);
}

async function resolveScenarios(args) {
  if (!args.scenariosPath) return DEFAULT_SCENARIOS;
  const parsed = JSON.parse(await fs.readFile(resolve(args.scenariosPath), "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`--scenarios file ${args.scenariosPath} must contain a non-empty JSON array`);
  }
  return parsed;
}

/**
 * Scans derivative preview files on disk (metadata/import/derivatives/previews/<hash>/<width>.<format>)
 * and returns { "<width>.<format>": { avgBytes, sampleCount } } for however
 * many tiers it found, up to maxFiles total files stat'd. Returns null when
 * the directory does not exist (fresh checkout, no derivatives generated).
 */
export async function sampleDerivativeAverages(derivativesDir, { maxFiles = DEFAULT_MAX_SAMPLE_FILES } = {}) {
  let hashDirs;
  try {
    hashDirs = await fs.readdir(derivativesDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const sums = new Map();
  let filesSeen = 0;
  for (const hashDir of hashDirs) {
    if (filesSeen >= maxFiles) break;
    if (!hashDir.isDirectory()) continue;
    const hashPath = join(derivativesDir, hashDir.name);
    let files;
    try {
      files = await fs.readdir(hashPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (filesSeen >= maxFiles) break;
      let stat;
      try {
        stat = await fs.stat(join(hashPath, file));
      } catch {
        continue;
      }
      const entry = sums.get(file) ?? { sum: 0, count: 0 };
      entry.sum += stat.size;
      entry.count += 1;
      sums.set(file, entry);
      filesSeen += 1;
    }
  }
  if (filesSeen === 0) return null;
  const averages = {};
  for (const [key, { sum, count }] of sums) {
    averages[key] = { avgBytes: Math.round(sum / count), sampleCount: count };
  }
  return averages;
}

function tierBytes(sampledAverages, key) {
  return sampledAverages?.[key]?.avgBytes ?? FALLBACK_TIER_BYTES[key];
}

/**
 * Total on-disk storage profile: current catalog originals (real), the full
 * set of preview derivatives across all known tiers (real when sampled,
 * documented fallback otherwise), plus a guest-upload headroom assumption.
 */
export function computeStorageProfile(catalogStats, sampledAverages, opts) {
  const photoCount = catalogStats.importedPhotos;
  const totalOriginalBytes = catalogStats.totalOriginalBytes;
  const originalsGb = totalOriginalBytes / 1e9;

  let perPhotoPreviewBytes = 0;
  let sampledTiers = 0;
  for (const key of STORAGE_TIER_FILES) {
    perPhotoPreviewBytes += tierBytes(sampledAverages, key);
    if (sampledAverages?.[key]) sampledTiers += 1;
  }
  const previewStorageGb = (perPhotoPreviewBytes * photoCount) / 1e9;
  const guestHeadroomGb = opts.guestHeadroomGb ?? 0;

  return {
    photoCount,
    totalOriginalBytes,
    avgOriginalBytes: photoCount > 0 ? totalOriginalBytes / photoCount : 0,
    previewStorageGb,
    guestHeadroomGb,
    storageGb: originalsGb + previewStorageGb + guestHeadroomGb,
    sampledTiers,
    totalTiers: STORAGE_TIER_FILES.length,
  };
}

/**
 * The "what a guest actually fetches while browsing" preview size: a
 * format-weighted average of one representative tier (default 960w, the
 * decision brief's own choice for a typical grid/lightbox fetch).
 */
export function computeBrowsingPreviewBytesPerPhoto(sampledAverages, previewTier, formatWeights) {
  const avifKey = `${previewTier}.avif`;
  const webpKey = `${previewTier}.webp`;
  const avifBytes = tierBytes(sampledAverages, avifKey) ?? tierBytes(sampledAverages, "960.avif");
  const webpBytes = tierBytes(sampledAverages, webpKey) ?? tierBytes(sampledAverages, "960.webp");
  const wAvif = formatWeights.avif ?? 0.5;
  const wWebp = formatWeights.webp ?? 0.5;
  const totalWeight = wAvif + wWebp;
  if (totalWeight <= 0) throw new Error("format weights must sum to a positive number");
  return (avifBytes * wAvif + webpBytes * wWebp) / totalWeight;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Computes one scenario row: egress (uncached vs cached GB), storage, and
 * monthly USD, from real catalog byte profile + rate inputs + the
 * scenario's guest-behavior (or direct) assumptions. See file header for
 * the hourly-vs-long-TTL egress model.
 */
export function computeScenario(scenario, profile, rates, opts = {}) {
  const { totalOriginalBytes, avgOriginalBytes, previewBytesPerPhoto, photoCount, storageGb } = profile;
  const fullCatalogPreviewGb = (photoCount * previewBytesPerPhoto) / 1e9;

  let uncachedGb = 0;
  let cachedGb = 0;
  const notes = [];

  if (scenario.egressModel === "direct") {
    uncachedGb += scenario.uncachedGb ?? 0;
    cachedGb += scenario.cachedGb ?? 0;
    notes.push(
      `direct: fixed ${scenario.uncachedGb ?? 0} GB uncached / ${scenario.cachedGb ?? 0} GB cached ` +
        "(stress-test ceiling, not guest-behavior-derived)",
    );
  } else if (scenario.egressModel === "guest-behavior") {
    const guestHourDemandGb =
      (scenario.guests ?? 0) * (scenario.browsingHoursPerGuest ?? 0) * rates.hourlyFetchGbPerGuestHour;
    if (scenario.previewMode === "hourly") {
      uncachedGb += guestHourDemandGb;
      notes.push(
        `hourly rotation: ${scenario.guests} guests x ${scenario.browsingHoursPerGuest}h x ` +
          `${rates.hourlyFetchGbPerGuestHour} GB/guest-hour = ${guestHourDemandGb.toFixed(2)} GB, ` +
          "100% uncached (every rotation issues a fresh signed URL, guaranteed cache miss)",
      );
    } else if (scenario.previewMode === "long-ttl") {
      // Demand is capped per guest at the full unique catalog preview set:
      // repeat views within the TTL window are cache hits. Only ONE true
      // miss per unique object is billed as uncached regardless of guest
      // count (server-side URL memoization means everyone shares the same
      // cache key while the memoized URL is valid); the rest of realized
      // demand is served from cache (cheaper "cached" egress tier).
      const cappedDemandGb = Math.min(guestHourDemandGb, (scenario.guests ?? 0) * fullCatalogPreviewGb);
      const uncachedPortion = Math.min(cappedDemandGb, fullCatalogPreviewGb);
      const cachedPortion = Math.max(0, cappedDemandGb - uncachedPortion);
      uncachedGb += uncachedPortion;
      cachedGb += cachedPortion;
      notes.push(
        `long TTL (${opts.longTtlHours ?? 24}h, server-memoized signed URL): demand ${cappedDemandGb.toFixed(2)} GB ` +
          `capped at ${scenario.guests} x full-catalog-preview-set (${fullCatalogPreviewGb.toFixed(2)} GB); ` +
          `${uncachedPortion.toFixed(2)} GB first-miss uncached, ${cachedPortion.toFixed(2)} GB served from cache`,
      );
    } else {
      throw new Error(`Unknown previewMode "${scenario.previewMode}" for scenario "${scenario.key}"`);
    }
  } else {
    throw new Error(`Unknown egressModel "${scenario.egressModel}" for scenario "${scenario.key}"`);
  }

  const originalsGb =
    (scenario.fullArchiveDownloads ?? 0) * (totalOriginalBytes / 1e9) +
    (scenario.personalSetDownloads ?? 0) * (scenario.personalSetAvgPhotos ?? 1) * (avgOriginalBytes / 1e9);
  if (originalsGb > 0) {
    // Original downloads always use short, single-use signed URLs (10-minute
    // TTL per docs/0719_Privacy_Operations_v1.md): never cacheable.
    uncachedGb += originalsGb;
    notes.push(
      `originals: ${scenario.fullArchiveDownloads ?? 0} full-archive + ${scenario.personalSetDownloads ?? 0} x ` +
        `${scenario.personalSetAvgPhotos ?? 1}-photo set(s) = ${originalsGb.toFixed(2)} GB, always uncached ` +
        "(single-use short TTL, never cached)",
    );
  }

  const storageOverageGb = Math.max(0, storageGb - rates.includedStorageGb);
  const uncachedOverageGb = Math.max(0, uncachedGb - rates.includedUncachedEgressGb);
  const cachedOverageGb = Math.max(0, cachedGb - rates.includedCachedEgressGb);

  const storageOverageUsd = storageOverageGb * rates.storageOverageUsdPerGb;
  const uncachedOverageUsd = uncachedOverageGb * rates.egressUncachedOverageUsdPerGb;
  const cachedOverageUsd = cachedOverageGb * rates.egressCachedOverageUsdPerGb;
  const totalUsd = rates.planBaseFeeUsdPerMonth + storageOverageUsd + uncachedOverageUsd + cachedOverageUsd;

  return {
    key: scenario.key,
    label: scenario.label,
    uncachedGb: round2(uncachedGb),
    cachedGb: round2(cachedGb),
    storageGb: round2(storageGb),
    storageOverageUsd: round2(storageOverageUsd),
    uncachedOverageUsd: round2(uncachedOverageUsd),
    cachedOverageUsd: round2(cachedOverageUsd),
    totalUsd: round2(totalUsd),
    notes,
  };
}

export function formatTable(rows) {
  const headers = ["Scenario", "Uncached GB", "Cached GB", "Storage GB", "Overage $", "Total $/mo"];
  const dataRows = rows.map((r) => [
    r.label,
    r.uncachedGb.toFixed(2),
    r.cachedGb.toFixed(2),
    r.storageGb.toFixed(2),
    (r.storageOverageUsd + r.uncachedOverageUsd + r.cachedOverageUsd).toFixed(2),
    r.totalUsd.toFixed(2),
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...dataRows.map((row) => row[i].length)));
  const formatRow = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  return [formatRow(headers), separator, ...dataRows.map(formatRow)].join("\n");
}

/**
 * estimateStorageEgress(argv[, deps]) -> Promise<{exitCode, report}>
 * deps.log(...) overrides console.log (tests).
 * deps.sampleDerivativeAverages(dir) overrides the disk sampler (tests).
 */
export async function estimateStorageEgress(rawArgs, deps = {}) {
  const args = parseArgs(rawArgs);
  const log = deps.log ?? console.log;
  if (args.help) {
    log(USAGE);
    return { exitCode: 0, report: null };
  }

  const catalogRaw = JSON.parse(await fs.readFile(resolve(args.catalogPath), "utf8"));
  const stats = catalogRaw?.stats;
  if (!stats || typeof stats.totalOriginalBytes !== "number" || typeof stats.importedPhotos !== "number") {
    throw new Error(
      `Catalog at ${args.catalogPath} is missing stats.totalOriginalBytes / stats.importedPhotos`,
    );
  }

  const rates = await resolveRates(args);
  const scenarios = await resolveScenarios(args);

  const sampler = deps.sampleDerivativeAverages ?? sampleDerivativeAverages;
  const sampledAverages = await sampler(args.derivativesDir, { maxFiles: args.maxSampleFiles });

  const storageProfile = computeStorageProfile(stats, sampledAverages, {
    guestHeadroomGb: args.guestHeadroomGb,
  });
  const previewBytesPerPhoto = computeBrowsingPreviewBytesPerPhoto(
    sampledAverages,
    args.previewTier,
    args.formatWeights,
  );

  const profile = {
    photoCount: storageProfile.photoCount,
    avgOriginalBytes: storageProfile.avgOriginalBytes,
    totalOriginalBytes: storageProfile.totalOriginalBytes,
    previewBytesPerPhoto,
    storageGb: storageProfile.storageGb,
  };

  const rows = scenarios.map((scenario) =>
    computeScenario(scenario, profile, rates, { longTtlHours: args.longTtlHours }),
  );
  const table = formatTable(rows);

  const report = {
    generatedAt: new Date().toISOString(),
    catalogPath: resolve(args.catalogPath),
    derivativesDir: args.derivativesDir,
    rates,
    assumptions: {
      previewTier: args.previewTier,
      formatWeights: args.formatWeights,
      longTtlHours: args.longTtlHours,
      guestHeadroomGb: args.guestHeadroomGb,
      previewBytesPerPhoto: Math.round(previewBytesPerPhoto),
      derivativeSampling: sampledAverages
        ? {
            source: "local derivatives on disk",
            dir: args.derivativesDir,
            tiersSampled: storageProfile.sampledTiers,
            ofTiers: storageProfile.totalTiers,
          }
        : {
            source: "documented fallback averages (no local derivatives found)",
            dir: args.derivativesDir,
          },
    },
    storageProfile,
    scenarios: rows,
  };

  await fs.mkdir(dirname(args.reportPath), { recursive: true });
  await fs.writeFile(args.reportPath, `${JSON.stringify(report, null, 2)}\n`);

  log(`[estimate-storage-egress] rates as of ${rates.asOf} (${rates._source})`);
  log(
    sampledAverages
      ? `[estimate-storage-egress] preview byte averages: sampled ${storageProfile.sampledTiers}/${storageProfile.totalTiers} tiers from ${args.derivativesDir}`
      : `[estimate-storage-egress] preview byte averages: no local derivatives at ${args.derivativesDir}; using documented fallback constants (dated ${DEFAULT_RATES.asOf})`,
  );
  log(
    `[estimate-storage-egress] catalog: ${storageProfile.photoCount} photos, ${(storageProfile.totalOriginalBytes / 1e9).toFixed(2)} GB originals`,
  );
  log("");
  log(table);
  log("");
  log(`[estimate-storage-egress] report written to ${args.reportPath}`);

  return { exitCode: 0, report };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const { exitCode } = await estimateStorageEgress(process.argv.slice(2));
    process.exit(exitCode);
  } catch (error) {
    console.error("[estimate-storage-egress] fatal:", error instanceof Error ? error.message : error);
    process.exit(2);
  }
}
