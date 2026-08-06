"use client";

import { useCallback, useRef, useState } from "react";
import type { OriginalDownload } from "@/lib/downloads/contracts";
/*
 * Planning helpers come from the LIGHT module; the zip engine itself is
 * imported inside the click handler below. Importing streamSelectionZip here
 * would pull @zip.js/zip.js (~60 KB gzipped) into the first paint of every
 * route that renders a download button -- /photos, /my-weekend, /favorites,
 * and every person page -- for code that cannot run until a guest selects
 * photos and clicks. `type ZipStreamEvent` is erased at compile time and
 * costs nothing.
 */
import {
  needsFallbackSizeWarning,
  splitIntoBoundedBatches,
  supportsFileSystemAccessZip,
} from "@/lib/downloads/zip-planning";
import type { ZipStreamEvent } from "@/lib/downloads/stream-zip";
import {
  fetchSelectionDownloads,
  SelectionPreparationError,
} from "@/components/downloads/fetch-selection";

export interface DownloadSelectionButtonProps {
  photoIds: string[];
  /** Visible label on the idle button. Defaults to "Download all". */
  label?: string;
  zipFilename?: string;
  className?: string;
}

type Status =
  | { phase: "idle" }
  /** batchIndex/batchCount track fetchSelectionDownloads's sequential signing
   *  POSTs (one per MAX_SELECTION_ITEMS ids), so a large selection reads as
   *  one operation ("Preparing 2 of 4...") instead of a silent stall. Both
   *  are 0 until the first batch starts. */
  | { phase: "requesting"; batchIndex: number; batchCount: number }
  | { phase: "confirming"; items: OriginalDownload[]; estimatedBytes: number }
  | {
      phase: "streaming";
      batchIndex: number;
      batchCount: number;
      completed: number;
      total: number;
      currentLabel: string | null;
    }
  | { phase: "done"; succeeded: number; failed: { item: OriginalDownload; message: string }[] }
  | { phase: "cancelled" }
  | { phase: "error"; message: string };

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function batchZipFilename(base: string, batchIndex: number, batchCount: number): string {
  if (batchCount <= 1) return base;
  const dot = base.toLowerCase().endsWith(".zip") ? base.length - 4 : base.length;
  return `${base.slice(0, dot)}-${batchIndex + 1}-of-${batchCount}${base.slice(dot)}`;
}

const BUTTON_CLASS =
  "inline-flex items-center gap-2 rounded-md border border-ink/20 bg-ink px-4 py-2 text-sm font-medium text-cream transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50";
const GHOST_BUTTON_CLASS =
  "inline-flex items-center gap-2 rounded-md border border-ink/20 bg-transparent px-3 py-1.5 text-sm text-ink transition hover:bg-ink/5";

/**
 * Fetches signed originals for a selection and streams a ZIP straight to the
 * guest's device (see src/lib/downloads/stream-zip.ts) -- never through
 * Vercel. Callers pass ALL selected ids in one list, however many: the
 * server's MAX_SELECTION_ITEMS (50) cap is a per-request signing bound, and
 * fetchSelectionDownloads already sequences one bounded POST per 50 ids
 * behind this single control, surfacing "Preparing 2 of 4" style progress on
 * the button while it does. On a browser without the File System Access API,
 * once the estimated total exceeds the fallback cap the guest is warned, and
 * confirming splits the selection into multiple bounded, sequential ZIPs
 * (splitIntoBoundedBatches) rather than allocating one giant in-memory Blob.
 * Offers a retry for any items that failed mid-stream, and a cancel button
 * that aborts the batch currently in flight.
 */
export function DownloadSelectionButton({
  photoIds,
  label = "Download all",
  zipFilename = "photos.zip",
  className,
}: DownloadSelectionButtonProps) {
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const runBatches = useCallback(
    async (batches: OriginalDownload[][]) => {
      const controller = new AbortController();
      abortRef.current = controller;

      let succeededTotal = 0;
      const failedTotal: { item: OriginalDownload; message: string }[] = [];

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex];
        setStatus({
          phase: "streaming",
          batchIndex: batchIndex + 1,
          batchCount: batches.length,
          completed: 0,
          total: batch.length,
          currentLabel: null,
        });

        const onProgress = (event: ZipStreamEvent) => {
          setStatus((current) =>
            current.phase === "streaming"
              ? {
                  ...current,
                  completed: event.completed,
                  total: event.total,
                  currentLabel: event.currentItem?.filename ?? current.currentLabel,
                }
              : current,
          );
        };

        // Loaded on demand, so the zip engine is fetched the first time a
        // guest actually downloads rather than on every gallery page view.
        // Subsequent batches hit the module cache, so this costs one network
        // round trip at most, overlapped with a download the guest just asked
        // for and already expects to take a moment.
        const { streamSelectionZip } = await import("@/lib/downloads/stream-zip");

        const result = await streamSelectionZip({
          items: batch,
          zipFilename: batchZipFilename(zipFilename, batchIndex, batches.length),
          signal: controller.signal,
          onProgress,
        });

        if (result.cancelled) {
          abortRef.current = null;
          setStatus({ phase: "cancelled" });
          return;
        }
        succeededTotal += result.succeeded.length;
        failedTotal.push(...result.failed);
      }

      abortRef.current = null;
      setStatus({ phase: "done", succeeded: succeededTotal, failed: failedTotal });
    },
    [zipFilename],
  );

  const handleStart = useCallback(async () => {
    if (photoIds.length === 0) return;
    setStatus({ phase: "requesting", batchIndex: 0, batchCount: 0 });
    try {
      const selection = await fetchSelectionDownloads(
        photoIds,
        "Could not prepare the download.",
        {
          onBatchStart: (batchIndex, batchCount) =>
            setStatus({ phase: "requesting", batchIndex, batchCount }),
        },
      );
      if (selection.items.length === 0) {
        setStatus({ phase: "error", message: "Nothing here is available to download yet." });
        return;
      }

      const hasFsAccess = supportsFileSystemAccessZip();
      if (needsFallbackSizeWarning(selection.items, hasFsAccess)) {
        setStatus({
          phase: "confirming",
          items: selection.items,
          estimatedBytes: selection.estimatedBytes,
        });
        return;
      }
      await runBatches([selection.items]);
    } catch (error) {
      setStatus({
        phase: "error",
        message:
          error instanceof SelectionPreparationError
            ? error.message
            : "Could not prepare the download. Check your connection and try again.",
      });
    }
  }, [photoIds, runBatches]);

  const handleConfirm = useCallback(
    (items: OriginalDownload[]) => {
      // Re-check support at click time rather than trusting a stale
      // capability snapshot: split into bounded batches on the fallback
      // (in-memory Blob) path, one ZIP per batch, instead of one giant Blob.
      const batches = supportsFileSystemAccessZip() ? [items] : splitIntoBoundedBatches(items);
      void runBatches(batches);
    },
    [runBatches],
  );

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleRetry = useCallback(async () => {
    if (status.phase !== "done" || status.failed.length === 0) return;
    await runBatches([status.failed.map((entry) => entry.item)]);
  }, [status, runBatches]);

  if (status.phase === "confirming") {
    return (
      <div className={className ?? "rounded-md border border-ink/20 bg-cream p-4 text-sm text-ink"}>
        <p>
          This selection is about {formatBytes(status.estimatedBytes)} and your browser can only
          build the ZIP in memory. It will download as multiple ZIP files so no single download
          uses too much memory at once.
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" className={BUTTON_CLASS} onClick={() => handleConfirm(status.items)}>
            Download anyway
          </button>
          <button
            type="button"
            className={GHOST_BUTTON_CLASS}
            onClick={() => setStatus({ phase: "idle" })}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (status.phase === "streaming") {
    const pct = status.total > 0 ? Math.round((status.completed / status.total) * 100) : 0;
    return (
      <div className={className ?? "rounded-md border border-ink/20 bg-cream p-4 text-sm text-ink"}>
        <p>
          {status.batchCount > 1 ? `Batch ${status.batchIndex} of ${status.batchCount}: ` : ""}
          Downloading {status.completed} of {status.total}
          {status.currentLabel ? ` (${status.currentLabel})` : ""}...
        </p>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink/10"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-coral transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <button type="button" className={`${GHOST_BUTTON_CLASS} mt-3`} onClick={handleCancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (status.phase === "done") {
    return (
      <div className={className ?? "rounded-md border border-ink/20 bg-cream p-4 text-sm text-ink"}>
        <p>
          {status.succeeded} photo{status.succeeded === 1 ? "" : "s"} downloaded
          {status.failed.length > 0 ? `, ${status.failed.length} failed.` : "."}
        </p>
        {status.failed.length > 0 ? (
          <button type="button" className={`${GHOST_BUTTON_CLASS} mt-2`} onClick={() => void handleRetry()}>
            Retry {status.failed.length} failed photo{status.failed.length === 1 ? "" : "s"}
          </button>
        ) : null}
        <button
          type="button"
          className={`${GHOST_BUTTON_CLASS} mt-2 ml-2`}
          onClick={() => setStatus({ phase: "idle" })}
        >
          Done
        </button>
      </div>
    );
  }

  if (status.phase === "cancelled") {
    return (
      <div className={className}>
        <p className="text-sm text-ink/70">Download cancelled.</p>
        <button type="button" className={`${GHOST_BUTTON_CLASS} mt-2`} onClick={() => setStatus({ phase: "idle" })}>
          Try again
        </button>
      </div>
    );
  }

  if (status.phase === "error") {
    return (
      <div
        role="alert"
        className={className ?? "rounded-md border border-coral/40 bg-white p-4 text-sm"}
      >
        <p className="text-ink">{status.message}</p>
        <button type="button" className={`${GHOST_BUTTON_CLASS} mt-2`} onClick={() => setStatus({ phase: "idle" })}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={className ?? BUTTON_CLASS}
      onClick={() => void handleStart()}
      disabled={photoIds.length === 0 || status.phase === "requesting"}
    >
      {status.phase === "requesting"
        ? status.batchCount > 1
          ? `Preparing ${status.batchIndex} of ${status.batchCount}...`
          : "Preparing..."
        : label}
      {photoIds.length > 0 ? ` (${photoIds.length})` : ""}
    </button>
  );
}
