/**
 * Client-side ZIP streaming for a multi-photo selection (packet 09).
 *
 * Runs entirely in the browser: each original is fetched directly from its
 * short-lived Supabase signed URL and streamed into a ZIP. Bytes never
 * transit Vercel. Two write targets are supported:
 *
 *   - File System Access API (`showSaveFilePicker`), when available: the ZIP
 *     streams straight to disk with effectively constant memory, so even a
 *     50-file, multi-gigabyte selection is safe.
 *   - A bounded in-memory Blob fallback otherwise. Because the whole ZIP has
 *     to fit in memory on this path, callers MUST check
 *     needsFallbackSizeWarning()/splitIntoBoundedBatches() first and warn or
 *     split before starting -- see DownloadSelectionButton.
 *
 * The pure helpers below (support detection, size math, batch splitting) have
 * no DOM/network dependency and are unit-tested directly
 * (tests/downloads/selection.test.ts). streamSelectionZip() itself needs a
 * real browser (fetch, Blob, URL.createObjectURL) and is exercised manually /
 * by e2e, not by this packet's unit tests.
 */
import { BlobWriter, HttpReader, ZipWriter } from "@zip.js/zip.js";
import { ZIP_FALLBACK_WARNING_BYTES, type OriginalDownload } from "./contracts";
import { supportsFileSystemAccessZip } from "./zip-planning";

/*
 * The pure planning helpers moved to ./zip-planning so callers can do the
 * batch maths WITHOUT pulling zip.js (~60 KB gzipped) into their bundle.
 * Re-exported here so existing importers and tests keep working unchanged;
 * anything importing them from this module still gets the engine, so the
 * bundle-sensitive call sites import from ./zip-planning directly.
 */
export {
  needsFallbackSizeWarning,
  splitIntoBoundedBatches,
  supportsFileSystemAccessZip,
  totalBytes,
} from "./zip-planning";

// --- Browser streaming (not unit-tested; needs a real browser) --------------

export type ZipStreamPhase =
  | "preparing"
  | "downloading"
  | "entry-complete"
  | "entry-failed"
  | "finalizing"
  | "complete"
  | "cancelled"
  | "failed";

export interface ZipStreamEvent {
  phase: ZipStreamPhase;
  completed: number;
  total: number;
  currentItem?: OriginalDownload;
  message?: string;
}

export interface StreamSelectionZipOptions {
  items: OriginalDownload[];
  zipFilename?: string;
  onProgress?: (event: ZipStreamEvent) => void;
  /** External cancel (e.g. wired to a Cancel button's AbortController). */
  signal?: AbortSignal;
  /** Testability / explicit opt-out of the save-to-disk path. */
  useFileSystemAccess?: boolean;
}

export interface StreamSelectionZipResult {
  succeeded: OriginalDownload[];
  failed: { item: OriginalDownload; message: string }[];
  cancelled: boolean;
  usedFileSystemAccess: boolean;
}

/** Minimal surface this module needs from the picked save target. */
interface SaveFilePicker {
  (options?: {
    suggestedName?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }): Promise<{ createWritable(): Promise<WritableStream> }>;
}

function getSaveFilePicker(): SaveFilePicker | null {
  if (!supportsFileSystemAccessZip()) return null;
  const candidate = (window as unknown as { showSaveFilePicker?: unknown })
    .showSaveFilePicker;
  return typeof candidate === "function" ? (candidate as SaveFilePicker) : null;
}

async function pickSaveTarget(
  zipFilename: string,
): Promise<WritableStream | null> {
  const picker = getSaveFilePicker();
  if (!picker) return null;
  const handle = await picker({
    suggestedName: zipFilename,
    types: [
      { description: "ZIP archive", accept: { "application/zip": [".zip"] } },
    ],
  });
  return handle.createWritable();
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on a delay: Safari/Firefox need a moment to pick up the save.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function writeEntries<T>(
  zipWriter: ZipWriter<T>,
  items: OriginalDownload[],
  signal: AbortSignal | undefined,
  report: (event: Omit<ZipStreamEvent, "completed" | "total">) => void,
): Promise<{
  succeeded: OriginalDownload[];
  failed: { item: OriginalDownload; message: string }[];
  cancelled: boolean;
}> {
  const succeeded: OriginalDownload[] = [];
  const failed: { item: OriginalDownload; message: string }[] = [];

  for (const item of items) {
    if (signal?.aborted) {
      report({ phase: "cancelled", currentItem: item });
      return { succeeded, failed, cancelled: true };
    }
    report({ phase: "downloading", currentItem: item });
    try {
      const reader = new HttpReader(item.signedUrl, {
        fetch: (input, init) => fetch(input, { ...init, signal }),
      });
      await zipWriter.add(item.filename, reader, { signal });
      succeeded.push(item);
      report({ phase: "entry-complete", currentItem: item });
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        report({ phase: "cancelled", currentItem: item });
        return { succeeded, failed, cancelled: true };
      }
      const message = error instanceof Error ? error.message : "Download failed.";
      failed.push({ item, message });
      report({ phase: "entry-failed", currentItem: item, message });
    }
  }

  return { succeeded, failed, cancelled: false };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Streams a ZIP of the given signed originals directly to the guest's
 * device. Never proxies bytes through Vercel. A per-item fetch/compress
 * failure is recorded in `failed` and does not stop the rest of the
 * selection (partial-failure UI: the caller can offer retryFailedItems()).
 */
export async function streamSelectionZip(
  options: StreamSelectionZipOptions,
): Promise<StreamSelectionZipResult> {
  const {
    items,
    zipFilename = "photos.zip",
    onProgress,
    signal,
    useFileSystemAccess = true,
  } = options;

  const total = items.length;
  let completed = 0;
  const report = (event: Omit<ZipStreamEvent, "completed" | "total">) => {
    if (event.phase === "entry-complete") completed += 1;
    onProgress?.({ ...event, completed, total });
  };

  if (total === 0) {
    return { succeeded: [], failed: [], cancelled: false, usedFileSystemAccess: false };
  }

  report({ phase: "preparing" });

  let writable: WritableStream | null = null;
  if (useFileSystemAccess) {
    try {
      writable = await pickSaveTarget(zipFilename);
    } catch (error) {
      if (isAbortError(error)) {
        // The guest cancelled the "Save as" dialog itself.
        return { succeeded: [], failed: [], cancelled: true, usedFileSystemAccess: false };
      }
      // Any other picker failure: fall back to the Blob path below.
      writable = null;
    }
  }

  if (writable) {
    // Type is left unconstrained here (nothing reads close()'s result on
    // this path -- the bytes already landed on disk via the file handle).
    const zipWriter = new ZipWriter(writable, { bufferedWrite: true, signal });
    const outcome = await writeEntries(zipWriter, items, signal, report);
    if (!outcome.cancelled) {
      report({ phase: "finalizing" });
      await zipWriter.close();
      report({ phase: "complete" });
    }
    return { ...outcome, usedFileSystemAccess: true };
  }

  const blobWriter = new BlobWriter("application/zip");
  // Explicitly parameterized: BlobWriter only structurally satisfies the
  // constructor's WritableWriter branch (no generic Type of its own), so
  // without this, close()'s return type would infer as unknown rather than
  // Blob even though BlobWriter.getData() -- and therefore close() -- always
  // resolves to a Blob at runtime.
  const zipWriter = new ZipWriter<Blob>(blobWriter, { bufferedWrite: true, signal });
  const outcome = await writeEntries(zipWriter, items, signal, report);
  if (outcome.cancelled) {
    return { ...outcome, usedFileSystemAccess: false };
  }
  report({ phase: "finalizing" });
  const blob = await zipWriter.close();
  triggerBlobDownload(blob, zipFilename);
  report({ phase: "complete" });
  return { ...outcome, usedFileSystemAccess: false };
}

/**
 * Retries only the items that failed a previous streamSelectionZip() call,
 * producing a small follow-up ZIP so the guest does not have to redo the
 * whole selection.
 */
export async function retryFailedItems(
  failedItems: OriginalDownload[],
  options: Omit<StreamSelectionZipOptions, "items">,
): Promise<StreamSelectionZipResult> {
  return streamSelectionZip({ ...options, items: failedItems });
}
