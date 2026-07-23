/**
 * Share-sheet pure-helper tests (Round Two Features, "Save photos" --
 * docs/0719_Round_Two_Features_v1.md, Zach approved iCloud-via-share-sheet
 * 2026-07-22). Covers src/components/downloads/share-sheet.ts directly: the
 * canShare-files probe, the chunking math (count cap, byte cap, and the
 * two combined -- "whichever comes first"), and abort-error detection. No
 * DOM/jsdom needed for any of these; canShareFiles takes an injectable
 * fake navigator so this file runs entirely in the plain Node test project,
 * mirroring how selection.test.ts covers stream-zip.ts's pure helpers.
 */
import { describe, expect, it, vi } from "vitest";
import {
  SHARE_CHUNK_MAX_BYTES,
  SHARE_CHUNK_MAX_FILES,
  buildProbeFile,
  canShareFiles,
  chunkForShare,
  isAbortError,
} from "@/components/downloads/share-sheet";

// --- buildProbeFile ------------------------------------------------------

describe("buildProbeFile", () => {
  it("builds a small image/jpeg File, never anything larger or of another type", () => {
    const probe = buildProbeFile();
    expect(probe).toBeInstanceOf(File);
    expect(probe.type).toBe("image/jpeg");
    expect(probe.size).toBeGreaterThan(0);
    expect(probe.size).toBeLessThan(1024);
  });
});

// --- canShareFiles ---------------------------------------------------------

describe("canShareFiles", () => {
  it("is false when navigator.canShare does not exist at all", () => {
    expect(canShareFiles({})).toBe(false);
  });

  it("is false when canShare is present but rejects a files share", () => {
    const canShare = vi.fn().mockReturnValue(false);
    expect(canShareFiles({ canShare })).toBe(false);
    // The probe check must actually be exercised, not skipped.
    expect(canShare).toHaveBeenCalledTimes(1);
  });

  it("is true when canShare accepts a files share", () => {
    const canShare = vi.fn().mockReturnValue(true);
    expect(canShareFiles({ canShare })).toBe(true);
  });

  it("probes with exactly one File in the files array", () => {
    const canShare = vi.fn().mockReturnValue(true);
    canShareFiles({ canShare });
    const arg = canShare.mock.calls[0][0] as { files: File[] };
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0]).toBeInstanceOf(File);
  });

  it("is false, not a throw, when canShare itself throws", () => {
    const canShare = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => canShareFiles({ canShare })).not.toThrow();
    expect(canShareFiles({ canShare })).toBe(false);
  });

  it("is false when canShare returns a truthy non-boolean (strict boolean comparison)", () => {
    const canShare = vi.fn().mockReturnValue("yes" as unknown as boolean);
    expect(canShareFiles({ canShare })).toBe(false);
  });

  it("falls back to the real global navigator when no override is passed, and does not throw in Node", () => {
    expect(() => canShareFiles()).not.toThrow();
  });
});

// --- chunkForShare -----------------------------------------------------------

describe("chunkForShare", () => {
  it("pins the packet's chunk caps: 10 files or ~80 MB", () => {
    expect(SHARE_CHUNK_MAX_FILES).toBe(10);
    expect(SHARE_CHUNK_MAX_BYTES).toBe(80_000_000);
  });

  it("returns a single chunk for a small selection", () => {
    const items = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, bytes: 1_000_000 }));
    expect(chunkForShare(items)).toEqual([items]);
  });

  it("splits purely on the file-count cap when bytes stay small", () => {
    const items = Array.from({ length: 23 }, (_, i) => ({ id: `p${i}`, bytes: 1000 }));
    const chunks = chunkForShare(items, 10, SHARE_CHUNK_MAX_BYTES);
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 3]);
    expect(chunks.flat()).toEqual(items);
  });

  it("splits purely on the byte cap when the count stays under the file cap", () => {
    const items = [
      { id: "a", bytes: 30_000_000 },
      { id: "b", bytes: 30_000_000 },
      { id: "c", bytes: 30_000_000 }, // pushes the running total past 80,000,000
      { id: "d", bytes: 10_000_000 },
    ];
    const chunks = chunkForShare(items, 10, 80_000_000);
    expect(chunks).toEqual([
      [items[0], items[1]],
      [items[2], items[3]],
    ]);
  });

  it("cuts a chunk on whichever cap is hit first, file count or bytes", () => {
    // Count cap (2) is hit before the byte cap (100) would ever be reached.
    const smallItems = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, bytes: 1 }));
    expect(chunkForShare(smallItems, 2, 100).map((c) => c.length)).toEqual([2, 2, 1]);

    // Byte cap (10) is hit before the file-count cap (50) would ever be reached.
    const bigItems = [
      { id: "a", bytes: 6 },
      { id: "b", bytes: 6 },
      { id: "c", bytes: 6 },
    ];
    expect(chunkForShare(bigItems, 50, 10)).toEqual([[bigItems[0]], [bigItems[1]], [bigItems[2]]]);
  });

  it("gives an over-cap single item its own solo chunk instead of dropping it", () => {
    const items = [
      { id: "small", bytes: 10 },
      { id: "huge", bytes: 200_000_000 },
      { id: "small-2", bytes: 10 },
    ];
    const chunks = chunkForShare(items, 10, 80_000_000);
    expect(chunks).toEqual([[items[0]], [items[1]], [items[2]]]);
  });

  it("never produces an empty chunk and always accounts for every item, order preserved", () => {
    const items = Array.from({ length: 37 }, (_, i) => ({ id: `p${i}`, bytes: 3_000_000 }));
    const chunks = chunkForShare(items);
    expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
    expect(chunks.flat()).toEqual(items);
    expect(chunks.every((chunk) => chunk.length <= SHARE_CHUNK_MAX_FILES)).toBe(true);
  });

  it("returns no chunks for an empty selection", () => {
    expect(chunkForShare([])).toEqual([]);
  });

  it("matches the packet example shape: 32 photos chunks into groups of at most 10", () => {
    const items = Array.from({ length: 32 }, (_, i) => ({ id: `p${i}`, bytes: 4_000_000 }));
    const chunks = chunkForShare(items);
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 10, 2]);
  });
});

// --- isAbortError --------------------------------------------------------------

describe("isAbortError", () => {
  it("is true for a DOMException named AbortError", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it("is false for a DOMException with a different name", () => {
    expect(isAbortError(new DOMException("nope", "NotAllowedError"))).toBe(false);
  });

  it("is false for a plain Error, even one that says 'abort'", () => {
    expect(isAbortError(new Error("AbortError"))).toBe(false);
  });

  it("is false for non-error values", () => {
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
