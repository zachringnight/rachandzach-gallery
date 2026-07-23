/**
 * Visibility tests (packet 10): prove no catalog row becomes guest-visible
 * before the approved asset and its previews exist in storage, and exercise
 * the HEIC wasm decode path against the real synthetic HEIC fixture. All
 * storage is the in-memory fake; the only "real" work here is genuine
 * heic-decode + sharp execution against real fixture bytes.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { GUEST_PENDING_BUCKET } from "@/lib/uploads/contracts";
import {
  HeicDecodeError,
  UnprocessableItemStateError,
  processApprovedPhoto,
  type ProcessApprovedPhotoMetadata,
} from "@/lib/moderation/process-approved-photo";
import { createFakeDb } from "./fake-supabase";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "shared",
);

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const BATCH_ID = "55555555-5555-4555-8555-555555555555";
const OBJECT_PATH = `pending/${BATCH_ID}/${ITEM_ID}/nonce`;

const NO_METADATA: ProcessApprovedPhotoMetadata = {
  eventSlug: null,
  peopleSlugs: [],
  keywords: [],
};

function seedItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ITEM_ID,
    batch_id: BATCH_ID,
    original_name: "my-photo.jpg",
    object_path: OBJECT_PATH,
    bytes: 1024,
    media_type: "image/jpeg",
    sha256: null,
    status: "approved",
    rejection_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildDb(itemOverrides: Partial<Record<string, unknown>> = {}) {
  const db = createFakeDb({
    rachandzach_upload_items: [seedItem(itemOverrides)],
  });
  return db;
}

function putOriginal(db: ReturnType<typeof createFakeDb>, bytes: Uint8Array) {
  db.storage.set(GUEST_PENDING_BUCKET, new Map());
  db.storage.get(GUEST_PENDING_BUCKET)!.set(OBJECT_PATH, {
    bytes,
    contentType: "image/jpeg",
  });
}

describe("processApprovedPhoto: ordering and visibility", () => {
  it("uploads the original and every preview before the photos row is inserted", async () => {
    const db = buildDb();
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));

    const result = await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);
    expect(result.created).toBe(true);

    const photoInsertIndex = db.ops.indexOf("insert:rachandzach_photos");
    expect(photoInsertIndex).toBeGreaterThan(-1);

    const uploadOps = db.ops.filter((op) => op.startsWith("upload:"));
    expect(uploadOps.length).toBeGreaterThanOrEqual(3); // original + 2 derivatives
    for (const op of uploadOps) {
      expect(db.ops.indexOf(op)).toBeLessThan(photoInsertIndex);
    }

    // The preview rows are inserted only after the photo row exists (they
    // carry photo_id as a foreign key) -- also after every upload.
    const previewInsertIndexes = db.ops
      .map((op, idx) => ({ op, idx }))
      .filter(({ op }) => op === "insert:rachandzach_photo_previews")
      .map(({ idx }) => idx);
    expect(previewInsertIndexes.length).toBe(2);
    for (const idx of previewInsertIndexes) {
      expect(idx).toBeGreaterThan(photoInsertIndex);
    }
  });

  it("creates no photo row and no preview rows when a preview upload fails partway through", async () => {
    const db = buildDb();
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));
    let uploadCount = 0;
    db.uploadHook = async () => {
      uploadCount += 1;
      // Let the original upload succeed; fail on the first derivative.
      if (uploadCount === 2) {
        throw new Error("simulated storage outage");
      }
    };

    await expect(
      processApprovedPhoto(ITEM_ID, NO_METADATA, db.client),
    ).rejects.toThrow(/simulated storage outage/);

    expect(db.tables.get("rachandzach_photos") ?? []).toHaveLength(0);
    expect(db.tables.get("rachandzach_photo_previews") ?? []).toHaveLength(0);
  });

  it("refuses to process a rejected item", async () => {
    const db = buildDb({ status: "rejected" });
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));
    await expect(
      processApprovedPhoto(ITEM_ID, NO_METADATA, db.client),
    ).rejects.toThrow(UnprocessableItemStateError);
    expect(db.tables.get("rachandzach_photos") ?? []).toHaveLength(0);
  });
});

describe("processApprovedPhoto: real derivative pipeline", () => {
  it("produces genuinely decodable JPEG and WebP derivatives from a JPEG original", async () => {
    const db = buildDb();
    putOriginal(db, readFixture("synthetic-1-phone.jpg"));

    const result = await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);
    const previews = db.tables.get("rachandzach_photo_previews") ?? [];
    expect(previews).toHaveLength(2);

    for (const preview of previews) {
      const object = db.storage
        .get(preview.bucket as string)!
        .get(preview.object_path as string)!;
      const meta = await sharp(Buffer.from(object.bytes)).metadata();
      expect(meta.format).toBe(preview.format);
      expect(meta.width).toBe(preview.width);
    }

    const photo = (db.tables.get("rachandzach_photos") ?? [])[0];
    expect(photo.id).toBe(result.photoId);
    expect(photo.status).toBe("published");
    expect(photo.source).toBe("guest");
    expect(photo.width).toBe(3000);
    expect(photo.height).toBe(2000);
  });

  it("decodes a real HEIC guest submission via the wasm libheif path and derives real JPEG/WebP output", async () => {
    const db = buildDb({ media_type: "image/heic" });
    putOriginal(db, readFixture("synthetic-4.heic"));

    const result = await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);
    expect(result.created).toBe(true);

    const photo = (db.tables.get("rachandzach_photos") ?? [])[0];
    // synthetic-4.heic is 1024x768 (see tests/fixtures/shared/manifest.json).
    expect(photo.width).toBe(1024);
    expect(photo.height).toBe(768);

    const previews = db.tables.get("rachandzach_photo_previews") ?? [];
    expect(previews).toHaveLength(2);
    const jpegPreview = previews.find((p) => p.format === "jpeg")!;
    // withoutEnlargement: the 2048 spec never upscales past the 1024 source,
    // and the recorded width is the ACTUAL encoded width, not the nominal
    // 2048 target.
    expect(jpegPreview.width).toBe(1024);
    const webpPreview = previews.find((p) => p.format === "webp")!;
    expect(webpPreview.width).toBe(480);
    expect(jpegPreview.object_path).toContain("/1024.jpeg");

    for (const preview of previews) {
      const object = db.storage
        .get(preview.bucket as string)!
        .get(preview.object_path as string)!;
      const meta = await sharp(Buffer.from(object.bytes)).metadata();
      expect(meta.format).toBe(preview.format);
      // A genuinely decoded, non-degenerate image: real width/height, not a
      // 0x0 or 1x1 fallback.
      expect(meta.width).toBeGreaterThan(10);
      expect(meta.height).toBeGreaterThan(10);
    }
  });

  it("surfaces a HeicDecodeError and creates nothing when the HEIC body is corrupt", async () => {
    const db = buildDb({ media_type: "image/heic" });
    const heic = readFixture("synthetic-4.heic");
    // Keep the ftyp/heic magic bytes (so sniffImage still routes to the HEIC
    // branch) but truncate the coded body so libheif cannot decode it.
    putOriginal(db, heic.subarray(0, 64));

    await expect(
      processApprovedPhoto(ITEM_ID, NO_METADATA, db.client),
    ).rejects.toThrow(HeicDecodeError);

    expect(db.tables.get("rachandzach_photos") ?? []).toHaveLength(0);
    expect(db.tables.get("rachandzach_photo_previews") ?? []).toHaveLength(0);
    // Decode happens before any storage write.
    expect(db.ops.filter((op) => op.startsWith("upload:"))).toHaveLength(0);
  });
});

describe("processApprovedPhoto: retry safety", () => {
  it("retrying an already-processed item creates no duplicate photo or previews", async () => {
    const db = buildDb();
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));

    const first = await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);
    expect(first.created).toBe(true);

    const second = await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);
    expect(second.created).toBe(false);
    expect(second.photoId).toBe(first.photoId);

    expect(db.tables.get("rachandzach_photos") ?? []).toHaveLength(1);
    expect(db.tables.get("rachandzach_photo_previews") ?? []).toHaveLength(2);
    // No second round of uploads on the retry.
    expect(db.ops.filter((op) => op.startsWith("upload:"))).toHaveLength(3);
  });

  it("recovers cleanly when a retry follows a partial failure (uploads landed, photo row never committed)", async () => {
    const db = buildDb();
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));

    // First attempt: the original and first derivative upload succeed, then
    // storage dies before the second derivative -- exactly the "multi-system
    // step failed partway" scenario the packet calls out. No photo row and
    // no preview rows exist afterward.
    let uploadCount = 0;
    db.uploadHook = async () => {
      uploadCount += 1;
      if (uploadCount === 3) throw new Error("simulated outage on the third object");
    };
    await expect(
      processApprovedPhoto(ITEM_ID, NO_METADATA, db.client),
    ).rejects.toThrow(/simulated outage/);
    expect(db.tables.get("rachandzach_photos") ?? []).toHaveLength(0);
    expect(db.ops.filter((op) => op.startsWith("upload:"))).toHaveLength(2);

    // Retry: no compensating delete/rollback ever ran, so the first two
    // objects are still sitting in storage under their content-hashed names.
    // The retry must recognize them as already-done (not overwrite, not
    // error) rather than getting permanently stuck.
    db.uploadHook = async () => {};
    const result = await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);
    expect(result.created).toBe(true);

    expect(db.tables.get("rachandzach_photos") ?? []).toHaveLength(1);
    expect(db.tables.get("rachandzach_photo_previews") ?? []).toHaveLength(2);
  });
});
