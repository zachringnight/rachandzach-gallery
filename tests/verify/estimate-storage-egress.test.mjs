// Unit + integration coverage for scripts/estimate-storage-egress.mjs
// (packet 12B). This script makes no network calls; integration tests use
// small temp catalog/rates/scenarios files. Nothing here touches the real
// src/generated/gallery-v2.json or metadata/import/derivatives.
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RATES,
  DEFAULT_SCENARIOS,
  parseArgs,
  mergeRates,
  computeStorageProfile,
  computeBrowsingPreviewBytesPerPhoto,
  computeScenario,
  formatTable,
  sampleDerivativeAverages,
  estimateStorageEgress,
} from "../../scripts/estimate-storage-egress.mjs";

describe("parseArgs", () => {
  it("defaults to the repo's real catalog/derivatives paths and DEFAULT_RATES untouched", () => {
    const args = parseArgs([]);
    expect(args.catalogPath).toMatch(/gallery-v2\.json$/);
    expect(args.derivativesDir).toMatch(/derivatives.previews$/);
    expect(args.rateOverrides).toEqual({});
    expect(args.previewTier).toBe(960);
    expect(args.formatWeights).toEqual({ avif: 0.7, webp: 0.3 });
  });

  it("collects individual --rate-* flags into rateOverrides", () => {
    const args = parseArgs([
      "--plan-base-fee",
      "30",
      "--included-storage-gb",
      "50",
      "--storage-overage-usd-per-gb",
      "0.05",
      "--included-uncached-egress-gb",
      "100",
      "--included-cached-egress-gb",
      "100",
      "--egress-uncached-usd-per-gb",
      "0.1",
      "--egress-cached-usd-per-gb",
      "0.04",
      "--hourly-fetch-gb",
      "0.2",
    ]);
    expect(args.rateOverrides).toEqual({
      planBaseFeeUsdPerMonth: 30,
      includedStorageGb: 50,
      storageOverageUsdPerGb: 0.05,
      includedUncachedEgressGb: 100,
      includedCachedEgressGb: 100,
      egressUncachedOverageUsdPerGb: 0.1,
      egressCachedOverageUsdPerGb: 0.04,
      hourlyFetchGbPerGuestHour: 0.2,
    });
  });

  it("parses --preview-tier, format weights, --long-ttl-hours, --guest-headroom-gb", () => {
    const args = parseArgs([
      "--preview-tier",
      "1600",
      "--format-weight-avif",
      "1",
      "--format-weight-webp",
      "0",
      "--long-ttl-hours",
      "12",
      "--guest-headroom-gb",
      "5",
    ]);
    expect(args.previewTier).toBe(1600);
    expect(args.formatWeights).toEqual({ avif: 1, webp: 0 });
    expect(args.longTtlHours).toBe(12);
    expect(args.guestHeadroomGb).toBe(5);
  });

  it("throws on an unknown argument", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown argument/);
  });
});

describe("mergeRates", () => {
  it("layers DEFAULT_RATES <- file overrides <- flag overrides", () => {
    const merged = mergeRates({ planBaseFeeUsdPerMonth: 40 }, { planBaseFeeUsdPerMonth: 50 });
    expect(merged.planBaseFeeUsdPerMonth).toBe(50);
    expect(merged.includedStorageGb).toBe(DEFAULT_RATES.includedStorageGb);
  });

  it("keeps every default rate untouched when no overrides are given", () => {
    expect(mergeRates()).toEqual(DEFAULT_RATES);
  });
});

describe("computeStorageProfile", () => {
  const stats = { importedPhotos: 2, totalOriginalBytes: 20_000_000_000 };

  it("uses documented fallback bytes when no derivatives were sampled", () => {
    const profile = computeStorageProfile(stats, null, { guestHeadroomGb: 10 });
    expect(profile.photoCount).toBe(2);
    expect(profile.avgOriginalBytes).toBe(10_000_000_000);
    expect(profile.sampledTiers).toBe(0);
    expect(profile.totalTiers).toBe(7);
    expect(profile.previewStorageGb).toBeGreaterThan(0);
    expect(profile.storageGb).toBeCloseTo(
      stats.totalOriginalBytes / 1e9 + profile.previewStorageGb + 10,
      6,
    );
  });

  it("prefers real sampled averages over the fallback for tiers it has", () => {
    const sampled = { "480.avif": { avgBytes: 1000, sampleCount: 4 } };
    const profile = computeStorageProfile(stats, sampled, { guestHeadroomGb: 0 });
    expect(profile.sampledTiers).toBe(1);
  });

  it("does not divide by zero when the catalog is empty", () => {
    const profile = computeStorageProfile({ importedPhotos: 0, totalOriginalBytes: 0 }, null, {
      guestHeadroomGb: 0,
    });
    expect(profile.avgOriginalBytes).toBe(0);
  });
});

describe("computeBrowsingPreviewBytesPerPhoto", () => {
  it("computes a weighted average of the avif/webp tier bytes", () => {
    const sampled = {
      "960.avif": { avgBytes: 100 },
      "960.webp": { avgBytes: 200 },
    };
    const bytes = computeBrowsingPreviewBytesPerPhoto(sampled, 960, { avif: 1, webp: 1 });
    expect(bytes).toBe(150);
  });

  it("weights toward the heavier format", () => {
    const sampled = {
      "960.avif": { avgBytes: 100 },
      "960.webp": { avgBytes: 200 },
    };
    const bytes = computeBrowsingPreviewBytesPerPhoto(sampled, 960, { avif: 3, webp: 1 });
    expect(bytes).toBeCloseTo((100 * 3 + 200 * 1) / 4, 6);
  });

  it("throws when the format weights sum to zero or less", () => {
    expect(() => computeBrowsingPreviewBytesPerPhoto(null, 960, { avif: 0, webp: 0 })).toThrow(
      /positive number/,
    );
  });
});

describe("computeScenario", () => {
  const rates = { ...DEFAULT_RATES };
  const profile = {
    photoCount: 1000,
    avgOriginalBytes: 7_000_000, // 7 MB
    totalOriginalBytes: 7_000_000_000, // 7 GB
    previewBytesPerPhoto: 70_000, // 70 KB
    storageGb: 20,
  };

  it("passes a direct scenario's fixed GB straight through", () => {
    const row = computeScenario(
      { key: "x", label: "X", egressModel: "direct", uncachedGb: 750, cachedGb: 250 },
      profile,
      rates,
      {},
    );
    expect(row.uncachedGb).toBe(750);
    expect(row.cachedGb).toBe(250);
  });

  it("hourly rotation: uncached egress equals guests x hours x rate, fully uncached", () => {
    const scenario = {
      key: "hourly",
      label: "Hourly",
      egressModel: "guest-behavior",
      previewMode: "hourly",
      guests: 10,
      browsingHoursPerGuest: 2,
    };
    const row = computeScenario(scenario, profile, rates, {});
    expect(row.uncachedGb).toBeCloseTo(10 * 2 * rates.hourlyFetchGbPerGuestHour, 6);
    expect(row.cachedGb).toBe(0);
  });

  it("long TTL: demand under the per-guest full-catalog cap is fully uncached (first miss)", () => {
    const fullCatalogPreviewGb = (profile.photoCount * profile.previewBytesPerPhoto) / 1e9;
    const scenario = {
      key: "long-ttl-under-cap",
      label: "Long TTL under cap",
      egressModel: "guest-behavior",
      previewMode: "long-ttl",
      guests: 1,
      // Chosen so guests * hours * rate < fullCatalogPreviewGb * guests.
      browsingHoursPerGuest: (fullCatalogPreviewGb * 0.5) / rates.hourlyFetchGbPerGuestHour,
    };
    const row = computeScenario(scenario, profile, rates, { longTtlHours: 24 });
    expect(row.cachedGb).toBe(0);
    expect(row.uncachedGb).toBeGreaterThan(0);
    expect(row.uncachedGb).toBeLessThanOrEqual(round2(fullCatalogPreviewGb));
  });

  it("long TTL: demand over the per-guest full-catalog cap spills into cached egress", () => {
    const fullCatalogPreviewGb = (profile.photoCount * profile.previewBytesPerPhoto) / 1e9;
    const scenario = {
      key: "long-ttl-over-cap",
      label: "Long TTL over cap",
      egressModel: "guest-behavior",
      previewMode: "long-ttl",
      guests: 100,
      browsingHoursPerGuest: 8, // guests*hours*rate should exceed guests*fullCatalogPreviewGb here
    };
    const row = computeScenario(scenario, profile, rates, { longTtlHours: 24 });
    expect(row.uncachedGb).toBeCloseTo(round2(fullCatalogPreviewGb), 1);
    expect(row.cachedGb).toBeGreaterThan(0);
  });

  it("adds original downloads as always-uncached on top of preview egress", () => {
    const scenario = {
      key: "downloads",
      label: "Downloads",
      egressModel: "guest-behavior",
      previewMode: "hourly",
      guests: 0,
      browsingHoursPerGuest: 0,
      fullArchiveDownloads: 1,
      personalSetDownloads: 2,
      personalSetAvgPhotos: 10,
    };
    const row = computeScenario(scenario, profile, rates, {});
    const expectedGb =
      1 * (profile.totalOriginalBytes / 1e9) + 2 * 10 * (profile.avgOriginalBytes / 1e9);
    expect(row.uncachedGb).toBeCloseTo(round2(expectedGb), 6);
    expect(row.cachedGb).toBe(0);
  });

  it("charges base fee plus overage past included quotas", () => {
    const scenario = { key: "d", label: "D", egressModel: "direct", uncachedGb: 1000, cachedGb: 500 };
    const row = computeScenario(scenario, { ...profile, storageGb: 500 }, rates, {});
    const expectedStorageOverage = (500 - rates.includedStorageGb) * rates.storageOverageUsdPerGb;
    const expectedUncachedOverage =
      (1000 - rates.includedUncachedEgressGb) * rates.egressUncachedOverageUsdPerGb;
    const expectedCachedOverage = (500 - rates.includedCachedEgressGb) * rates.egressCachedOverageUsdPerGb;
    expect(row.totalUsd).toBeCloseTo(
      rates.planBaseFeeUsdPerMonth + expectedStorageOverage + expectedUncachedOverage + expectedCachedOverage,
      2,
    );
  });

  it("throws on an unknown egressModel or previewMode", () => {
    expect(() => computeScenario({ key: "b", egressModel: "bogus" }, profile, rates, {})).toThrow(
      /Unknown egressModel/,
    );
    expect(() =>
      computeScenario(
        { key: "b", egressModel: "guest-behavior", previewMode: "bogus", guests: 1, browsingHoursPerGuest: 1 },
        profile,
        rates,
        {},
      ),
    ).toThrow(/Unknown previewMode/);
  });
});

describe("formatTable", () => {
  it("renders a header row and one row per scenario, column-aligned", () => {
    const rows = [
      {
        label: "Quiet",
        uncachedGb: 1.2,
        cachedGb: 0,
        storageGb: 15,
        storageOverageUsd: 0,
        uncachedOverageUsd: 0,
        cachedOverageUsd: 0,
        totalUsd: 25,
      },
    ];
    const table = formatTable(rows);
    expect(table).toContain("Scenario");
    expect(table).toContain("Total $/mo");
    expect(table).toContain("Quiet");
    expect(table.split("\n")).toHaveLength(3); // header, separator, one data row
  });
});

describe("sampleDerivativeAverages", () => {
  let dir;

  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns null when the derivatives directory does not exist", async () => {
    const result = await sampleDerivativeAverages(join(tmpdir(), "does-not-exist-verify-egress"));
    expect(result).toBeNull();
  });

  it("averages real file sizes per tier across hash subdirectories", async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "verify-egress-derivatives-"));
    await fs.mkdir(join(dir, "hash1"), { recursive: true });
    await fs.mkdir(join(dir, "hash2"), { recursive: true });
    await fs.writeFile(join(dir, "hash1", "960.avif"), Buffer.alloc(100));
    await fs.writeFile(join(dir, "hash2", "960.avif"), Buffer.alloc(300));

    const result = await sampleDerivativeAverages(dir);
    expect(result["960.avif"]).toEqual({ avgBytes: 200, sampleCount: 2 });
  });

  it("stops scanning once maxFiles is reached", async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "verify-egress-derivatives-cap-"));
    for (let i = 0; i < 10; i += 1) {
      await fs.mkdir(join(dir, `hash${i}`), { recursive: true });
      await fs.writeFile(join(dir, `hash${i}`, "480.avif"), Buffer.alloc(10));
    }
    const result = await sampleDerivativeAverages(dir, { maxFiles: 3 });
    expect(result["480.avif"].sampleCount).toBeLessThanOrEqual(3);
  });
});

describe("estimateStorageEgress (integration)", () => {
  let workDir;
  const silentLog = () => {};

  beforeEach(async () => {
    workDir = await fs.mkdtemp(join(tmpdir(), "verify-egress-integration-"));
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  async function writeCatalog(overrides = {}) {
    const catalogPath = join(workDir, "catalog.json");
    await fs.writeFile(
      catalogPath,
      JSON.stringify({
        stats: { importedPhotos: 1721, totalOriginalBytes: 12_415_914_861, ...overrides },
      }),
    );
    return catalogPath;
  }

  it("produces one row per default scenario and writes the report to disk, using the fallback bytes when no derivatives dir is given", async () => {
    const catalogPath = await writeCatalog();
    const reportPath = join(workDir, "report.json");
    const { exitCode, report } = await estimateStorageEgress(
      [
        "--catalog",
        catalogPath,
        "--derivatives-dir",
        join(workDir, "no-such-derivatives"),
        "--report",
        reportPath,
      ],
      { log: silentLog },
    );
    expect(exitCode).toBe(0);
    expect(report.scenarios.map((s) => s.key)).toEqual(DEFAULT_SCENARIOS.map((s) => s.key));
    expect(report.assumptions.derivativeSampling.source).toMatch(/fallback/);

    const onDisk = JSON.parse(await fs.readFile(reportPath, "utf8"));
    expect(onDisk.scenarios).toHaveLength(DEFAULT_SCENARIOS.length);
  });

  it("throws a clear error when the catalog is missing stats", async () => {
    const catalogPath = join(workDir, "bad-catalog.json");
    await fs.writeFile(catalogPath, JSON.stringify({ photos: [] }));
    await expect(
      estimateStorageEgress(["--catalog", catalogPath, "--report", join(workDir, "r.json")], {
        log: silentLog,
      }),
    ).rejects.toThrow(/missing stats/);
  });

  it("applies a --rates file override end to end", async () => {
    const catalogPath = await writeCatalog();
    const ratesPath = join(workDir, "rates.json");
    await fs.writeFile(ratesPath, JSON.stringify({ planBaseFeeUsdPerMonth: 999 }));
    const { report } = await estimateStorageEgress(
      [
        "--catalog",
        catalogPath,
        "--derivatives-dir",
        join(workDir, "no-such-derivatives"),
        "--rates",
        ratesPath,
        "--report",
        join(workDir, "report.json"),
      ],
      { log: silentLog },
    );
    expect(report.rates.planBaseFeeUsdPerMonth).toBe(999);
    expect(report.scenarios.every((s) => s.totalUsd >= 999)).toBe(true);
  });

  it("applies a --scenarios file override end to end (wholesale replacement)", async () => {
    const catalogPath = await writeCatalog();
    const scenariosPath = join(workDir, "scenarios.json");
    await fs.writeFile(
      scenariosPath,
      JSON.stringify([{ key: "only-one", label: "Only One", egressModel: "direct", uncachedGb: 1, cachedGb: 0 }]),
    );
    const { report } = await estimateStorageEgress(
      [
        "--catalog",
        catalogPath,
        "--derivatives-dir",
        join(workDir, "no-such-derivatives"),
        "--scenarios",
        scenariosPath,
        "--report",
        join(workDir, "report.json"),
      ],
      { log: silentLog },
    );
    expect(report.scenarios).toHaveLength(1);
    expect(report.scenarios[0].key).toBe("only-one");
  });

  it("uses a real sampled derivatives directory when one is supplied", async () => {
    const catalogPath = await writeCatalog();
    const derivativesDir = join(workDir, "derivatives");
    await fs.mkdir(join(derivativesDir, "hash1"), { recursive: true });
    await fs.writeFile(join(derivativesDir, "hash1", "960.avif"), Buffer.alloc(12345));
    await fs.writeFile(join(derivativesDir, "hash1", "960.webp"), Buffer.alloc(23456));

    const { report } = await estimateStorageEgress(
      ["--catalog", catalogPath, "--derivatives-dir", derivativesDir, "--report", join(workDir, "report.json")],
      { log: silentLog },
    );
    expect(report.assumptions.derivativeSampling.source).toBe("local derivatives on disk");
    expect(report.assumptions.derivativeSampling.tiersSampled).toBeGreaterThan(0);
  });
});

function round2(n) {
  return Math.round(n * 100) / 100;
}
