"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { OriginalDownload } from "@/lib/downloads/contracts";
import { canShareFiles, chunkForShare, isAbortError } from "./share-sheet";
import {
  fetchSelectionDownloads,
  SelectionPreparationError,
} from "./fetch-selection";

export interface SavePhotosButtonProps {
  photoIds: string[];
  /** Visible label on the button. Defaults to "Save photos". */
  label?: string;
  /** Applied to the outer wrapper. The button and status text keep their
   *  own fixed styling (see WRAPPER_CLASS/BUTTON_CLASS/GHOST_BUTTON_CLASS
   *  below) since, unlike DownloadSelectionButton, this component never
   *  swaps its top-level element for a different one between phases. */
  className?: string;
}

type Status =
  | { phase: "idle" }
  | { phase: "requesting" }
  | {
      phase: "fetching";
      chunkIndex: number;
      chunkCount: number;
      completed: number;
      total: number;
      currentLabel: string | null;
    }
  | { phase: "sharing"; chunkIndex: number; chunkCount: number }
  | { phase: "continue"; sharedCount: number; totalCount: number; nextChunkIndex: number }
  | { phase: "done"; sharedCount: number }
  | { phase: "cancelled"; sharedCount: number }
  | { phase: "error"; message: string };

const WRAPPER_CLASS = "inline-flex flex-col items-start gap-2";
const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-ink/20 bg-transparent px-3 py-1.5 text-sm text-ink transition hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BUTTON_CLASS =
  "inline-flex items-center gap-2 rounded-md border border-ink/20 bg-ink px-4 py-2 text-sm font-medium text-cream transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50";

/** No external "change" event to subscribe to -- share support does not
 *  flip mid-session -- but getServerSnapshot still needs to disagree from
 *  getSnapshot for a correct SSR-safe default. Mirrors usePrefersReducedMotion
 *  in Slideshow.tsx and useIsFavorite in FavoriteButton.tsx: getServerSnapshot
 *  always returns false, so SSR and the pre-hydration client render agree,
 *  and the real value is read right after mount with no hydration warning
 *  and no setState-in-effect. */
function useCanShareFiles(): boolean {
  return useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => canShareFiles(),
    () => false,
  );
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/**
 * "Save photos": sits beside DownloadSelectionButton's ZIP download and
 * uses the exact same authorized flow (POST /api/downloads/selection) to
 * get signed originals, then downloads each blob client-side and hands the
 * results to navigator.share({ files }) so iOS's native sheet offers Save
 * Images (iCloud Photos) / Save to Files (iCloud Drive) in one tap. The
 * Google Drive / Dropbox OAuth buttons from the same round-two doc are a
 * separate slice waiting on client IDs; this component never renders them.
 *
 * Feature-detected via canShareFiles() (navigator.canShare AND a files
 * probe both pass), not just canShare's existence -- some browsers
 * implement canShare()/share() for text/url only. Renders nothing at all
 * when unsupported: no disabled button, no explainer. The ZIP button stays
 * the universal fallback.
 *
 * A selection over SHARE_CHUNK_MAX_FILES/SHARE_CHUNK_MAX_BYTES is shared in
 * sequential chunks (share-sheet.ts's chunkForShare) with a small "Shared X
 * of Y, continue?" prompt between them, since one giant share of up to 50
 * originals is unreliable across devices. The guest closing the native
 * share sheet rejects navigator.share() with an AbortError; that stops the
 * remaining chunks gracefully (a "cancelled" status, not an error).
 */
export function SavePhotosButton({ photoIds, label = "Save photos", className }: SavePhotosButtonProps) {
  const supported = useCanShareFiles();
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const chunksRef = useRef<OriginalDownload[][]>([]);
  const sharedCountRef = useRef(0);
  const totalCountRef = useRef(0);

  const runChunk = useCallback(async (chunkIndex: number) => {
    const chunks = chunksRef.current;
    const chunk = chunks[chunkIndex];
    if (!chunk) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setStatus({
      phase: "fetching",
      chunkIndex: chunkIndex + 1,
      chunkCount: chunks.length,
      completed: 0,
      total: chunk.length,
      currentLabel: null,
    });

    const files: File[] = [];
    for (let i = 0; i < chunk.length; i += 1) {
      if (controller.signal.aborted) {
        abortRef.current = null;
        setStatus({ phase: "cancelled", sharedCount: sharedCountRef.current });
        return;
      }
      const item = chunk[i];
      try {
        const response = await fetch(item.signedUrl, { signal: controller.signal });
        if (!response.ok) throw new Error("Download failed.");
        const blob = await response.blob();
        // The share sheet only needs a photo-shaped MIME type to offer Save
        // Images; the feature is pinned to image/jpeg regardless of each
        // source's real content-type (a guest HEIC original's actual bytes
        // are still exactly what gets shared -- only the File's declared
        // `type` here is normalized).
        files.push(new File([blob], item.filename, { type: "image/jpeg" }));
      } catch (error) {
        abortRef.current = null;
        if (isAbortError(error)) {
          setStatus({ phase: "cancelled", sharedCount: sharedCountRef.current });
          return;
        }
        setStatus({
          phase: "error",
          message: `Could not get ${item.filename} ready. Check your connection and try again.`,
        });
        return;
      }
      setStatus((current) =>
        current.phase === "fetching"
          ? { ...current, completed: i + 1, currentLabel: item.filename }
          : current,
      );
    }
    abortRef.current = null;

    setStatus({ phase: "sharing", chunkIndex: chunkIndex + 1, chunkCount: chunks.length });
    try {
      await navigator.share({ files });
    } catch (error) {
      if (isAbortError(error)) {
        setStatus({ phase: "cancelled", sharedCount: sharedCountRef.current });
        return;
      }
      setStatus({ phase: "error", message: "Could not open the share sheet. Try again." });
      return;
    }

    sharedCountRef.current += chunk.length;

    if (chunkIndex + 1 < chunks.length) {
      setStatus({
        phase: "continue",
        sharedCount: sharedCountRef.current,
        totalCount: totalCountRef.current,
        nextChunkIndex: chunkIndex + 1,
      });
    } else {
      setStatus({ phase: "done", sharedCount: sharedCountRef.current });
    }
  }, []);

  const handleStart = useCallback(async () => {
    if (photoIds.length === 0) return;
    setStatus({ phase: "requesting" });
    try {
      // Same authorized flow DownloadSelectionButton uses -- bounded calls
      // are combined client-side when the UI selection is larger than 50.
      const selection = await fetchSelectionDownloads(
        photoIds,
        "Could not get your photos ready to save.",
      );
      if (selection.items.length === 0) {
        setStatus({ phase: "error", message: "Nothing here is available to save yet." });
        return;
      }
      chunksRef.current = chunkForShare(selection.items);
      sharedCountRef.current = 0;
      totalCountRef.current = selection.items.length;
      await runChunk(0);
    } catch (error) {
      setStatus({
        phase: "error",
        message:
          error instanceof SelectionPreparationError
            ? error.message
            : "Could not get your photos ready to save. Check your connection and try again.",
      });
    }
  }, [photoIds, runChunk]);

  const handleContinue = useCallback(() => {
    if (status.phase !== "continue") return;
    void runChunk(status.nextChunkIndex);
  }, [status, runChunk]);

  const handleStop = useCallback(() => {
    if (status.phase !== "continue") return;
    setStatus({ phase: "done", sharedCount: status.sharedCount });
  }, [status]);

  const handleCancelFetch = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Feature-detection gate: no disabled button, no explainer, just nothing.
  if (!supported) return null;

  const busy = status.phase === "requesting" || status.phase === "fetching" || status.phase === "sharing";
  const disabled = photoIds.length === 0 || busy || status.phase === "continue";

  let statusText: string | null = null;
  if (status.phase === "requesting") {
    statusText = "Getting your photos ready...";
  } else if (status.phase === "fetching") {
    statusText = `Getting ${status.completed} of ${status.total} ready${
      status.currentLabel ? ` (${status.currentLabel})` : ""
    }...`;
  } else if (status.phase === "sharing") {
    statusText = "Opening your share sheet...";
  } else if (status.phase === "continue") {
    statusText = `Shared ${status.sharedCount} of ${status.totalCount}, continue?`;
  } else if (status.phase === "done") {
    statusText = `${status.sharedCount} ${pluralize(status.sharedCount, "photo", "photos")} shared.`;
  } else if (status.phase === "cancelled") {
    statusText =
      status.sharedCount > 0
        ? `Save cancelled. ${status.sharedCount} ${pluralize(status.sharedCount, "photo", "photos")} already shared.`
        : "Save cancelled.";
  }

  return (
    <div className={className ?? WRAPPER_CLASS}>
      <button
        type="button"
        className={BUTTON_CLASS}
        aria-busy={busy}
        disabled={disabled}
        onClick={() => void handleStart()}
      >
        {label}
      </button>

      {status.phase === "error" ? (
        <div role="alert" className="rounded-md border border-coral/40 bg-white p-3 text-sm">
          <p className="text-ink">{status.message}</p>
        </div>
      ) : statusText ? (
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {statusText}
        </p>
      ) : null}

      {status.phase === "fetching" ? (
        <button type="button" className={BUTTON_CLASS} onClick={handleCancelFetch}>
          Cancel
        </button>
      ) : null}

      {status.phase === "continue" ? (
        <div className="flex gap-2">
          <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={handleContinue}>
            Continue
          </button>
          <button type="button" className={BUTTON_CLASS} onClick={handleStop}>
            Stop for now
          </button>
        </div>
      ) : null}
    </div>
  );
}
