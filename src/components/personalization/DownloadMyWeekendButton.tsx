"use client";

import { DownloadSelectionButton } from "@/components/downloads/DownloadSelectionButton";
import { SavePhotosButton } from "@/components/downloads/SavePhotosButton";

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
 * ids per request (src/lib/downloads/contracts.ts, enforced server-side in
 * src/lib/downloads/sign-originals.ts). That is a per-request signing bound,
 * not a per-control one: fetchSelectionDownloads
 * (src/components/downloads/fetch-selection.ts) already splits any id list
 * into sequential, bounded POSTs behind a single click, and both child
 * components go through it. So this component hands the person's ENTIRE
 * photoIds list to ONE DownloadSelectionButton and ONE SavePhotosButton --
 * a guest tagged in 180 photos sees two controls, not a wall of eight
 * per-part buttons -- and each child reports the multi-batch work as one
 * operation ("Preparing 2 of 4", "Shared 20 of 180, continue?"). No cap
 * bypass: every POST stays <= MAX_SELECTION_ITEMS.
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
  if (photoIds.length === 0) return null;

  return (
    <div className={className ?? "flex flex-wrap items-center gap-2"}>
      <DownloadSelectionButton
        photoIds={photoIds}
        label={`Download ${personName}'s photos`}
        zipFilename={`${personSlug || "guest"}-photos.zip`}
      />
      <SavePhotosButton photoIds={photoIds} />
    </div>
  );
}
