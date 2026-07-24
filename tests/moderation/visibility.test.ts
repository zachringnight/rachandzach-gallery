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
  reconcileProcessedPhoto,
  type ProcessApprovedPhotoMetadata,
} from "@/lib/moderation/process-approved-photo";
import { transitionUploadItem } from "@/lib/moderation/state-machine";
import { createFakeDb, TEST_ACTOR } from "./fake-supabase";

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
const OTHER_ITEM_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_BATCH_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_OBJECT_PATH = `pending/${OTHER_BATCH_ID}/${OTHER_ITEM_ID}/nonce`;

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
    status: "pending",
    rejection_reason: null,
    note_approved: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function seedBatch(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: BATCH_ID,
    receipt_hash: "a".repeat(64),
    email: "private@example.test",
    display_name: "A Guest",
    note: null,
    status: "under_review",
    submitted_at: new Date().toISOString(),
    reviewed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildDb(
  itemOverrides: Partial<Record<string, unknown>> = {},
  batchOverrides: Partial<Record<string, unknown>> = {},
) {
  const db = createFakeDb({
    rachandzach_upload_items: [seedItem(itemOverrides)],
    rachandzach_upload_batches: [seedBatch(batchOverrides)],
  }, {
    unique: {
      rachandzach_photos: [["image_data_hash"]],
      rachandzach_photo_previews: [
        ["photo_id", "width", "format"],
        ["object_path"],
      ],
      rachandzach_photo_people: [["photo_id", "person_id"]],
      rachandzach_photo_keywords: [["photo_id", "keyword"]],
    },
  });
  return db;
}

function putOriginal(
  db: ReturnType<typeof createFakeDb>,
  bytes: Uint8Array,
  objectPath = OBJECT_PATH,
) {
  if (!db.storage.has(GUEST_PENDING_BUCKET)) {
    db.storage.set(GUEST_PENDING_BUCKET, new Map());
  }
  db.storage.get(GUEST_PENDING_BUCKET)!.set(objectPath, {
    bytes,
    contentType: "image/jpeg",
  });
}

function approveDecision(
  noteApproved: boolean,
  itemId = ITEM_ID,
) {
  return {
    itemId,
    action: "approve" as const,
    eventSlug: null,
    peopleSlugs: [],
    keywords: [],
    noteApproved,
    rejectionReason: null,
  };
}

async function approveAndReconcile(
  db: ReturnType<typeof createFakeDb>,
  photoId: string,
  noteApproved: boolean,
  itemId = ITEM_ID,
  batchId = BATCH_ID,
) {
  await transitionUploadItem(
    itemId,
    approveDecision(noteApproved, itemId),
    TEST_ACTOR,
    db.client,
  );
  return reconcileProcessedPhoto(
    itemId,
    photoId,
    { expectedBatchId: batchId },
    db.client,
  );
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

    const [photo] = db.tables.get("rachandzach_photos") ?? [];
    expect(photo.status).toBe("pending");
    expect(photo.processing_complete).toBe(true);
    expect(photo.uploader_caption).toBeNull();
    expect(photo.uploader_caption_byline).toBeNull();
    expect(photo.approved_at).toBeNull();
    const stagedInsert = db.inserts.find(
      (entry) => entry.table === "rachandzach_photos",
    );
    expect(stagedInsert?.row.processing_complete).toBe(false);
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
    expect(photo.status).toBe("pending");
    expect(photo.source).toBe("guest");
    expect(photo.width).toBe(3000);
    expect(photo.height).toBe(2000);

    await approveAndReconcile(db, result.photoId, false);
    const [published] = db.tables.get("rachandzach_photos") ?? [];
    expect(published.status).toBe("published");
    expect(published.approved_at).toEqual(expect.any(String));
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

  it("repairs an incomplete same-batch row under a controlled processor interleaving", async () => {
    const db = buildDb();
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));

    let releaseFirst!: () => void;
    const firstMayContinue = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let reportFirstBlocked!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      reportFirstBlocked = resolve;
    });
    let blocked = false;
    db.insertHook = async (table) => {
      if (table === "rachandzach_photo_previews" && !blocked) {
        blocked = true;
        reportFirstBlocked();
        await firstMayContinue;
      }
    };

    const firstAttempt = processApprovedPhoto(
      ITEM_ID,
      NO_METADATA,
      db.client,
    );
    await firstBlocked;

    const [incomplete] = db.tables.get("rachandzach_photos") ?? [];
    expect(incomplete.processing_complete).toBe(false);
    expect(db.tables.get("rachandzach_photo_previews") ?? []).toHaveLength(0);

    const recovered = await processApprovedPhoto(
      ITEM_ID,
      NO_METADATA,
      db.client,
    );
    expect(recovered.created).toBe(false);
    expect(recovered.photoId).toBe(incomplete.id);

    const [completed] = db.tables.get("rachandzach_photos") ?? [];
    expect(completed.processing_complete).toBe(true);
    expect(db.tables.get("rachandzach_photo_previews") ?? []).toHaveLength(2);

    releaseFirst();
    const original = await firstAttempt;
    expect(original.created).toBe(true);
    expect(original.photoId).toBe(recovered.photoId);
    expect(db.tables.get("rachandzach_photos") ?? []).toHaveLength(1);
    expect(db.tables.get("rachandzach_photo_previews") ?? []).toHaveLength(2);
  });

  it("does not swallow a non-unique relation error and repairs it on retry", async () => {
    const db = buildDb();
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));
    let failed = false;
    db.insertErrorHook = (table) => {
      if (table === "rachandzach_photo_previews" && !failed) {
        failed = true;
        return { code: "42501", message: "simulated relation denial" };
      }
      return null;
    };

    await expect(
      processApprovedPhoto(ITEM_ID, NO_METADATA, db.client),
    ).rejects.toThrow("Could not record a photo preview.");

    const [incomplete] = db.tables.get("rachandzach_photos") ?? [];
    expect(incomplete.processing_complete).toBe(false);

    db.insertErrorHook = () => null;
    const recovered = await processApprovedPhoto(
      ITEM_ID,
      NO_METADATA,
      db.client,
    );
    expect(recovered).toEqual({ photoId: incomplete.id, created: false });
    expect(db.tables.get("rachandzach_photos")?.[0].processing_complete).toBe(
      true,
    );
    expect(db.tables.get("rachandzach_photo_previews") ?? []).toHaveLength(2);
  });
});

describe("processApprovedPhoto: approved uploader captions", () => {
  it("publishes the approved note without deriving a byline from private display_name", async () => {
    const db = buildDb(
      {},
      {
        note: "  We loved this quiet moment after the ceremony.  ",
        display_name: "  Jamie  ",
      },
    );
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));

    const staged = await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);

    const [pending] = db.tables.get("rachandzach_photos") ?? [];
    expect(pending.status).toBe("pending");
    expect(pending.uploader_caption).toBeNull();
    expect(pending.uploader_caption_byline).toBeNull();
    expect(JSON.stringify(pending)).not.toContain("private@example.test");
    expect(JSON.stringify(pending)).not.toContain("quiet moment");

    await approveAndReconcile(db, staged.photoId, true);

    const [published] = db.tables.get("rachandzach_photos") ?? [];
    expect(published.status).toBe("published");
    expect(published.uploader_caption).toBe(
      "We loved this quiet moment after the ceremony.",
    );
    expect(published.uploader_caption_byline).toBeNull();
    expect(JSON.stringify(published)).not.toContain("private@example.test");
    expect(JSON.stringify(published)).not.toContain("Jamie");
  });

  it("keeps the batch note and byline out of the catalog when not approved", async () => {
    const db = buildDb(
      {},
      {
        note: "This note is still private.",
        display_name: "Private Guest",
      },
    );
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));

    const staged = await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);
    await approveAndReconcile(db, staged.photoId, false);

    const [photo] = db.tables.get("rachandzach_photos") ?? [];
    expect(photo.status).toBe("published");
    expect(photo.uploader_caption).toBeNull();
    expect(photo.uploader_caption_byline).toBeNull();
    expect(JSON.stringify(photo)).not.toContain("This note is still private.");
    expect(JSON.stringify(photo)).not.toContain("Private Guest");
  });

  it("makes concurrent approve requests with different flags converge on the stored winner", async () => {
    const db = buildDb(
      {},
      {
        note: "The persisted winner controls this memory.",
        display_name: "Jamie",
      },
    );
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));

    const [firstStage, secondStage] = await Promise.all([
      processApprovedPhoto(ITEM_ID, NO_METADATA, db.client),
      processApprovedPhoto(ITEM_ID, NO_METADATA, db.client),
    ]);
    expect(secondStage.photoId).toBe(firstStage.photoId);
    expect(db.tables.get("rachandzach_photos") ?? []).toHaveLength(1);
    const transitions = await Promise.all([
      transitionUploadItem(
        ITEM_ID,
        approveDecision(true),
        TEST_ACTOR,
        db.client,
      ),
      transitionUploadItem(
        ITEM_ID,
        approveDecision(false),
        TEST_ACTOR,
        db.client,
      ),
    ]);

    const [storedItem] = db.tables.get("rachandzach_upload_items") ?? [];
    expect(storedItem.status).toBe("approved");
    expect(transitions.map((row) => row.note_approved)).toEqual([
      storedItem.note_approved,
      storedItem.note_approved,
    ]);

    await Promise.all([
      reconcileProcessedPhoto(
        ITEM_ID,
        firstStage.photoId,
        { expectedBatchId: BATCH_ID },
        db.client,
      ),
      reconcileProcessedPhoto(
        ITEM_ID,
        firstStage.photoId,
        { expectedBatchId: BATCH_ID },
        db.client,
      ),
    ]);

    const [photo] = db.tables.get("rachandzach_photos") ?? [];
    expect(photo.status).toBe("published");
    expect(photo.uploader_caption).toBe(
      storedItem.note_approved
        ? "The persisted winner controls this memory."
        : null,
    );
    expect(photo.uploader_caption_byline).toBeNull();
    expect(JSON.stringify(photo)).not.toContain("Jamie");
  });

  it("keeps a staged photo non-visible and caption-free when rejection wins", async () => {
    const db = buildDb(
      {},
      {
        note: "A rejected upload must never expose this.",
        display_name: "Private Guest",
      },
    );
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));
    const staged = await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);

    await transitionUploadItem(
      ITEM_ID,
      {
        itemId: ITEM_ID,
        action: "reject",
        eventSlug: null,
        peopleSlugs: [],
        keywords: [],
        noteApproved: true,
        rejectionReason: "Not for the gallery",
      },
      TEST_ACTOR,
      db.client,
    );
    await expect(
      transitionUploadItem(
        ITEM_ID,
        approveDecision(true),
        TEST_ACTOR,
        db.client,
      ),
    ).rejects.toThrow(/Cannot move an upload item from "rejected"/);

    await reconcileProcessedPhoto(
      ITEM_ID,
      staged.photoId,
      { expectedBatchId: BATCH_ID, publishApproved: false },
      db.client,
    );

    const [photo] = db.tables.get("rachandzach_photos") ?? [];
    expect(photo.status).toBe("rejected");
    expect(photo.uploader_caption).toBeNull();
    expect(photo.uploader_caption_byline).toBeNull();
    expect(photo.approved_at).toBeNull();
    expect(JSON.stringify(photo)).not.toContain("rejected upload");
  });

  it("does not publish a staged photo on a transition failure path", async () => {
    const db = buildDb(
      {},
      {
        note: "Still awaiting a persisted decision.",
        display_name: "Private Guest",
      },
    );
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));
    const staged = await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);

    await reconcileProcessedPhoto(
      ITEM_ID,
      staged.photoId,
      { expectedBatchId: BATCH_ID, publishApproved: false },
      db.client,
    );

    const [photo] = db.tables.get("rachandzach_photos") ?? [];
    expect(photo.status).toBe("pending");
    expect(photo.uploader_caption).toBeNull();
    expect(photo.uploader_caption_byline).toBeNull();
    expect(photo.approved_at).toBeNull();
  });

  it("refuses to publish until processing_complete is true", async () => {
    const db = buildDb(
      {},
      {
        note: "This note waits behind the completeness gate.",
        display_name: "Private Guest",
      },
    );
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));
    const staged = await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);
    const [photo] = db.tables.get("rachandzach_photos") ?? [];
    photo.processing_complete = false;

    await transitionUploadItem(
      ITEM_ID,
      approveDecision(true),
      TEST_ACTOR,
      db.client,
    );
    await expect(
      reconcileProcessedPhoto(
        ITEM_ID,
        staged.photoId,
        { expectedBatchId: BATCH_ID },
        db.client,
      ),
    ).rejects.toThrow(/has not finished processing/);

    expect(photo.status).toBe("pending");
    expect(photo.uploader_caption).toBeNull();
    expect(photo.uploader_caption_byline).toBeNull();
  });

  it.each<[string, boolean, string]>([
    ["incomplete published", false, "published"],
    ["completed pending", true, "pending"],
    ["completed rejected", true, "rejected"],
  ])(
    "blocks another batch from reusing a %s duplicate",
    async (_label, processingComplete, status) => {
      const original = readFixture("synthetic-1-tiny.jpg");
      const db = buildDb();
      putOriginal(db, original);
      await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);
      const [photo] = db.tables.get("rachandzach_photos") ?? [];
      photo.processing_complete = processingComplete;
      photo.status = status;

      db.tables.get("rachandzach_upload_batches")!.push(
        seedBatch({ id: OTHER_BATCH_ID }),
      );
      db.tables.get("rachandzach_upload_items")!.push(
        seedItem({
          id: OTHER_ITEM_ID,
          batch_id: OTHER_BATCH_ID,
          object_path: OTHER_OBJECT_PATH,
          original_name: "blocked-duplicate.jpg",
        }),
      );
      putOriginal(db, original, OTHER_OBJECT_PATH);

      await expect(
        processApprovedPhoto(
          OTHER_ITEM_ID,
          { ...NO_METADATA, expectedBatchId: OTHER_BATCH_ID },
          db.client,
        ),
      ).rejects.toThrow(/not yet reusable from another batch/);

      const otherItem = db
        .tables
        .get("rachandzach_upload_items")!
        .find((row) => row.id === OTHER_ITEM_ID);
      expect(otherItem?.status).toBe("pending");
      expect(photo.status).toBe(status);

      const rejected = await transitionUploadItem(
        OTHER_ITEM_ID,
        {
          itemId: OTHER_ITEM_ID,
          action: "reject",
          eventSlug: null,
          peopleSlugs: [],
          keywords: [],
          noteApproved: false,
          rejectionReason: "Duplicate is not reusable",
        },
        TEST_ACTOR,
        db.client,
      );
      expect(rejected.status).toBe("rejected");
      expect(photo.status).toBe(status);
    },
  );

  it("blocks a completed pending cross-batch duplicate that wins the unique-insert race", async () => {
    const db = buildDb();
    db.tables.get("rachandzach_upload_batches")!.push(
      seedBatch({ id: OTHER_BATCH_ID }),
    );
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));

    let injected = false;
    db.insertHook = (table, row) => {
      if (table !== "rachandzach_photos" || injected) return;
      injected = true;
      db.tables.get("rachandzach_photos")!.push({
        ...row,
        id: "raced-cross-batch-photo",
        submitted_batch_id: OTHER_BATCH_ID,
        processing_complete: true,
        status: "pending",
      });
    };

    await expect(
      processApprovedPhoto(ITEM_ID, NO_METADATA, db.client),
    ).rejects.toThrow(/not yet reusable from another batch/);

    const [item] = db.tables.get("rachandzach_upload_items") ?? [];
    expect(item.status).toBe("pending");
    const [photo] = db.tables.get("rachandzach_photos") ?? [];
    expect(photo).toMatchObject({
      id: "raced-cross-batch-photo",
      submitted_batch_id: OTHER_BATCH_ID,
      processing_complete: true,
      status: "pending",
    });
  });

  it("quarantines a staged photo when its owning item is removed", async () => {
    const db = buildDb(
      {},
      {
        note: "Removed content must remain private.",
        display_name: "Private Guest",
      },
    );
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));
    const staged = await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);

    const [storedItem] = db.tables.get("rachandzach_upload_items") ?? [];
    storedItem.status = "removed";
    storedItem.note_approved = true;

    await reconcileProcessedPhoto(
      ITEM_ID,
      staged.photoId,
      { expectedBatchId: BATCH_ID, publishApproved: false },
      db.client,
    );

    const [photo] = db.tables.get("rachandzach_photos") ?? [];
    expect(photo.status).toBe("rejected");
    expect(photo.uploader_caption).toBeNull();
    expect(photo.uploader_caption_byline).toBeNull();
    expect(photo.approved_at).toBeNull();
  });

  it("never republishes a photo that was manually hidden after approval", async () => {
    const db = buildDb(
      {},
      {
        note: "This was approved before the catalog hide.",
        display_name: "Jamie",
      },
    );
    putOriginal(db, readFixture("synthetic-1-tiny.jpg"));
    const staged = await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);
    await approveAndReconcile(db, staged.photoId, true);

    const [photo] = db.tables.get("rachandzach_photos") ?? [];
    photo.status = "hidden";
    await reconcileProcessedPhoto(
      ITEM_ID,
      staged.photoId,
      { expectedBatchId: BATCH_ID },
      db.client,
    );

    expect(photo.status).toBe("hidden");
  });

  it.each(["published", "hidden"])(
    "reuses a completed %s duplicate without replacing provenance or caption",
    async (reusableStatus) => {
      const original = readFixture("synthetic-1-tiny.jpg");
      const db = buildDb(
        {},
        {
          note: "The original batch owns this caption.",
          display_name: "Original Guest",
        },
      );
      putOriginal(db, original);

      const first = await processApprovedPhoto(ITEM_ID, NO_METADATA, db.client);
      await approveAndReconcile(db, first.photoId, true);
      const [ownedPhoto] = db.tables.get("rachandzach_photos") ?? [];
      ownedPhoto.status = reusableStatus;

      db.tables.get("rachandzach_upload_batches")!.push(
        seedBatch({
          id: OTHER_BATCH_ID,
          note: "A later duplicate must not replace this.",
          display_name: "Later Guest",
        }),
      );
      db.tables.get("rachandzach_upload_items")!.push(
        seedItem({
          id: OTHER_ITEM_ID,
          batch_id: OTHER_BATCH_ID,
          object_path: OTHER_OBJECT_PATH,
          original_name: "later-duplicate.jpg",
        }),
      );
      putOriginal(db, original, OTHER_OBJECT_PATH);

      const duplicate = await processApprovedPhoto(
        OTHER_ITEM_ID,
        { ...NO_METADATA, expectedBatchId: OTHER_BATCH_ID },
        db.client,
      );
      expect(duplicate).toEqual({ photoId: first.photoId, created: false });

      await approveAndReconcile(
        db,
        duplicate.photoId,
        true,
        OTHER_ITEM_ID,
        OTHER_BATCH_ID,
      );

      const [photo] = db.tables.get("rachandzach_photos") ?? [];
      expect(photo.submitted_batch_id).toBe(BATCH_ID);
      expect(photo.status).toBe(reusableStatus);
      expect(photo.original_filename).toBe("my-photo.jpg");
      expect(photo.uploader_caption).toBe(
        "The original batch owns this caption.",
      );
      expect(photo.uploader_caption_byline).toBeNull();
      expect(JSON.stringify(photo)).not.toContain("Original Guest");
      expect(JSON.stringify(photo)).not.toContain("Later Guest");
    },
  );
});
