/**
 * Web Share API helpers for the "Save photos" share-sheet button (Round Two
 * Features, "Guest Save to cloud on the selection tray": Zach approved
 * iCloud-via-share-sheet 2026-07-22 -- docs/0719_Round_Two_Features_v1.md).
 *
 * iCloud has no third-party web API, so the guest-facing mechanism is the
 * platform Web Share API: handing File objects to navigator.share() opens
 * the native share sheet, where Save Images (iCloud Photos) and Save to
 * Files (iCloud Drive) are one tap on Apple devices. The Google Drive /
 * Dropbox OAuth buttons described in the same doc are a separate, not-yet-
 * built slice (waiting on client IDs) -- nothing here wires to them.
 *
 * Pure, DOM-light helpers split out of SavePhotosButton.tsx so the
 * feature-detection and chunking math are unit-testable on their own, the
 * same split contracts.ts/stream-zip.ts use for the ZIP path. This task's
 * scope is pinned to src/components/downloads/** and tests/downloads/**
 * only, so this file deliberately lives here rather than alongside its
 * siblings in src/lib/downloads/ -- it only ever *imports* from
 * src/lib/downloads/contracts (a type, for the generic bound below), never
 * edits anything under src/lib/downloads.
 */
import type { OriginalDownload } from "@/lib/downloads/contracts";

// --- Constants ---------------------------------------------------------------

/**
 * At most this many files per navigator.share() call. One giant share of a
 * full 50-photo selection is unreliable across devices, so the guest's
 * selection is split into sequential share invocations instead.
 */
export const SHARE_CHUNK_MAX_FILES = 10;

/** ...or at most this many bytes per share() call, whichever limit is hit
 *  first. ~80 MB (decimal, matching contracts.ts's own byte constants). */
export const SHARE_CHUNK_MAX_BYTES = 80 * 1_000_000;

// --- Feature detection ---------------------------------------------------

/**
 * Minimal surface this module needs from `navigator`, injectable so tests
 * never have to mutate the real global. A real Navigator satisfies this
 * structurally (canShare is optional here; required-but-possibly-absent-at-
 * runtime on the real DOM type).
 */
export interface ShareCapableNavigator {
  canShare?: (data?: ShareData) => boolean;
}

/**
 * A tiny throwaway File used only to ask canShare() "would a real photo
 * share work here?". Never shared, uploaded, or rendered anywhere.
 */
export function buildProbeFile(): File {
  return new File(["probe"], "probe.jpg", { type: "image/jpeg" });
}

/**
 * True only when navigator.canShare exists AND actually accepts a files
 * share. Checking existence alone would false-positive on a browser whose
 * canShare()/share() only supports text/url sharing, not files -- exactly
 * the case the packet's probe-File check exists to catch. Never throws: a
 * canShare() implementation that itself throws on this shape is treated as
 * unsupported, not a crash.
 */
export function canShareFiles(nav?: ShareCapableNavigator): boolean {
  const target: ShareCapableNavigator | undefined =
    nav ?? (typeof navigator === "undefined" ? undefined : navigator);
  if (!target || typeof target.canShare !== "function") return false;
  try {
    return target.canShare({ files: [buildProbeFile()] }) === true;
  } catch {
    return false;
  }
}

// --- Chunking -----------------------------------------------------------------

/**
 * Splits a selection into sequential share() batches: at most
 * SHARE_CHUNK_MAX_FILES items AND at most SHARE_CHUNK_MAX_BYTES per chunk,
 * whichever limit is hit first. Order is preserved; a chunk is never empty;
 * a single item over the byte cap on its own still gets a solo chunk rather
 * than being dropped (mirrors splitIntoBoundedBatches in stream-zip.ts).
 */
export function chunkForShare<T extends Pick<OriginalDownload, "bytes">>(
  items: readonly T[],
  maxFiles: number = SHARE_CHUNK_MAX_FILES,
  maxBytes: number = SHARE_CHUNK_MAX_BYTES,
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;
  for (const item of items) {
    const overCount = current.length >= maxFiles;
    const overBytes = current.length > 0 && currentBytes + item.bytes > maxBytes;
    if (current.length > 0 && (overCount || overBytes)) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += item.bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// --- Abort handling ------------------------------------------------------------

/**
 * True for the DOMException navigator.share() (and fetch) reject with when
 * the guest dismisses the native share sheet, or cancels an in-flight
 * fetch, rather than an actual failure. Mirrors the private isAbortError in
 * stream-zip.ts (re-declared here rather than reaching into that module).
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
