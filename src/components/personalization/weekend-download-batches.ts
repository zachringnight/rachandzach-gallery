/**
 * Download-My-Weekend batching (Round Two Features, "Download my weekend" --
 * docs/0719_Round_Two_Features_v1.md, "Round-two proper").
 *
 * Splits one person's full tagged-photo id list into ordered groups that
 * each respect MAX_SELECTION_ITEMS -- the existing /api/downloads/selection
 * cap (src/lib/downloads/contracts.ts) that both DownloadSelectionButton and
 * SavePhotosButton call unchanged -- so a guest tagged in more than 50
 * photos still gets a working download instead of a 400 from the shared
 * endpoint. Pure id-count chunking and filename suffixing only: no ZIP or
 * share-sheet logic lives here, that stays inside DownloadSelectionButton/
 * SavePhotosButton (src/components/downloads/**), which
 * DownloadMyWeekendButton.tsx imports and reuses unchanged, once per batch.
 *
 * This task's scope is pinned to src/components/personalization/** and
 * tests/personalization/** only, so -- mirroring share-sheet.ts's precedent
 * next door in src/components/downloads/ -- this file deliberately lives
 * here rather than in src/lib/downloads/, and only ever imports
 * MAX_SELECTION_ITEMS from there, never edits it.
 */
import { MAX_SELECTION_ITEMS } from "@/lib/downloads/contracts";

/**
 * Splits `photoIds` into ordered, contiguous batches of at most
 * `maxPerBatch` ids (defaults to MAX_SELECTION_ITEMS). Order is preserved
 * and nothing is dropped or duplicated. An empty input yields an empty array
 * of batches (zero parts), not a single empty batch, so callers can treat
 * `batches.length === 0` as "nothing to download."
 */
export function chunkPhotoIdsForDownload(
  photoIds: readonly string[],
  maxPerBatch: number = MAX_SELECTION_ITEMS,
): string[][] {
  if (photoIds.length === 0) return [];
  const batches: string[][] = [];
  for (let start = 0; start < photoIds.length; start += maxPerBatch) {
    batches.push(photoIds.slice(start, start + maxPerBatch));
  }
  return batches;
}

/**
 * Suffixes a base ZIP filename with "-part-N-of-M" (1-indexed) for the rare
 * case a person's photos need more than one part. Returns `base` untouched
 * when `count` is 1. Mirrors DownloadSelectionButton's own internal
 * batchZipFilename in shape, but operates one stage earlier: this names each
 * top-level MAX_SELECTION_ITEMS-sized part before anything is fetched, while
 * DownloadSelectionButton's private helper names byte-bounded sub-batches of
 * an already-fetched single part on the in-memory-Blob fallback path. The
 * two compose (a part's zipFilename here can itself get a further internal
 * "-1-of-2" suffix from that path) rather than duplicate one another --
 * DownloadSelectionButton does not export its version to reuse directly.
 */
export function partZipFilename(base: string, index: number, count: number): string {
  if (count <= 1) return base;
  const dot = base.toLowerCase().endsWith(".zip") ? base.length - 4 : base.length;
  return `${base.slice(0, dot)}-part-${index + 1}-of-${count}${base.slice(dot)}`;
}
