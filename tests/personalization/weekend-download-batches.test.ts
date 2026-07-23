/**
 * Pure batching-math tests for "Download my weekend" (Round Two Features --
 * docs/0719_Round_Two_Features_v1.md, "Round-two proper"). Covers the
 * id-count chunking DownloadMyWeekendButton.tsx uses to stay under
 * MAX_SELECTION_ITEMS (the existing /api/downloads/selection cap) before
 * ever calling the reused DownloadSelectionButton/SavePhotosButton flow, plus
 * the small filename-suffixing helper used for a multi-part download. No DOM,
 * no fetch -- these are exercised directly against the pure functions, the
 * same split contracts.ts/stream-zip.ts use for their own batching math
 * (tests/downloads/selection.test.ts).
 */
import { describe, expect, it } from "vitest";
import { MAX_SELECTION_ITEMS } from "@/lib/downloads/contracts";
import {
  chunkPhotoIdsForDownload,
  partZipFilename,
} from "@/components/personalization/weekend-download-batches";

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `photo-${i}`);
}

describe("chunkPhotoIdsForDownload", () => {
  it("returns zero batches for an empty person (no photos to download)", () => {
    expect(chunkPhotoIdsForDownload([])).toEqual([]);
  });

  it("returns exactly one batch when under the cap", () => {
    const batches = chunkPhotoIdsForDownload(ids(3));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(ids(3));
  });

  it("returns exactly one full batch at exactly MAX_SELECTION_ITEMS (boundary: no split needed)", () => {
    const batches = chunkPhotoIdsForDownload(ids(MAX_SELECTION_ITEMS));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(MAX_SELECTION_ITEMS);
    expect(batches[0]).toEqual(ids(MAX_SELECTION_ITEMS));
  });

  it("splits into two batches at MAX_SELECTION_ITEMS + 1 (boundary: one over triggers a second part)", () => {
    const batches = chunkPhotoIdsForDownload(ids(MAX_SELECTION_ITEMS + 1));
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(MAX_SELECTION_ITEMS);
    expect(batches[1]).toHaveLength(1);
    // Order preserved and nothing dropped or duplicated across the split.
    expect(batches.flat()).toEqual(ids(MAX_SELECTION_ITEMS + 1));
  });

  it("splits a much larger list into full-cap parts plus one remainder part", () => {
    const total = MAX_SELECTION_ITEMS * 2 + 17;
    const batches = chunkPhotoIdsForDownload(ids(total));
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(MAX_SELECTION_ITEMS);
    expect(batches[1]).toHaveLength(MAX_SELECTION_ITEMS);
    expect(batches[2]).toHaveLength(17);
    expect(batches.flat()).toEqual(ids(total));
  });

  it("never bypasses the cap: every batch stays at or under maxPerBatch for an arbitrary custom cap", () => {
    const batches = chunkPhotoIdsForDownload(ids(23), 5);
    expect(batches.map((b) => b.length)).toEqual([5, 5, 5, 5, 3]);
    expect(batches.flat()).toEqual(ids(23));
  });

  it("defaults maxPerBatch to MAX_SELECTION_ITEMS when not given", () => {
    const batches = chunkPhotoIdsForDownload(ids(MAX_SELECTION_ITEMS + 5));
    expect(batches[0]).toHaveLength(MAX_SELECTION_ITEMS);
  });
});

describe("partZipFilename", () => {
  it("leaves the filename untouched when there is only one part", () => {
    expect(partZipFilename("rachel-weekend.zip", 0, 1)).toBe("rachel-weekend.zip");
  });

  it("suffixes with a 1-indexed part number and total before the extension", () => {
    expect(partZipFilename("rachel-weekend.zip", 0, 3)).toBe(
      "rachel-weekend-part-1-of-3.zip",
    );
    expect(partZipFilename("rachel-weekend.zip", 2, 3)).toBe(
      "rachel-weekend-part-3-of-3.zip",
    );
  });

  it("handles a base filename with no extension", () => {
    expect(partZipFilename("rachel-weekend", 0, 2)).toBe("rachel-weekend-part-1-of-2");
  });
});
