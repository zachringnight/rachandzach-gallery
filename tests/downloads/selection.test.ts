/**
 * Selection/original-download tests (packet 09).
 *
 * Covers getOriginalDownload/getSelectionDownloads against the in-memory
 * OriginalsDataSource fixture (duplicates, missing ids, unapproved/mis-
 * bucketed uploads, the >50 cap, filename collisions, expiry, and per-item
 * signing failure), plus the pure client-side ZIP batching helpers
 * (fallback-size limits). No live database or storage; the fixture records
 * every signing call so the "single authorization check, batch-signed"
 * behavior is verifiable directly.
 */
import { describe, expect, it } from "vitest";
import {
  DownloadNotFoundError,
  DownloadValidationError,
  MAX_SELECTION_ITEMS,
  ORIGINAL_DOWNLOAD_URL_TTL_SECONDS,
  SELECTION_DOWNLOAD_URL_TTL_SECONDS,
  dedupeFilenames,
} from "@/lib/downloads/contracts";
import {
  getOriginalDownload,
  getSelectionDownloads,
} from "@/lib/downloads/sign-originals";
import {
  needsFallbackSizeWarning,
  splitIntoBoundedBatches,
  supportsFileSystemAccessZip,
  totalBytes,
} from "@/lib/downloads/stream-zip";
import { buildDownloadsFixture } from "../fixtures/downloads/catalog";

// --- dedupeFilenames (pure helper) ------------------------------------------

describe("dedupeFilenames", () => {
  it("keeps the first occurrence and suffixes later duplicates deterministically", () => {
    expect(
      dedupeFilenames(["IMG_0001.JPG", "IMG_0002.JPG", "IMG_0001.JPG"]),
    ).toEqual(["IMG_0001.JPG", "IMG_0002.JPG", "IMG_0001 (2).JPG"]);
  });

  it("treats names as case-insensitively equal but preserves each entry's own casing", () => {
    expect(
      dedupeFilenames(["IMG_0001.JPG", "img_0001.jpg", "Img_0001.Jpg"]),
    ).toEqual(["IMG_0001.JPG", "img_0001 (2).jpg", "Img_0001 (3).Jpg"]);
  });

  it("handles a filename with no extension", () => {
    expect(dedupeFilenames(["photo", "photo"])).toEqual(["photo", "photo (2)"]);
  });

  it("leaves an already-unique list untouched", () => {
    const names = ["a.jpg", "b.jpg", "c.jpg"];
    expect(dedupeFilenames(names)).toEqual(names);
  });
});

// --- getOriginalDownload -----------------------------------------------------

describe("getOriginalDownload", () => {
  it("signs an approved photographer original with the packet-pinned 10-minute TTL", async () => {
    const fixture = buildDownloadsFixture();
    const before = Date.now();
    const result = await getOriginalDownload("photo-ceremony-1", fixture.source);

    expect(result.photoId).toBe("photo-ceremony-1");
    expect(result.filename).toBe("IMG_0001.JPG");
    expect(result.bytes).toBe(4_200_000);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.signedUrl).toContain("rachandzach-originals");

    const ttlMs = Date.parse(result.expiresAt) - before;
    expect(ttlMs).toBeGreaterThan((ORIGINAL_DOWNLOAD_URL_TTL_SECONDS - 5) * 1000);
    expect(ttlMs).toBeLessThanOrEqual((ORIGINAL_DOWNLOAD_URL_TTL_SECONDS + 5) * 1000);

    expect(fixture.signCalls).toEqual([
      {
        bucket: "rachandzach-originals",
        objectPath: "originals/aa/ceremony-1.jpg",
        ttlSeconds: ORIGINAL_DOWNLOAD_URL_TTL_SECONDS,
        downloadFilename: "IMG_0001.JPG",
      },
    ]);
  });

  it("signs an approved guest (guest-approved bucket) original", async () => {
    const fixture = buildDownloadsFixture();
    const result = await getOriginalDownload("photo-reception-1", fixture.source);
    expect(result.filename).toBe("img_0001.jpg");
    expect(result.signedUrl).toContain("rachandzach-guest-approved");
  });

  it("rejects an empty photoId without touching the data source", async () => {
    const fixture = buildDownloadsFixture();
    await expect(getOriginalDownload("", fixture.source)).rejects.toBeInstanceOf(
      DownloadValidationError,
    );
    expect(fixture.signCalls).toHaveLength(0);
  });

  it.each([
    ["an unknown id", "unknownId"],
    ["a pending upload", "pendingId"],
    ["a hidden photo", "hiddenId"],
    ["a rejected upload", "rejectedId"],
    ["an approved row pointing at the previews bucket", "wrongBucketId"],
  ] as const)("returns not-found for %s", async (_label, key) => {
    const fixture = buildDownloadsFixture();
    const id = fixture[key];
    await expect(getOriginalDownload(id, fixture.source)).rejects.toBeInstanceOf(
      DownloadNotFoundError,
    );
  });

  it("returns not-found when the object cannot actually be signed (missing from storage)", async () => {
    const fixture = buildDownloadsFixture({
      unsignableObjectPaths: ["originals/aa/ceremony-1.jpg"],
    });
    await expect(
      getOriginalDownload("photo-ceremony-1", fixture.source),
    ).rejects.toBeInstanceOf(DownloadNotFoundError);
  });

  it("honors a custom TTL", async () => {
    const fixture = buildDownloadsFixture();
    const before = Date.now();
    const result = await getOriginalDownload("photo-ceremony-1", fixture.source, 120);
    const ttlMs = Date.parse(result.expiresAt) - before;
    expect(ttlMs).toBeGreaterThan(110 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(125 * 1000);
    expect(fixture.signCalls[0].ttlSeconds).toBe(120);
  });
});

// --- getSelectionDownloads ---------------------------------------------------

describe("getSelectionDownloads", () => {
  it("returns the packet-pinned maximumItems and the packet-pinned default TTL window", async () => {
    const fixture = buildDownloadsFixture();
    const before = Date.now();
    const result = await getSelectionDownloads(
      ["photo-ceremony-1"],
      fixture.source,
    );
    expect(result.maximumItems).toBe(MAX_SELECTION_ITEMS);
    expect(MAX_SELECTION_ITEMS).toBe(50);

    const ttlMs = Date.parse(result.items[0].expiresAt) - before;
    expect(ttlMs).toBeGreaterThan((SELECTION_DOWNLOAD_URL_TTL_SECONDS - 5) * 1000);
    expect(ttlMs).toBeLessThanOrEqual((SELECTION_DOWNLOAD_URL_TTL_SECONDS + 5) * 1000);
  });

  it("drops duplicate ids, keeping a single item per photo", async () => {
    const fixture = buildDownloadsFixture();
    const result = await getSelectionDownloads(
      ["photo-ceremony-1", "photo-ceremony-1", "photo-ceremony-2"],
      fixture.source,
    );
    expect(result.items.map((item) => item.photoId)).toEqual([
      "photo-ceremony-1",
      "photo-ceremony-2",
    ]);
  });

  it("silently drops unknown ids and returns the rest", async () => {
    const fixture = buildDownloadsFixture();
    const result = await getSelectionDownloads(
      ["photo-ceremony-1", fixture.unknownId, "photo-ceremony-2"],
      fixture.source,
    );
    expect(result.items.map((item) => item.photoId)).toEqual([
      "photo-ceremony-1",
      "photo-ceremony-2",
    ]);
  });

  it("silently drops pending, hidden, rejected, and wrong-bucket rows (never surfaced as items)", async () => {
    const fixture = buildDownloadsFixture();
    const result = await getSelectionDownloads(
      [
        "photo-ceremony-1",
        fixture.pendingId,
        fixture.hiddenId,
        fixture.rejectedId,
        fixture.wrongBucketId,
      ],
      fixture.source,
    );
    expect(result.items.map((item) => item.photoId)).toEqual(["photo-ceremony-1"]);
  });

  it("returns an empty selection (not an error) when nothing in the request is downloadable", async () => {
    const fixture = buildDownloadsFixture();
    const result = await getSelectionDownloads(
      [fixture.pendingId, fixture.unknownId],
      fixture.source,
    );
    expect(result).toEqual({ items: [], maximumItems: MAX_SELECTION_ITEMS, estimatedBytes: 0 });
  });

  it("rejects more than 50 ids without calling the data source", async () => {
    const fixture = buildDownloadsFixture();
    const tooMany = Array.from({ length: 51 }, (_, i) => `photo-${i}`);
    await expect(
      getSelectionDownloads(tooMany, fixture.source),
    ).rejects.toBeInstanceOf(DownloadValidationError);
    expect(fixture.batchSignCalls).toHaveLength(0);
  });

  it("accepts exactly 50 distinct ids (the boundary itself is not rejected)", async () => {
    const fixture = buildDownloadsFixture();
    const fiftyDistinctIds = Array.from({ length: 50 }, (_, i) => `nonexistent-${i}`);
    // None of these resolve to a real row, so items comes back empty -- the
    // point is that validation does not throw at exactly 50.
    await expect(
      getSelectionDownloads(fiftyDistinctIds, fixture.source),
    ).resolves.toEqual({ items: [], maximumItems: MAX_SELECTION_ITEMS, estimatedBytes: 0 });
  });

  it("de-duplicates before counting toward the cap: 50 repeats of one id is just one item", async () => {
    const fixture = buildDownloadsFixture();
    const fiftyRepeats = Array.from({ length: 50 }, () => "photo-ceremony-1");
    const result = await getSelectionDownloads(fiftyRepeats, fixture.source);
    expect(result.items).toHaveLength(1);
  });

  it("rejects an empty selection", async () => {
    const fixture = buildDownloadsFixture();
    await expect(getSelectionDownloads([], fixture.source)).rejects.toBeInstanceOf(
      DownloadValidationError,
    );
  });

  it("rejects a non-array payload", async () => {
    const fixture = buildDownloadsFixture();
    await expect(
      getSelectionDownloads("not-an-array" as unknown as string[], fixture.source),
    ).rejects.toBeInstanceOf(DownloadValidationError);
  });

  it("resolves filename collisions deterministically across the selection", async () => {
    const fixture = buildDownloadsFixture();
    // photo-ceremony-1 = "IMG_0001.JPG", photo-reception-1 = "img_0001.jpg",
    // photo-reception-2 = "IMG_0001.JPG" -- three case-insensitive collisions.
    const result = await getSelectionDownloads(
      ["photo-ceremony-1", "photo-reception-1", "photo-reception-2"],
      fixture.source,
    );
    expect(result.items.map((item) => item.filename)).toEqual([
      "IMG_0001.JPG",
      "img_0001 (2).jpg",
      "IMG_0001 (3).JPG",
    ]);
  });

  it("signs the whole selection with one batch call, not one call per item", async () => {
    const fixture = buildDownloadsFixture();
    await getSelectionDownloads(
      ["photo-ceremony-1", "photo-ceremony-2", "photo-reception-1"],
      fixture.source,
    );
    expect(fixture.batchSignCalls).toHaveLength(1);
    expect(fixture.batchSignCalls[0].items).toHaveLength(3);
    // The single-item signOriginal() path (used by getOriginalDownload/the
    // one-photo route) is never invoked by the batch path.
    expect(fixture.signCalls).toHaveLength(0);
  });

  it("skips an item that fails to sign and still returns the rest of the selection", async () => {
    const fixture = buildDownloadsFixture({
      unsignableObjectPaths: ["originals/bb/ceremony-2.jpg"],
    });
    const result = await getSelectionDownloads(
      ["photo-ceremony-1", "photo-ceremony-2"],
      fixture.source,
    );
    expect(result.items.map((item) => item.photoId)).toEqual(["photo-ceremony-1"]);
  });

  it("computes estimatedBytes as the sum of the signed items only", async () => {
    const fixture = buildDownloadsFixture({
      unsignableObjectPaths: ["originals/bb/ceremony-2.jpg"],
    });
    const result = await getSelectionDownloads(
      ["photo-ceremony-1", "photo-ceremony-2"],
      fixture.source,
    );
    // ceremony-2 failed to sign, so only ceremony-1's bytes count.
    expect(result.estimatedBytes).toBe(4_200_000);
  });

  it("honors a custom TTL for the whole batch", async () => {
    const fixture = buildDownloadsFixture();
    const result = await getSelectionDownloads(
      ["photo-ceremony-1", "photo-ceremony-2"],
      fixture.source,
      90,
    );
    expect(fixture.batchSignCalls[0].ttlSeconds).toBe(90);
    for (const item of result.items) {
      const ttlMs = Date.parse(item.expiresAt) - Date.now();
      expect(ttlMs).toBeLessThanOrEqual(95 * 1000);
      expect(ttlMs).toBeGreaterThan(80 * 1000);
    }
  });
});

// --- Client-side ZIP fallback-size limits (pure helpers) ---------------------

describe("ZIP fallback size limits", () => {
  it("File System Access is correctly detected as unsupported outside a browser", () => {
    expect(supportsFileSystemAccessZip()).toBe(false);
  });

  it("sums item bytes", () => {
    expect(totalBytes([{ bytes: 10 }, { bytes: 20 }, { bytes: 30 }])).toBe(60);
    expect(totalBytes([])).toBe(0);
  });

  it("never warns when the File System Access path is available, regardless of size", () => {
    const huge = [{ bytes: 5_000_000_000 }];
    expect(needsFallbackSizeWarning(huge, true)).toBe(false);
  });

  it("warns on the fallback (Blob) path once the selection exceeds 1 GB", () => {
    const justUnder = [{ bytes: 999_000_000 }];
    const over = [{ bytes: 1_000_000_001 }];
    expect(needsFallbackSizeWarning(justUnder, false)).toBe(false);
    expect(needsFallbackSizeWarning(over, false)).toBe(true);
  });

  it("in this Node test environment (no window), the warning check defaults to the fallback path", () => {
    // No explicit hasFileSystemAccess argument: it should resolve via
    // supportsFileSystemAccessZip(), which is false here, so a large
    // selection warns even though the caller passed nothing.
    expect(needsFallbackSizeWarning([{ bytes: 2_000_000_000 }])).toBe(true);
  });

  it("splits a selection into batches at/under the byte cap, preserving order", () => {
    const items = [
      { id: "a", bytes: 400_000_000 },
      { id: "b", bytes: 400_000_000 },
      { id: "c", bytes: 400_000_000 }, // would push batch 1 over 1,000,000,000
      { id: "d", bytes: 100_000_000 },
    ];
    const batches = splitIntoBoundedBatches(items, 1_000_000_000);
    expect(batches).toEqual([
      [items[0], items[1]],
      [items[2], items[3]],
    ]);
  });

  it("gives an over-cap single item its own solo batch instead of dropping it", () => {
    const items = [
      { id: "small", bytes: 10 },
      { id: "huge", bytes: 2_000_000_000 },
      { id: "small-2", bytes: 10 },
    ];
    const batches = splitIntoBoundedBatches(items, 1_000_000_000);
    expect(batches).toEqual([[items[0]], [items[1]], [items[2]]]);
  });

  it("never produces an empty batch and always accounts for every item", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, bytes: 90_000_000 }));
    const batches = splitIntoBoundedBatches(items, 250_000_000);
    expect(batches.every((batch) => batch.length > 0)).toBe(true);
    expect(batches.flat()).toEqual(items);
  });

  it("returns a single empty-selection result (no batches) for an empty input", () => {
    expect(splitIntoBoundedBatches([])).toEqual([]);
  });
});
