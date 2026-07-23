// Unit + integration coverage for scripts/verify-gallery-catalog.mjs
// (packet 12B). Integration tests build a miniature clean-master root and a
// matching catalog JSON at runtime; nothing here touches the real Wedding
// Master Clean, src/generated/gallery-v2.json, or any network. Database
// checks are exercised purely via injected fake clients (deps.dbClientFactory).
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseArgs,
  isLoopbackHost,
  diffImageHashes,
  reconcileCountMaps,
  buildDbUnblockNotice,
  verifyGalleryCatalog,
} from "../../scripts/verify-gallery-catalog.mjs";
import { buildMiniFixture, writeEnvFile } from "../fixtures/verify/build-fixtures.mjs";

describe("parseArgs", () => {
  it("defaults to no database check and the repo's real catalog path", () => {
    const args = parseArgs([]);
    expect(args.dbEnvFile).toBeNull();
    expect(args.help).toBe(false);
    expect(args.catalogPath).toMatch(/gallery-v2\.json$/);
  });

  it("reads --master, --source (alias), --catalog, --db-env-file, --report", () => {
    expect(parseArgs(["--master", "/tmp/m"]).masterRoot).toBe("/tmp/m");
    expect(parseArgs(["--source", "/tmp/s"]).masterRoot).toBe("/tmp/s");
    expect(parseArgs(["--catalog", "/tmp/c.json"]).catalogPath).toBe("/tmp/c.json");
    expect(parseArgs(["--db-env-file", "/tmp/.env"]).dbEnvFile).toBe("/tmp/.env");
    expect(parseArgs(["--report", "/tmp/r.json"]).reportPath).toBe("/tmp/r.json");
  });

  it("recognizes --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("throws on an unknown argument", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
  });
});

describe("isLoopbackHost", () => {
  it("accepts loopback hosts", () => {
    expect(isLoopbackHost("http://127.0.0.1:54321")).toBe(true);
    expect(isLoopbackHost("http://localhost:54321")).toBe(true);
    expect(isLoopbackHost("http://[::1]:54321")).toBe(true);
  });

  it("rejects cloud and other non-loopback hosts", () => {
    expect(isLoopbackHost("https://rnfvmqflktghriqefatc.supabase.co")).toBe(false);
    expect(isLoopbackHost("https://example.com")).toBe(false);
  });

  it("returns false for an unparseable URL instead of throwing", () => {
    expect(isLoopbackHost("not a url")).toBe(false);
  });
});

describe("diffImageHashes", () => {
  it("finds hashes on only one side", () => {
    const master = new Set(["a", "b", "c"]);
    const catalog = new Set(["b", "c", "d"]);
    expect(diffImageHashes(master, catalog)).toEqual({
      missingFromCatalog: ["a"],
      missingFromMaster: ["d"],
    });
  });

  it("returns empty arrays when the sets match exactly", () => {
    const set = new Set(["a", "b"]);
    expect(diffImageHashes(set, new Set(set))).toEqual({
      missingFromCatalog: [],
      missingFromMaster: [],
    });
  });
});

describe("reconcileCountMaps", () => {
  it("reports mismatches only for slugs present on both sides", () => {
    const master = new Map([
      ["ceremony", 10],
      ["dancing", 5],
      ["only-master", 1],
    ]);
    const catalog = new Map([
      ["ceremony", 10],
      ["dancing", 6],
      ["only-catalog", 2],
    ]);
    expect(reconcileCountMaps(master, catalog)).toEqual({
      mismatches: [{ slug: "dancing", masterCount: 5, catalogCount: 6 }],
      onlyInMaster: ["only-master"],
      onlyInCatalog: ["only-catalog"],
    });
  });

  it("is clean when both maps agree exactly", () => {
    const map = new Map([["ceremony", 3]]);
    expect(reconcileCountMaps(map, new Map(map))).toEqual({
      mismatches: [],
      onlyInMaster: [],
      onlyInCatalog: [],
    });
  });
});

describe("buildDbUnblockNotice", () => {
  it("names the unblock command and the local-only policy", () => {
    const notice = buildDbUnblockNotice();
    expect(notice).toContain("supabase start");
    expect(notice).toContain("--db-env-file");
    expect(notice).toMatch(/loopback/i);
  });
});

describe("verifyGalleryCatalog (integration)", () => {
  let fixture;
  const silentLog = () => {};

  beforeEach(async () => {
    fixture = await buildMiniFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("passes and skips the database section when master and catalog agree and no --db-env-file is given", async () => {
    const catalogPath = await fixture.writeCatalogFile();
    const reportPath = join(dirname(catalogPath), "report.json");
    const { exitCode, report } = await verifyGalleryCatalog(
      ["--master", fixture.masterRoot, "--catalog", catalogPath, "--report", reportPath],
      { log: silentLog },
    );
    expect(exitCode).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.countsMatch).toBe(true);
    expect(report.hashDiff).toEqual({ missingFromCatalog: [], missingFromMaster: [] });
    expect(report.database).toMatchObject({ attempted: false, reason: "no --db-env-file supplied" });
    expect(report.master.validPhotos).toBe(2);
    expect(report.catalog.photos).toBe(2);

    // The report is also persisted to disk at --report, not just returned.
    const reportOnDisk = JSON.parse(await fs.readFile(reportPath, "utf8"));
    expect(reportOnDisk.ok).toBe(true);
  });

  it("flags a master photo that has not yet been imported into the local catalog", async () => {
    const onlyFirst = fixture.catalogObject({ photos: [fixture.photos[0]] });
    onlyFirst.stats = { ...onlyFirst.stats, importedPhotos: 1, totalOriginalBytes: fixture.statA.size };
    onlyFirst.events = [{ slug: "ceremony", name: "Ceremony", order: 0, photoCount: 1 }];
    onlyFirst.people = [{ slug: "rachel-casciano", name: "Rachel Casciano", photoCount: 1 }];
    const catalogPath = await fixture.writeCatalogFile(onlyFirst);

    const { exitCode, report } = await verifyGalleryCatalog(
      ["--master", fixture.masterRoot, "--catalog", catalogPath],
      { log: silentLog },
    );
    expect(exitCode).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.hashDiff.missingFromCatalog).toEqual([fixture.hashB]);
    expect(report.problems.join(" ")).toMatch(/not yet reflected in the local catalog/);
  });

  it("flags a catalog photo with no matching valid row in the master (missing original)", async () => {
    const bogusHash = "c3".repeat(16);
    const bogusPhoto = {
      ...fixture.photos[0],
      id: bogusHash,
      imageDataHash: bogusHash,
      originalRelativePath: "01 Ceremony/does-not-exist.jpg",
      previewObjects: [
        {
          objectPath: `previews/${bogusHash}/480.avif`,
          width: 480,
          height: 360,
          format: "avif",
          cacheControl: "public,max-age=31536000,immutable",
        },
      ],
    };
    const withOrphan = fixture.catalogObject({ photos: [...fixture.photos, bogusPhoto] });
    withOrphan.stats = { ...withOrphan.stats, importedPhotos: 3 };
    const catalogPath = await fixture.writeCatalogFile(withOrphan);

    const { exitCode, report } = await verifyGalleryCatalog(
      ["--master", fixture.masterRoot, "--catalog", catalogPath],
      { log: silentLog },
    );
    expect(exitCode).toBe(1);
    expect(report.hashDiff.missingFromMaster).toEqual([bogusHash]);
    expect(report.problems.join(" ")).toMatch(/no matching valid source row in the master/);
  });

  it("flags event/person photoCount drift even when the hash sets match", async () => {
    const drifted = fixture.catalogObject();
    drifted.events = drifted.events.map((e) => (e.slug === "dancing" ? { ...e, photoCount: 99 } : e));
    const catalogPath = await fixture.writeCatalogFile(drifted);

    const { exitCode, report } = await verifyGalleryCatalog(
      ["--master", fixture.masterRoot, "--catalog", catalogPath],
      { log: silentLog },
    );
    expect(exitCode).toBe(1);
    expect(report.eventDiff.mismatches).toEqual([{ slug: "dancing", masterCount: 1, catalogCount: 99 }]);
  });

  it("refuses a non-loopback --db-env-file without attempting a connection", async () => {
    const catalogPath = await fixture.writeCatalogFile();
    const envFile = await writeEnvFile({
      SUPABASE_URL: "https://rnfvmqflktghriqefatc.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key",
    });
    let factoryCalled = false;
    const { exitCode, report } = await verifyGalleryCatalog(
      ["--master", fixture.masterRoot, "--catalog", catalogPath, "--db-env-file", envFile],
      {
        log: silentLog,
        dbClientFactory: async () => {
          factoryCalled = true;
          throw new Error("must never be called for a cloud host");
        },
      },
    );
    expect(factoryCalled).toBe(false);
    expect(report.database.attempted).toBe(false);
    expect(report.database.reason).toMatch(/not a loopback address/);
    // The catalog itself still reconciles cleanly, so a refused DB check
    // alone does not fail the run.
    expect(exitCode).toBe(0);
  });

  it("reconciles a reachable local database that agrees with the catalog", async () => {
    const catalogPath = await fixture.writeCatalogFile();
    const envFile = await writeEnvFile({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "local-anon-key",
    });
    const { exitCode, report } = await verifyGalleryCatalog(
      ["--master", fixture.masterRoot, "--catalog", catalogPath, "--db-env-file", envFile],
      { log: silentLog, dbClientFactory: async () => makeFakeDbClient({ count: 2, hashes: [fixture.hashA, fixture.hashB] }) },
    );
    expect(report.database).toMatchObject({ attempted: true, reachable: true, ok: true, dbCount: 2, catalogCount: 2 });
    expect(exitCode).toBe(0);
  });

  it("fails the run when a reachable local database disagrees with the catalog", async () => {
    const catalogPath = await fixture.writeCatalogFile();
    const envFile = await writeEnvFile({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "local-anon-key",
    });
    const { exitCode, report } = await verifyGalleryCatalog(
      ["--master", fixture.masterRoot, "--catalog", catalogPath, "--db-env-file", envFile],
      { log: silentLog, dbClientFactory: async () => makeFakeDbClient({ count: 1, hashes: [fixture.hashA] }) },
    );
    expect(report.database.ok).toBe(false);
    expect(exitCode).toBe(1);
    expect(report.problems.join(" ")).toMatch(/database reconciliation failed/);
  });

  it("degrades gracefully (does not crash the run) when the local database is unreachable", async () => {
    const catalogPath = await fixture.writeCatalogFile();
    const envFile = await writeEnvFile({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "local-anon-key",
    });
    const { exitCode, report } = await verifyGalleryCatalog(
      ["--master", fixture.masterRoot, "--catalog", catalogPath, "--db-env-file", envFile],
      {
        log: silentLog,
        dbClientFactory: async () => {
          throw new Error("ECONNREFUSED 127.0.0.1:54321");
        },
      },
    );
    expect(report.database).toMatchObject({ attempted: true, reachable: false });
    expect(report.database.unblock).toContain("supabase start");
    expect(exitCode).toBe(0);
  });
});

/** Minimal fake supabase-js client: only the calls checkDatabase() makes. */
function makeFakeDbClient({ count, hashes }) {
  return {
    from(table) {
      expect(table).toBe("rachandzach_photos");
      return {
        select(_cols, options = {}) {
          const builder = {
            eq() {
              return builder;
            },
            in(_column, values) {
              const present = new Set(hashes);
              return Promise.resolve({
                data: values.filter((v) => present.has(v)).map((v) => ({ image_data_hash: v })),
                error: null,
              });
            },
            then(resolve) {
              if (options.head) {
                resolve({ count, error: null });
              } else {
                resolve({ data: [], error: null });
              }
            },
          };
          return builder;
        },
      };
    },
  };
}
