"use client";

/**
 * Recently Added (packet 11, launch). A separate guest-upload rail, home
 * page candidate, capped at RECENTLY_APPROVED_RAIL_LIMIT.
 *
 * Presentational only: the caller queries getRecentlyApproved (approved
 * guest photos, source: "guest", already status-isolated by getGalleryPage)
 * and signs/serializes it to ClientPhoto[] the same way every other gallery
 * read does, then hands the result here. Renders nothing -- no placeholder
 * card -- when there is nothing to show yet.
 *
 * Contributor credit: ClientPhoto carries `source` ("photographer" |
 * "guest") but not the uploading batch's display name -- task 06's gallery
 * query layer never joins upload_batches, so no per-photo uploader NAME is
 * available here today. This renders a generic "Shared by a guest" credit
 * from `source` rather than inventing or guessing an identity; see this
 * packet's report for what task 06 would need to expose to name the
 * contributor.
 */
import { RECENTLY_APPROVED_RAIL_LIMIT } from "@/lib/modules/contracts";
import type { ClientPhoto } from "@/lib/gallery/client-types";

export interface RecentlyApprovedProps {
  photos: ClientPhoto[];
  onOpen?: (photoId: string) => void;
}

function smallestPreviewUrl(photo: ClientPhoto): string | null {
  if (photo.previews.length === 0) return null;
  return [...photo.previews].sort((a, b) => a.width - b.width)[0].url;
}

export function RecentlyApproved({ photos, onOpen }: RecentlyApprovedProps) {
  const rail = photos.slice(0, RECENTLY_APPROVED_RAIL_LIMIT);
  if (rail.length === 0) return null;

  return (
    <section aria-labelledby="recently-added-title">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="recently-added-title" className="font-display text-2xl text-ink">
          Recently added by guests
        </h2>
        <p className="font-body text-xs uppercase tracking-wide text-muted">
          Shared by a guest
        </p>
      </div>
      <ul className="mt-4 flex gap-3 overflow-x-auto pb-2">
        {rail.map((photo) => {
          const src = smallestPreviewUrl(photo);
          const label = photo.people.map((p) => p.displayName).join(", ");
          return (
            <li key={photo.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onOpen?.(photo.id)}
                className="block h-28 w-28 overflow-hidden rounded-sm bg-wheat/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                aria-label={
                  label
                    ? `Open photo from ${photo.eventName} with ${label}`
                    : `Open photo from ${photo.eventName}`
                }
              >
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived private-storage URL.
                  <img
                    src={src}
                    alt={label ? `${label} at ${photo.eventName}` : photo.eventName}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-xs text-muted">
                    Preview unavailable
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
