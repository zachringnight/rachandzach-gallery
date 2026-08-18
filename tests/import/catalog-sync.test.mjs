// Packet 13: catalog sync tests. The database is the in-memory mock client;
// storage readiness comes from a checkpoint produced by the (mocked) storage
// sync. No network anywhere.
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncGalleryStorage } from "../../scripts/sync-gallery-storage.mjs";
import {
  parseCatalogArgs,
  partitionByStorageReadiness,
  syncGalleryCatalog,
} from "../../scripts/sync-gallery-catalog.mjs";
import {
  PREVIEWS_BUCKET,
  parseSyncCatalog,
} from "../../src/lib/import/sync-contracts.ts";
import { loadSyncState, saveSyncState } from "../../src/lib/import/sync-state.ts";
import { createMockDatabase, createMockStorage } from "../fixtures/sync/mock-clients.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CATALOG_PATH = join(REPO_ROOT, "tests/fixtures/catalog.json");
const PHOTOS_ROOT = join(REPO_ROOT, "tests/fixtures/photos");
const DERIVATIVE_ROOT = join(PHOTOS_ROOT, "derivatives");

const HASH_1 = "a".repeat(32);
const HASH_2 = "b".repeat(32);
const HASH_3 = "c".repeat(32);

const TEST_REF = "testref1234567890000";
const silent = () => {};

let workDir;
let statePath;
let reportPath;
let envFilePath;

beforeEach(async () => {
  workDir = await fs.mkdtemp(join(tmpdir(), "catalog-sync-test-"));
  statePath = join(workDir, "sync-state.json");
  reportPath = join(workDir, "sync-report.json");
  envFilePath = join(workDir, "env.synthetic");
  await fs.writeFile(
    envFilePath,
    [
      `SUPABASE_URL=https://${TEST_REF}.supabase.co`,
      "SUPABASE_SERVICE_ROLE_KEY=synthetic-test-service-role-key",
    ].join("\n"),
  );
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

/** Runs the storage sync against a mock so the checkpoint marks all 18 objects verified. */
async function prepareStorageState() {
  const mock = createMockStorage();
  const result = await syncGalleryStorage(
    {
      execute: true,
      catalogPath: CATALOG_PATH,
      sourceRoot: PHOTOS_ROOT,
      derivativeRoot: DERIVATIVE_ROOT,
      concurrency: 3,
      resumeStatePath: statePath,
      reportPath,
      projectRef: TEST_REF,
      allowedProjectRefs: [TEST_REF],
      envFilePath,
    },
    { log: silent, storageClientFactory: () => mock.client },
  );
  expect(result.failed).toEqual([]);
  return mock;
}

function catalogOptions(overrides = {}) {
  return {
    execute: false,
    catalogPath: CATALOG_PATH,
    resumeStatePath: statePath,
    reportPath,
    projectRef: null,
    catalogBatchSize: 100,
    ...overrides,
  };
}

function executeCatalogOptions(overrides = {}) {
  return catalogOptions({
    execute: true,
    projectRef: TEST_REF,
    allowedProjectRefs: [TEST_REF],
    envFilePath,
    ...overrides,
  });
}

describe("dry-run planner", () => {
  it("plans exact row operations with zero database access when storage is ready", async () => {
    await prepareStorageState();
    const result = await syncGalleryCatalog(catalogOptions({ projectRef: TEST_REF }), {
      log: silent,
    });
    // 2 events + 2 people + 3 photos + 15 previews + 4 joins + 3 keywords = 29
    expect(result.planned).toBe(29);
    expect(result.catalogRowsUpserted).toBe(0);
    expect(result.failed).toEqual([]);

    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    expect(report.catalog.plannedRows).toEqual({
      events: 2,
      people: 2,
      photos: 3,
      previews: 15,
      joins: 4,
      keywords: 3,
      total: 29,
    });
    expect(report.catalog.storageGate).toEqual({ readyPhotos: 3, gatedPhotos: 0 });
    // The storage section written by the earlier run is preserved (merged report).
    expect(report.storage).toBeDefined();
  });

  it("gates every photo when no storage checkpoint exists", async () => {
    const result = await syncGalleryCatalog(catalogOptions(), { log: silent });
    expect(result.failed).toHaveLength(3);
    for (const failure of result.failed) {
      expect(failure.stage).toBe("storage-gate");
    }
    // Only events + people remain plannable.
    expect(result.planned).toBe(4);
  });

  it("refuses a catalog with duplicate photo IDs", async () => {
    const catalog = JSON.parse(await fs.readFile(CATALOG_PATH, "utf8"));
    catalog.photos.push({ ...catalog.photos[0] });
    const catalogPath = join(workDir, "catalog-duplicate.json");
    await fs.writeFile(catalogPath, JSON.stringify(catalog));
    await expect(
      syncGalleryCatalog(catalogOptions({ catalogPath }), { log: silent }),
    ).rejects.toThrow(/duplicate/i);
  });
});

describe("execution gating", () => {
  it("refuses to execute without an allowlisted project ref, before any DB call", async () => {
    await prepareStorageState();
    const mock = createMockDatabase();
    const deps = { log: silent, dbClientFactory: () => mock.client };
    await expect(
      syncGalleryCatalog(executeCatalogOptions({ allowedProjectRefs: [] }), deps),
    ).rejects.toThrow(/allowlist/i);
    await expect(
      syncGalleryCatalog(
        executeCatalogOptions({ allowedProjectRefs: ["someotherref000000000"] }),
        deps,
      ),
    ).rejects.toThrow(/not in the runtime allowlist/i);
    expect(mock.calls).toEqual([]);
  });

  it("refuses to execute without any storage checkpoint", async () => {
    const mock = createMockDatabase();
    await expect(
      syncGalleryCatalog(executeCatalogOptions(), {
        log: silent,
        dbClientFactory: () => mock.client,
      }),
    ).rejects.toThrow(/No sync state/);
    expect(mock.calls).toEqual([]);
  });
});

describe("mocked execution", () => {
  it("upserts events and people first, then photos, previews, joins, keywords, and verifies counts", async () => {
    await prepareStorageState();
    const mock = createMockDatabase();
    const result = await syncGalleryCatalog(executeCatalogOptions(), {
      log: silent,
      dbClientFactory: () => mock.client,
    });
    expect(result.failed).toEqual([]);
    expect(result.catalogRowsUpserted).toBe(29);

    // Ordering: events, then people, then photos.
    const upsertTables = mock.calls.filter((c) => c.op === "upsert").map((c) => c.table);
    expect(upsertTables.indexOf("rachandzach_events")).toBeLessThan(
      upsertTables.indexOf("rachandzach_people"),
    );
    expect(upsertTables.indexOf("rachandzach_people")).toBeLessThan(
      upsertTables.indexOf("rachandzach_photos"),
    );

    const events = mock.rows("rachandzach_events");
    expect(events.map((row) => row.slug).sort()).toEqual(["ceremony", "dancing"]);

    const photos = mock.rows("rachandzach_photos");
    expect(photos).toHaveLength(3);
    for (const row of photos) {
      // Catalog->DB vocabulary mapping (schema check constraints).
      expect(row.source).toBe("master");
      expect(row.status).toBe("published");
      expect(row.original_bucket).toBe("rachandzach-originals");
      // Content-hash constraint parity: original_object embeds sha256[0:16].
      expect(row.original_object).toContain(row.file_sha256.slice(0, 16));
      expect(row.event_id).toBeTruthy();
    }

    const previews = mock.rows("rachandzach_photo_previews");
    expect(previews).toHaveLength(15);
    for (const row of previews) {
      expect(row.bucket).toBe(PREVIEWS_BUCKET);
      expect(row.bytes).toBeGreaterThan(0);
    }

    expect(mock.rows("rachandzach_photo_people")).toHaveLength(4);
    expect(mock.rows("rachandzach_photo_keywords")).toHaveLength(3);

    // Recomputed denormalized counts.
    const people = mock.rows("rachandzach_people");
    const bySlug = Object.fromEntries(people.map((row) => [row.slug, row.photo_count]));
    expect(bySlug).toEqual({ "rachel-casciano": 2, "zach-soskin": 2 });

    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    expect(report.catalog.verification.eventCounts).toEqual({ ceremony: 2, dancing: 1 });
    expect(report.catalog.verification.batches).toEqual([
      { batch: 0, photos: 3, verified: true },
    ]);

    // Checkpoint now records the catalog rows.
    const state = await loadSyncState(statePath);
    expect(Object.keys(state.catalog).sort()).toEqual([HASH_1, HASH_2, HASH_3].sort());
  });

  it("retry never creates a second photo and keeps ids stable", async () => {
    await prepareStorageState();
    const mock = createMockDatabase();
    const deps = { log: silent, dbClientFactory: () => mock.client };
    await syncGalleryCatalog(executeCatalogOptions(), deps);
    const idsFirst = mock.rows("rachandzach_photos").map((row) => row.id).sort();

    const second = await syncGalleryCatalog(executeCatalogOptions(), deps);
    expect(second.failed).toEqual([]);
    expect(second.skippedExisting).toBe(3); // previously checkpointed photos
    expect(second.catalogRowsUpserted).toBe(4); // events + people only; photos skipped
    const photos = mock.rows("rachandzach_photos");
    expect(photos).toHaveLength(3);
    expect(photos.map((row) => row.id).sort()).toEqual(idsFirst);
    expect(mock.rows("rachandzach_photo_previews")).toHaveLength(15);
    expect(mock.rows("rachandzach_photo_people")).toHaveLength(4);
  });

  it("a failed photo batch stops the run, checkpoints nothing, and a rerun recovers", async () => {
    await prepareStorageState();
    const failing = createMockDatabase({
      failures: [{ table: "rachandzach_photos", op: "upsert" }],
    });
    const first = await syncGalleryCatalog(executeCatalogOptions({ catalogBatchSize: 2 }), {
      log: silent,
      dbClientFactory: () => failing.client,
    });
    expect(first.failed.some((f) => f.stage === "catalog-batch")).toBe(true);
    // Events and people landed; no photos did, and none were checkpointed.
    expect(failing.rows("rachandzach_photos")).toHaveLength(0);
    expect(first.catalogRowsUpserted).toBe(4);
    const stateAfterFailure = await loadSyncState(statePath);
    expect(Object.keys(stateAfterFailure.catalog)).toHaveLength(0);

    // Rerun against a healthy database: full recovery.
    const healthy = createMockDatabase();
    const second = await syncGalleryCatalog(executeCatalogOptions({ catalogBatchSize: 2 }), {
      log: silent,
      dbClientFactory: () => healthy.client,
    });
    expect(second.failed).toEqual([]);
    expect(healthy.rows("rachandzach_photos")).toHaveLength(3);
    expect(second.catalogRowsUpserted).toBe(29);
  });

  it("photos missing storage verification are refused while the rest sync", async () => {
    await prepareStorageState();
    // Remove one preview object from the checkpoint: that photo is not ready.
    const state = await loadSyncState(statePath);
    delete state.objects[`${PREVIEWS_BUCKET}/previews/${HASH_3}/480.avif`];
    await saveSyncState(statePath, state);

    const mock = createMockDatabase();
    const result = await syncGalleryCatalog(executeCatalogOptions(), {
      log: silent,
      dbClientFactory: () => mock.client,
    });
    const gate = result.failed.filter((f) => f.stage === "storage-gate");
    expect(gate).toHaveLength(1);
    expect(gate[0].imageDataHash).toBe(HASH_3);
    expect(mock.rows("rachandzach_photos")).toHaveLength(2);
    expect(
      mock.rows("rachandzach_photos").map((row) => row.image_data_hash).sort(),
    ).toEqual([HASH_1, HASH_2]);
  });
});

describe("partitionByStorageReadiness", () => {
  it("reports exactly which objects are missing", async () => {
    const catalog = parseSyncCatalog(JSON.parse(await fs.readFile(CATALOG_PATH, "utf8")));
    const { ready, gated } = partitionByStorageReadiness(catalog, null);
    expect(ready).toEqual([]);
    expect(gated).toHaveLength(3);
    expect(gated[0].failure.reason).toMatch(/sync-gallery-storage/);
  });

  it("refuses a preview checkpoint that exists but has no hash or bytes", async () => {
    await prepareStorageState();
    const state = await loadSyncState(statePath);
    const staleKey = `${PREVIEWS_BUCKET}/previews/${HASH_1}/480.avif`;
    state.objects[staleKey] = {
      ...state.objects[staleKey],
      fileSha256: "",
      bytes: 0,
    };
    await saveSyncState(statePath, state);

    const { ready, gated } = partitionByStorageReadiness(
      parseSyncCatalog(JSON.parse(await fs.readFile(CATALOG_PATH, "utf8"))),
      await loadSyncState(statePath),
    );
    expect(gated.some((entry) => entry.photo.imageDataHash === HASH_1)).toBe(true);
    expect(ready.map((photo) => photo.imageDataHash).sort()).toEqual(
      [HASH_2, HASH_3].sort(),
    );
  });
});

describe("CLI argument contract", () => {
  it("defaults to dry-run and parses the gating flags", () => {
    const args = parseCatalogArgs(["--catalog", "tests/fixtures/catalog.json"]);
    expect(args.execute).toBe(false);
    const executeArgs = parseCatalogArgs([
      "--catalog",
      "c.json",
      "--execute",
      "--project-ref",
      "rnfvmqflktghriqefatc",
      "--allowlist",
      "rnfvmqflktghriqefatc",
      "--env-file",
      ".env.cloud",
    ]);
    expect(executeArgs.execute).toBe(true);
    expect(executeArgs.allowedProjectRefs).toEqual(["rnfvmqflktghriqefatc"]);
    expect(() => parseCatalogArgs(["--catalog", "c.json", "--execute", "--dry-run"])).toThrow(
      /mutually exclusive/,
    );
  });
});
