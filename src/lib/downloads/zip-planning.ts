/**
 * ZIP planning maths, deliberately free of any zip.js import.
 *
 * These four helpers decide WHETHER and HOW to zip; stream-zip.ts does the
 * zipping. They were split out because they lived beside a module-scope
 * `import { ZipWriter } from "@zip.js/zip.js"`, so any component that merely
 * wanted to work out batch sizes pulled the whole zip engine into its bundle.
 * That put ~60 KB gzipped of deflate implementation on the first paint of
 * /photos, /my-weekend, /favorites, and every person page -- for code that
 * cannot run until someone selects photos and clicks Download.
 *
 * Keep this file free of heavy imports. Anything added here ships everywhere.
 */
import { ZIP_FALLBACK_WARNING_BYTES, type OriginalDownload } from "./contracts";

/**
 * True when the browser supports the File System Access save-to-disk API.
 * Always false outside a browser (SSR, Node tests) and false on browsers
 * that only implement the older download-Blob model (Safari, Firefox as of
 * this writing).
 */
export function supportsFileSystemAccessZip(): boolean {
  if (typeof window === "undefined") return false;
  const candidate = (window as unknown as { showSaveFilePicker?: unknown })
    .showSaveFilePicker;
  return typeof candidate === "function";
}

export function totalBytes(items: readonly Pick<OriginalDownload, "bytes">[]): number {
  return items.reduce((sum, item) => sum + item.bytes, 0);
}

/**
 * Whether to show a "this is a lot of data" warning before starting the
 * fallback (Blob-in-memory) ZIP path. Never warns when the File System Access
 * path is available, since that path streams to disk instead of RAM.
 */
export function needsFallbackSizeWarning(
  items: readonly Pick<OriginalDownload, "bytes">[],
  hasFileSystemAccess: boolean = supportsFileSystemAccessZip(),
): boolean {
  if (hasFileSystemAccess) return false;
  return totalBytes(items) > ZIP_FALLBACK_WARNING_BYTES;
}

/**
 * Splits a selection into batches that each stay at/under maxBytesPerBatch,
 * for the bounded-Blob fallback path. Order is preserved; batches are never
 * empty; a single item larger than the cap still gets a solo batch (it
 * cannot be split further -- the size-warning UI is what protects memory in
 * that case, not batching).
 */
export function splitIntoBoundedBatches<T extends Pick<OriginalDownload, "bytes">>(
  items: readonly T[],
  maxBytesPerBatch: number = ZIP_FALLBACK_WARNING_BYTES,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;
  for (const item of items) {
    if (current.length > 0 && currentBytes + item.bytes > maxBytesPerBatch) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += item.bytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
