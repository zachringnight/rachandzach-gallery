// Unit + integration coverage for scripts/verify-original-integrity.mjs
// (packet 12B). Integration tests build a miniature clean-master root and a
// matching catalog JSON at runtime; nothing here touches the real Wedding
// Master Clean, src/generated/gallery-v2.json, or any network. Remote checks
// are exercised purely via injected fake clients (deps.remoteClientFactory).
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseArgs,
  selectSample,
  verifyLocalPhoto,
  verifyRemotePhoto,
  verifyOriginalIntegrity,
} from "../../scripts/verify-original-integrity.mjs";
import { originalObjectPath, ORIGINALS_BUCKET } from "../../src/lib/import/sync-contracts.ts";
import { buildMiniFixture, writeEnvFile } from "../fixtures/verify/build-fixtures.mjs";

describe("parseArgs", () => {
  it("defaults to sampling 100 with the fixed reproducible seed", () => {
    const args = parseArgs([]);
    expect(args.sampleSize).toBe(100);
    expect(args.full).toBe(false);
    expect(args.remote).toBe(false);
    expect(Number.isInteger(args.seed)).toBe(true);
  });

  it("parses --sample, --full, --seed, --catalog, --source/--master", () => {
    expect(parseArgs(["--sample", "25"]).sampleSize).toBe(25);
    expect(parseArgs(["--full"]).full).toBe(true);
    expect(parseArgs(["--seed", "7"]).seed).toBe(7);
    expect(parseArgs(["--catalog", "/tmp/c.json"]).catalogPath).toBe("/tmp/c.json");
    expect(parseArgs(["--source", "/tmp/s"]).sourceRoot).toBe("/tmp/s");
    expect(parseArgs(["--master", "/tmp/m"]).sourceRoot).toBe("/tmp/m");
  });

  it("parses the remote gate flags, splitting --allowlist on commas", () => {
    const args = parseArgs([
      "--remote",
      "--project-ref",
      "local",
      "--allowlist",
      "local, other",
      "--env-file",
      "/tmp/.env",
    ]);
    expect(args.remote).toBe(true);
    expect(args.projectRef).toBe("local");
    expect(args.allowlist).toEqual(["local", "other"]);
    expect(args.envFile).toBe("/tmp/.env");
  });

  it("rejects --full combined with an explicit --sample", () => {
    expect(() => parseArgs(["--full", "--sample", "10"])).toThrow(/mutually exclusive/);
  });

  it("rejects a non-positive-integer --sample", () => {
    expect(() => parseArgs(["--sample", "0"])).toThrow(/positive integer/);
    expect(() => parseArgs(["--sample", "abc"])).toThrow(/positive integer/);
  });

  it("rejects a non-integer --seed", () => {
    expect(() => parseArgs(["--seed", "abc"])).toThrow(/integer/);
  });
});

describe("selectSample", () => {
  const photos = Array.from({ length: 20 }, (_, i) => ({
    imageDataHash: String(i).padStart(2, "0").repeat(16).slice(0, 32),
  }));

  it("returns everything, sorted by hash, when full is true", () => {
    const sample = selectSample(photos, { full: true });
    expect(sample).toHaveLength(20);
    const hashes = sample.map((p) => p.imageDataHash);
    expect(hashes).toEqual([...hashes].sort());
  });

  it("draws exactly sampleSize unique items, all from the input pool", () => {
    const sample = selectSample(photos, { sampleSize: 5, seed: 1 });
    expect(sample).toHaveLength(5);
    const hashes = new Set(sample.map((p) => p.imageDataHash));
    expect(hashes.size).toBe(5);
    for (const h of hashes) {
      expect(photos.some((p) => p.imageDataHash === h)).toBe(true);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = selectSample(photos, { sampleSize: 6, seed: 42 });
    const b = selectSample(photos, { sampleSize: 6, seed: 42 });
    expect(a.map((p) => p.imageDataHash)).toEqual(b.map((p) => p.imageDataHash));
  });

  it("caps the sample at the pool size when sampleSize exceeds it", () => {
    const sample = selectSample(photos, { sampleSize: 1000, seed: 1 });
    expect(sample).toHaveLength(20);
  });
});

describe("verifyLocalPhoto", () => {
  let fixture;

  beforeEach(async () => {
    fixture = await buildMiniFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("matches when the on-disk bytes reproduce the recorded sha256 and size", async () => {
    const result = await verifyLocalPhoto(fixture.photos[0], fixture.masterRoot);
    expect(result).toEqual({
      imageDataHash: fixture.hashA,
      path: "01 Ceremony/ceremony-1.jpg",
      ok: true,
    });
  });

  it("reports sha256_mismatch when the recorded hash is wrong", async () => {
    const tampered = { ...fixture.photos[0], fileSha256: "0".repeat(64) };
    const result = await verifyLocalPhoto(tampered, fixture.masterRoot);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^sha256_mismatch/);
  });

  it("reports size_mismatch when the recorded byte count is wrong", async () => {
    const tampered = { ...fixture.photos[0], originalBytes: fixture.photos[0].originalBytes + 1 };
    const result = await verifyLocalPhoto(tampered, fixture.masterRoot);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^size_mismatch/);
  });

  it("reports missing_file when the source path does not exist", async () => {
    const tampered = { ...fixture.photos[0], originalRelativePath: "01 Ceremony/nope.jpg" };
    const result = await verifyLocalPhoto(tampered, fixture.masterRoot);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^missing_file/);
  });
});

describe("verifyRemotePhoto", () => {
  let fixture;

  beforeEach(async () => {
    fixture = await buildMiniFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("is ok when the db row and storage info both match the catalog", async () => {
    const photo = fixture.photos[0];
    const objectPath = originalObjectPath(photo);
    const client = makeFakeRemoteClient({
      dbRows: {
        [photo.imageDataHash]: {
          file_sha256: photo.fileSha256,
          original_bytes: photo.originalBytes,
          original_object: objectPath,
        },
      },
      storageInfo: {
        [objectPath]: { size: photo.originalBytes, metadata: { fileSha256: photo.fileSha256 } },
      },
    });
    const result = await verifyRemotePhoto(client, photo);
    expect(result).toEqual({ imageDataHash: photo.imageDataHash, objectPath, ok: true, reasons: [] });
  });

  it("collects every mismatch reason instead of stopping at the first", async () => {
    const photo = fixture.photos[0];
    const objectPath = originalObjectPath(photo);
    const client = makeFakeRemoteClient({
      dbRows: {
        [photo.imageDataHash]: {
          file_sha256: "0".repeat(64),
          original_bytes: photo.originalBytes + 1,
          original_object: "originals/wrong/path.jpg",
        },
      },
      storageInfo: {
        [objectPath]: { size: photo.originalBytes + 5, metadata: { fileSha256: "1".repeat(64) } },
      },
    });
    const result = await verifyRemotePhoto(client, photo);
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual([
      expect.stringMatching(/db file_sha256 mismatch/),
      expect.stringMatching(/db original_bytes mismatch/),
      expect.stringMatching(/db original_object mismatch/),
      expect.stringMatching(/storage size mismatch/),
      expect.stringMatching(/storage metadata fileSha256 mismatch/),
    ]);
  });

  it("flags a missing db row and a missing storage object distinctly", async () => {
    const photo = fixture.photos[0];
    const client = makeFakeRemoteClient({ dbRows: {}, storageInfo: {} });
    const result = await verifyRemotePhoto(client, photo);
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual([
      "db row not found for image_data_hash",
      "storage object not found",
    ]);
  });
});

describe("verifyOriginalIntegrity (integration)", () => {
  let fixture;
  const silentLog = () => {};

  beforeEach(async () => {
    fixture = await buildMiniFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("passes locally and reports the remote section as skipped when --remote is not given", async () => {
    const catalogPath = await fixture.writeCatalogFile();
    const { exitCode, report } = await verifyOriginalIntegrity(
      ["--catalog", catalogPath, "--source", fixture.masterRoot, "--full"],
      { log: silentLog },
    );
    expect(exitCode).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.local).toMatchObject({ checked: 2, ok: true });
    expect(report.remote.attempted).toBe(false);
  });

  it("fails when a sampled original's bytes no longer match its recorded sha256", async () => {
    const catalogPath = await fixture.writeCatalogFile();
    // Tamper the source file after the catalog (and its fileSha256) was fixed.
    await fs.appendFile(fixture.pathA, Buffer.from("tampered"));

    const { exitCode, report } = await verifyOriginalIntegrity(
      ["--catalog", catalogPath, "--source", fixture.masterRoot, "--full"],
      { log: silentLog },
    );
    expect(exitCode).toBe(1);
    expect(report.local.ok).toBe(false);
    expect(report.local.mismatches.some((m) => m.reason.startsWith("size_mismatch"))).toBe(true);
  });

  it("fails when a sampled original is missing from disk", async () => {
    const catalogPath = await fixture.writeCatalogFile();
    await fs.rm(fixture.pathB);

    const { exitCode, report } = await verifyOriginalIntegrity(
      ["--catalog", catalogPath, "--source", fixture.masterRoot, "--full"],
      { log: silentLog },
    );
    expect(exitCode).toBe(1);
    expect(report.local.mismatches.some((m) => m.reason.startsWith("missing_file"))).toBe(true);
  });

  it("skips the remote section with a reason when --remote is given without --env-file", async () => {
    const catalogPath = await fixture.writeCatalogFile();
    const { report } = await verifyOriginalIntegrity(
      ["--catalog", catalogPath, "--source", fixture.masterRoot, "--full", "--remote"],
      { log: silentLog },
    );
    expect(report.remote.attempted).toBe(false);
    expect(report.remote.reason).toMatch(/--env-file/);
  });

  it("refuses a non-loopback --env-file under --remote without calling the client factory", async () => {
    const catalogPath = await fixture.writeCatalogFile();
    const envFile = await writeEnvFile({
      SUPABASE_URL: "https://rnfvmqflktghriqefatc.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key",
    });
    let called = false;
    const { exitCode, report } = await verifyOriginalIntegrity(
      [
        "--catalog",
        catalogPath,
        "--source",
        fixture.masterRoot,
        "--full",
        "--remote",
        "--project-ref",
        "local",
        "--allowlist",
        "local",
        "--env-file",
        envFile,
      ],
      {
        log: silentLog,
        remoteClientFactory: async () => {
          called = true;
          throw new Error("must never be called for a cloud host");
        },
      },
    );
    expect(called).toBe(false);
    expect(report.remote.attempted).toBe(false);
    expect(report.remote.reason).toMatch(/loopback/i);
    // Local originals still matched, so a refused remote check alone does
    // not fail the run.
    expect(exitCode).toBe(0);
  });

  it("reconciles against a reachable local remote client", async () => {
    const catalogPath = await fixture.writeCatalogFile();
    const envFile = await writeEnvFile({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
    });
    const dbRows = {};
    const storageInfo = {};
    for (const photo of fixture.photos) {
      const objectPath = originalObjectPath(photo);
      dbRows[photo.imageDataHash] = {
        file_sha256: photo.fileSha256,
        original_bytes: photo.originalBytes,
        original_object: objectPath,
      };
      storageInfo[objectPath] = { size: photo.originalBytes, metadata: { fileSha256: photo.fileSha256 } };
    }

    const { exitCode, report } = await verifyOriginalIntegrity(
      [
        "--catalog",
        catalogPath,
        "--source",
        fixture.masterRoot,
        "--full",
        "--remote",
        "--project-ref",
        "local",
        "--allowlist",
        "local",
        "--env-file",
        envFile,
      ],
      {
        log: silentLog,
        remoteClientFactory: async () => makeFakeRemoteClient({ dbRows, storageInfo }),
      },
    );
    expect(report.remote).toMatchObject({ attempted: true, reachable: true, ok: true, checked: 2 });
    expect(exitCode).toBe(0);
  });

  it("fails the run when the reachable remote disagrees with the catalog", async () => {
    const catalogPath = await fixture.writeCatalogFile();
    const envFile = await writeEnvFile({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
    });

    const { exitCode, report } = await verifyOriginalIntegrity(
      [
        "--catalog",
        catalogPath,
        "--source",
        fixture.masterRoot,
        "--full",
        "--remote",
        "--project-ref",
        "local",
        "--allowlist",
        "local",
        "--env-file",
        envFile,
      ],
      {
        log: silentLog,
        // Empty remote: every sampled photo is "not found" remotely.
        remoteClientFactory: async () => makeFakeRemoteClient({ dbRows: {}, storageInfo: {} }),
      },
    );
    expect(report.remote.ok).toBe(false);
    expect(exitCode).toBe(1);
  });
});

/** Minimal fake supabase-js client: only the calls verifyRemotePhoto() makes. */
function makeFakeRemoteClient({ dbRows, storageInfo }) {
  return {
    from(table) {
      if (table !== "rachandzach_photos") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq(_column, hash) {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: dbRows[hash] ?? null, error: null });
                },
              };
            },
          };
        },
      };
    },
    storage: {
      from(bucket) {
        if (bucket !== ORIGINALS_BUCKET) throw new Error(`unexpected bucket ${bucket}`);
        return {
          info(objectPath) {
            return Promise.resolve({ data: storageInfo[objectPath] ?? null, error: null });
          },
        };
      },
    },
  };
}
