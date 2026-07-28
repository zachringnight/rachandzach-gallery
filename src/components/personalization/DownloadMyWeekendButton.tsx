"use client";

import { useMemo } from "react";
import { DownloadSelectionButton } from "@/components/downloads/DownloadSelectionButton";
import { SavePhotosButton } from "@/components/downloads/SavePhotosButton";
import { chunkPhotoIdsForDownload, partZipFilename } from "./weekend-download-batches";

export interface DownloadMyWeekendButtonProps {
  personName: string;
  /** Used only to build a clean, filename-safe ZIP name (already validated
   *  as a slug wherever it originates -- localStorage's My Weekend
   *  preference and the people facet list both go through
   *  isValidPersonSlug). */
  personSlug: string;
  photoIds: string[];
  className?: string;
}

/**
 * "Download my weekend" (Round Two Features -- docs/0719_Round_Two_Features_v1.md,
 * "Round-two proper"): one tap on the My Weekend gallery header downloads
 * every photo the guest is tagged in. Reuses DownloadSelectionButton's ZIP
 * flow and SavePhotosButton's share-sheet flow exactly as FavoritesGallery
 * already pairs them (src/components/favorites/FavoritesGallery.tsx) -- no
 * forked download/share logic lives here, and no new API.
 *
 * THE CAP: /api/downloads/selection accepts at most MAX_SELECTION_ITEMS (50)
 * ids per call (src/lib/downloads/contracts.ts), and both
 * DownloadSelectionButton and SavePhotosButton POST every id handed to them
 * to that same endpoint in one request -- so a person tagged in more than 50
 * photos cannot be passed to either as a single 51+ item list without
 * hitting the server's cap. chunkPhotoIdsForDownload
 * (weekend-download-batches.ts, colocated here) splits that person's ids
 * into sequential, clearly-labeled parts ("Download part 1 of 3") up front,
 * and this component renders one DownloadSelectionButton/SavePhotosButton
 * pair per part, each within the cap. No cap bypass: every rendered batch is
 * <= MAX_SELECTION_ITEMS, and nothing merges results across parts.
 *
 * Renders nothing when there is nothing to download: no person's photos
 * loaded yet (My Weekend still fetching) and a person confirmed in zero
 * photos both collapse to an empty photoIds list and the same "render
 * nothing" branch -- mirroring SavePhotosButton's own feature-detection gate
 * (no disabled button, no explainer, just absent) rather than showing a
 * button that would immediately error if tapped.
 */
export function DownloadMyWeekendButton({
  personName,
  personSlug,
  photoIds,
  className,
}: DownloadMyWeekendButtonProps) {
  const batches = useMemo(() => chunkPhotoIdsForDownload(photoIds), [photoIds]);

  if (batches.length === 0) return null;

  const baseFilename = `${personSlug || "guest"}-photos.zip`;
  const multipart = batches.length > 1;

  return (
    <div className={className ?? "flex flex-col gap-2"}>
      {multipart ? (
        <p className="text-xs text-muted">
          {personName} has {photoIds.length} photos, more than one download can
          hold, so the collection comes in {batches.length} parts.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {batches.map((batch, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <DownloadSelectionButton
              photoIds={batch}
              label={
                multipart
                  ? `Download part ${index + 1} of ${batches.length}`
                  : `Download ${personName}'s photos`
              }
              zipFilename={
                multipart ? partZipFilename(baseFilename, index, batches.length) : baseFilename
              }
            />
            <SavePhotosButton
              photoIds={batch}
              label={multipart ? `Save part ${index + 1} of ${batches.length}` : "Save photos"}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
