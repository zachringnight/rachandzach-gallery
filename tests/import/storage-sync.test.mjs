// Packet 13: storage sync tests. Everything runs against local fixtures and
// the in-memory mock storage client; no network is ever touched.
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildStoragePlan,
  parseStorageArgs,
  syncGalleryStorage,
} from "../../scripts/sync-gallery-storage.mjs";
import {
  ORIGINALS_BUCKET,
  PREVIEWS_BUCKET,
  assertExecutionAllowed,
  originalObjectPath,
  parseSyncCatalog,
  readCredentialsFromEnvFile,
  sanitizeOriginalFilename,
} from "../../src/lib/import/sync-contracts.ts";
import {
  createSyncState,
  loadSyncState,
  saveSyncState,
  recordObject,
} from "../../src/lib/import/sync-state.ts";
import { createMockStorage } from "../fixtures/sync/mock-clients.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CATALOG_PATH = join(REPO_ROOT, "tests/fixtures/catalog.json");
const PHOTOS_ROOT = join(REPO_ROOT, "tests/fixtures/photos");
const DERIVATIVE_ROOT = join(PHOTOS_ROOT, "derivatives");

const HASH_1 = "a".repeat(32);
const HASH_2 = "b".repeat(32);

const TEST_REF = "testref1234567890000";
const silent = () => {};

let workDir;

beforeEach(async () => {
  workDir = await fs.mkdtemp(join(tmpdir(), "storage-sync-test-"));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

async function readCatalog() {
  return JSON.parse(await fs.readFile(CATALOG_PATH, "utf8"));
}

let envFileCounter = 0;
async function writeEnvFile(overrides = {}) {
  envFileCounter += 1;
  const envPath = join(workDir, `env-${envFileCounter}.synthetic`);
  const values = {
    SUPABASE_URL: `https://${TEST_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-service-role-key",
    ...overrides,
  };
  await fs.writeFile(
    envPath,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  );
  return envPath;
}

function baseOptions(overrides = {}) {
  return {
    execute: false,
    catalogPath: CATALOG_PATH,
    sourceRoot: PHOTOS_ROOT,
    derivativeRoot: DERIVATIVE_ROOT,
    concurrency: 3,
    resumeStatePath: join(workDir, "sync-state.json"),
    reportPath: join(workDir, "sync-report.json"),
    projectRef: null,
    ...overrides,
  };
}

async function executeOptions(overrides = {}) {
  return baseOptions({
    execute: true,
    projectRef: TEST_REF,
    allowedProjectRefs: [TEST_REF],
    envFilePath: await writeEnvFile(),
    ...overrides,
  });
}

describe("object naming", () => {
  it("sanitizes original filenames without losing the extension", () => {
    expect(sanitizeOriginalFilename("first dance #1.jpg")).toBe("first-dance-1.jpg");
    expect(sanitizeOriginalFilename("ceremony-1.jpg")).toBe("ceremony-1.jpg");
    expect(sanitizeOriginalFilename("weird///  name??.JPG")).toBe("weird-name.JPG");
    expect(sanitizeOriginalFilename("???")).toBe("file");
  });

  it("embeds the sha256 prefix required by the photos table constraint", () => {
    const photo = {
      imageDataHash: HASH_1,
      fileSha256: "3772acc5a74dcbfd689c0f35dff73f18bff84c116ad99566eb37e8a3c1efa412",
      originalFilename: "ceremony-1.jpg",
    };
    const path = originalObjectPath(photo);
    expect(path).toBe(
      `originals/${HASH_1}/3772acc5a74dcbfd-ceremony-1.jpg`,
    );
    // Mirrors check (position(substr(file_sha256, 1, 16) in original_object) > 0).
    expect(path.includes(photo.fileSha256.slice(0, 16))).toBe(true);
  });
});

describe("dry-run planner", () => {
  it("lists deterministic object paths with zero network writes", async () => {
    const result = await syncGalleryStorage(baseOptions(), { log: silent });
    expect(result.planned).toBe(18); // 3 originals + 15 previews
    expect(result.uploadedOriginals).toBe(0);
    expect(result.uploadedPreviews).toBe(0);
    expect(result.sourceHashMismatches).toBe(0);
    expect(result.failed).toEqual([]);

    const report = JSON.parse(await fs.readFile(join(workDir, "sync-report.json"), "utf8"));
    expect(report.storage.networkWrites).toBe(0);
    expect(report.storage.resumable).toEqual({
      totalOperations: 18,
      alreadyVerified: 0,
      remaining: 18,
    });
    const paths = report.storage.objects.map((o) => `${o.bucket}/${o.objectPath}`);
    expect(paths).toContain(
      `${ORIGINALS_BUCKET}/originals/${HASH_1}/3772acc5a74dcbfd-ceremony-1.jpg`,
    );
    expect(paths).toContain(`${PREVIEWS_BUCKET}/previews/${HASH_1}/2400.jpeg`);
    expect(paths).toContain(
      `${ORIGINALS_BUCKET}/originals/${"c".repeat(32)}/d12cb6b45eef6c16-first-dance-1.jpg`,
    );

    // Deterministic: a second dry-run plans the identical listing.
    const again = await syncGalleryStorage(baseOptions(), { log: silent });
    const report2 = JSON.parse(await fs.readFile(join(workDir, "sync-report.json"), "utf8"));
    expect(again.planned).toBe(18);
    expect(report2.storage.objects).toEqual(report.storage.objects);

    // Dry-run never creates checkpoint state.
    await expect(fs.stat(join(workDir, "sync-state.json"))).rejects.toThrow();
  });

  it("refuses a catalog with a duplicate photo ID before planning anything", async () => {
    const catalog = await readCatalog();
    catalog.photos.push({ ...catalog.photos[0] });
    const catalogPath = join(workDir, "catalog-duplicate.json");
    await fs.writeFile(catalogPath, JSON.stringify(catalog));
    const mock = createMockStorage();
    await expect(
      syncGalleryStorage(baseOptions({ catalogPath }), {
        log: silent,
        storageClientFactory: () => mock.client,
      }),
    ).rejects.toThrow(/duplicate/i);
    expect(mock.calls).toEqual([]);
  });

  it("counts a checksum mismatch and excludes that photo from the plan", async () => {
    // Copy the fixture tree so the tamper never touches the committed files.
    const copyRoot = join(workDir, "photos");
    await fs.cp(PHOTOS_ROOT, copyRoot, { recursive: true });
    const target = join(copyRoot, "01 Ceremony/ceremony-2.jpg");
    const bytes = await fs.readFile(target);
    bytes[128] = bytes[128] ^ 0xff; // same size, different bytes
    await fs.writeFile(target, bytes);

    const result = await syncGalleryStorage(
      baseOptions({ sourceRoot: copyRoot, derivativeRoot: join(copyRoot, "derivatives") }),
      { log: silent },
    );
    expect(result.sourceHashMismatches).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].stage).toBe("verify-source");
    expect(result.failed[0].imageDataHash).toBe(HASH_2);
    // ceremony-2 (1 original + 6 previews) drops out of the plan.
    expect(result.planned).toBe(11);
  });
});

describe("execution gating", () => {
  it("requires --project-ref, a runtime allowlist, and a matching env file", async () => {
    const mock = createMockStorage();
    const deps = { log: silent, storageClientFactory: () => mock.client };

    await expect(
      syncGalleryStorage(await executeOptions({ projectRef: null }), deps),
    ).rejects.toThrow(/project-ref/i);

    await expect(
      syncGalleryStorage(await executeOptions({ allowedProjectRefs: [] }), deps),
    ).rejects.toThrow(/allowlist/i);

    await expect(
      syncGalleryStorage(
        await executeOptions({ allowedProjectRefs: ["someotherref000000000"] }),
        deps,
      ),
    ).rejects.toThrow(/not in the runtime allowlist/i);

    await expect(
      syncGalleryStorage(await executeOptions({ envFilePath: null }), deps),
    ).rejects.toThrow(/env-file|ENOENT/i);

    const mismatchedEnv = await writeEnvFile({
      SUPABASE_URL: "https://someotherref000000000.supabase.co",
    });
    await expect(
      syncGalleryStorage(await executeOptions({ envFilePath: mismatchedEnv }), deps),
    ).rejects.toThrow(/does not match project ref/i);

    // Every refusal happened before any storage call.
    expect(mock.calls).toEqual([]);
  });

  it("cross-checks SUPABASE_PROJECT_REF and supports the NEXT_PUBLIC url fallback", async () => {
    const envPath = join(workDir, "env.cloudlike");
    await fs.writeFile(
      envPath,
      [
        `SUPABASE_PROJECT_REF=${TEST_REF}`,
        `NEXT_PUBLIC_SUPABASE_URL=https://${TEST_REF}.supabase.co`,
        "SUPABASE_SERVICE_ROLE_KEY=synthetic-key",
      ].join("\n"),
    );
    const credentials = await readCredentialsFromEnvFile(envPath);
    expect(credentials.url).toBe(`https://${TEST_REF}.supabase.co`);
    expect(credentials.projectRef).toBe(TEST_REF);
    expect(() =>
      assertExecutionAllowed(
        {
          execute: true,
          projectRef: TEST_REF,
          allowedProjectRefs: [TEST_REF],
          envFilePath: envPath,
          localMode: false,
        },
        credentials,
      ),
    ).not.toThrow();
    expect(() =>
      assertExecutionAllowed(
        {
          execute: true,
          projectRef: "someotherref000000000",
          allowedProjectRefs: ["someotherref000000000"],
          envFilePath: envPath,
          localMode: false,
        },
        credentials,
      ),
    ).toThrow(/SUPABASE_PROJECT_REF/);
  });

  it("local mode requires a loopback URL", async () => {
    const loopback = { url: "http://127.0.0.1:54321", serviceRoleKey: "x", projectRef: null };
    const cloud = { url: `https://${TEST_REF}.supabase.co`, serviceRoleKey: "x", projectRef: null };
    const gate = (credentials) =>
      assertExecutionAllowed(
        {
          execute: true,
          projectRef: "local",
          allowedProjectRefs: ["local"],
          envFilePath: "synthetic",
          localMode: true,
        },
        credentials,
      );
    expect(() => gate(loopback)).not.toThrow();
    expect(() => gate(cloud)).toThrow(/loopback/);
  });
});

describe("mocked execution", () => {
  it("first sync uploads originals and previews with sha metadata, upsert:false", async () => {
    const mock = createMockStorage();
    const result = await syncGalleryStorage(await executeOptions(), {
      log: silent,
      storageClientFactory: () => mock.client,
    });
    expect(result.failed).toEqual([]);
    expect(result.uploadedOriginals).toBe(3);
    expect(result.uploadedPreviews).toBe(15);
    expect(result.skippedExisting).toBe(0);

    const catalog = parseSyncCatalog(await readCatalog());
    const photo1 = catalog.photos.find((p) => p.imageDataHash === HASH_1);
    const key = `${ORIGINALS_BUCKET}/${originalObjectPath(photo1)}`;
    const stored = mock.objects.get(key);
    expect(stored).toBeDefined();
    expect(stored.bytes).toBe(photo1.originalBytes);
    expect(stored.metadata.fileSha256).toBe(photo1.fileSha256);
    expect(stored.contentType).toBe("image/jpeg");

    for (const call of mock.calls.filter((c) => c.op === "upload")) {
      expect(call.options.upsert).toBe(false);
      expect(call.options.metadata.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const previewUpload = mock.calls.find(
      (c) => c.op === "upload" && c.bucket === PREVIEWS_BUCKET,
    );
    expect(previewUpload.options.cacheControl).toBe("31536000");

    // Checkpoint recorded every object.
    const state = await loadSyncState(join(workDir, "sync-state.json"));
    expect(Object.keys(state.objects)).toHaveLength(18);
    expect(state.projectRef).toBe(TEST_REF);
  });

  it("retry is a no-op via the checkpoint: zero uploads, zero remote calls", async () => {
    const options = await executeOptions();
    const first = createMockStorage();
    await syncGalleryStorage(options, { log: silent, storageClientFactory: () => first.client });

    const second = createMockStorage(); // empty "remote": must not even be consulted
    const result = await syncGalleryStorage(options, {
      log: silent,
      storageClientFactory: () => second.client,
    });
    expect(result.uploadedOriginals).toBe(0);
    expect(result.uploadedPreviews).toBe(0);
    expect(result.skippedExisting).toBe(18);
    expect(result.failed).toEqual([]);
    expect(second.uploadCount()).toBe(0);
    expect(second.calls.filter((c) => c.op === "info")).toEqual([]);
  });

  it("partial prior upload: existing identical remote objects verify via info() and are skipped", async () => {
    const catalog = parseSyncCatalog(await readCatalog());
    const photo1 = catalog.photos.find((p) => p.imageDataHash === HASH_1);
    const mock = createMockStorage({
      preloaded: {
        [`${ORIGINALS_BUCKET}/${originalObjectPath(photo1)}`]: {
          bytes: photo1.originalBytes,
          metadata: { fileSha256: photo1.fileSha256 },
        },
      },
    });
    const result = await syncGalleryStorage(await executeOptions(), {
      log: silent,
      storageClientFactory: () => mock.client,
    });
    expect(result.failed).toEqual([]);
    expect(result.uploadedOriginals).toBe(2);
    expect(result.uploadedPreviews).toBe(15);
    expect(result.skippedExisting).toBe(1);
    // The skip was proven by info(), not assumed.
    expect(
      mock.calls.some(
        (c) => c.op === "info" && c.path === originalObjectPath(photo1),
      ),
    ).toBe(true);
    // The verified object still landed in the checkpoint for future runs.
    const state = await loadSyncState(join(workDir, "sync-state.json"));
    expect(Object.keys(state.objects)).toHaveLength(18);
  });

  it("remote collision with different bytes is reported and never overwritten", async () => {
    const catalog = parseSyncCatalog(await readCatalog());
    const photo1 = catalog.photos.find((p) => p.imageDataHash === HASH_1);
    const key = `${ORIGINALS_BUCKET}/${originalObjectPath(photo1)}`;
    const mock = createMockStorage({
      preloaded: {
        [key]: { bytes: 999, metadata: { fileSha256: "f".repeat(64) } },
      },
    });
    const result = await syncGalleryStorage(await executeOptions(), {
      log: silent,
      storageClientFactory: () => mock.client,
    });
    expect(result.uploadedOriginals).toBe(2);
    expect(result.skippedExisting).toBe(0);
    const collision = result.failed.find((f) => f.stage === "remote-collision");
    expect(collision).toBeDefined();
    expect(collision.objectPath).toBe(originalObjectPath(photo1));
    // Never overwritten: the conflicting remote object is untouched.
    expect(mock.objects.get(key).bytes).toBe(999);
    expect(mock.calls.every((c) => c.op !== "upload" || c.options.upsert === false)).toBe(true);
    // And the collided object was NOT checkpointed as verified.
    const state = await loadSyncState(join(workDir, "sync-state.json"));
    expect(state.objects[key]).toBeUndefined();
  });

  it("upload failures are recorded and the retry resumes exactly the failed objects", async () => {
    const catalog = parseSyncCatalog(await readCatalog());
    const photo1 = catalog.photos.find((p) => p.imageDataHash === HASH_1);
    const key = `${ORIGINALS_BUCKET}/${originalObjectPath(photo1)}`;
    const options = await executeOptions();
    const flaky = createMockStorage({ failUploads: [key] });
    const first = await syncGalleryStorage(options, {
      log: silent,
      storageClientFactory: () => flaky.client,
    });
    expect(first.uploadedOriginals).toBe(2);
    expect(first.failed).toHaveLength(1);
    expect(first.failed[0].stage).toBe("upload-original");

    // Retry against a healthy remote: only the failed original is uploaded.
    const healthy = createMockStorage();
    const second = await syncGalleryStorage(options, {
      log: silent,
      storageClientFactory: () => healthy.client,
    });
    expect(second.failed).toEqual([]);
    expect(second.uploadedOriginals).toBe(1);
    expect(second.uploadedPreviews).toBe(0);
    expect(second.skippedExisting).toBe(17);
  });
});

describe("sync state hygiene", () => {
  it("persists hashes and object paths only; unknown keys never survive a save", async () => {
    const state = createSyncState(TEST_REF);
    recordObject(state, {
      bucket: ORIGINALS_BUCKET,
      objectPath: `originals/${HASH_1}/abc-file.jpg`,
      fileSha256: "3772acc5a74dcbfd689c0f35dff73f18bff84c116ad99566eb37e8a3c1efa412",
      bytes: 100,
    });
    // Simulate caller pollution with secret-looking fields.
    state.SUPABASE_SERVICE_ROLE_KEY = "should-never-be-written";
    state.objects[`${ORIGINALS_BUCKET}/originals/${HASH_1}/abc-file.jpg`].token = "nope";

    const statePath = join(workDir, "state.json");
    await saveSyncState(statePath, state);
    const raw = await fs.readFile(statePath, "utf8");
    expect(raw).not.toContain("should-never-be-written");
    expect(raw).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(raw).not.toContain("nope");

    const loaded = await loadSyncState(statePath);
    expect(Object.keys(loaded.objects)).toHaveLength(1);
  });

  it("execute refuses to resume state that belongs to a different project ref", async () => {
    const statePath = join(workDir, "sync-state.json");
    await saveSyncState(statePath, createSyncState("someotherref000000000"));
    const mock = createMockStorage();
    await expect(
      syncGalleryStorage(await executeOptions(), {
        log: silent,
        storageClientFactory: () => mock.client,
      }),
    ).rejects.toThrow(/belongs to project ref/);
    expect(mock.calls).toEqual([]);
  });
});

describe("CLI argument contract", () => {
  it("defaults to dry-run and rejects --execute --dry-run together", () => {
    const args = parseStorageArgs([
      "--catalog",
      "tests/fixtures/catalog.json",
      "--source",
      "tests/fixtures/photos",
      "--dry-run",
    ]);
    expect(args.execute).toBe(false);
    expect(() =>
      parseStorageArgs([
        "--catalog",
        "c.json",
        "--source",
        "s",
        "--dry-run",
        "--execute",
      ]),
    ).toThrow(/mutually exclusive/);
  });

  it("rejects concurrency outside 1..8", async () => {
    await expect(
      syncGalleryStorage(baseOptions({ concurrency: 9 }), { log: silent }),
    ).rejects.toThrow(/between 1 and 8/);
    await expect(
      syncGalleryStorage(baseOptions({ concurrency: 0 }), { log: silent }),
    ).rejects.toThrow(/between 1 and 8/);
  });
});

describe("buildStoragePlan", () => {
  it("orders each photo's original before its previews", async () => {
    const catalog = parseSyncCatalog(await readCatalog());
    const plan = await buildStoragePlan(catalog, {
      sourceRoot: PHOTOS_ROOT,
      derivativeRoot: DERIVATIVE_ROOT,
    });
    expect(plan.operations).toHaveLength(18);
    const byPhoto = new Map();
    plan.operations.forEach((op, index) => {
      if (!byPhoto.has(op.imageDataHash)) byPhoto.set(op.imageDataHash, []);
      byPhoto.get(op.imageDataHash).push({ kind: op.kind, index });
    });
    for (const ops of byPhoto.values()) {
      expect(ops[0].kind).toBe("original");
    }
    expect(plan.missingLocalDerivatives).toBe(0);
    expect(plan.verifiedSources).toBe(3);
  });
});
