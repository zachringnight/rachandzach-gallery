"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { favoriteStore } from "@/lib/favorites/store";
import { ensureFavoritesSync } from "@/lib/favorites/sync";

export interface FavoriteButtonProps {
  photoId: string;
  /** Context for the accessible label, e.g. a caption or event name.
   *  Defaults to a generic "this photo". */
  label?: string;
  /** Overrides the default absolutely-positioned overlay styling. Pass this
   *  when dropping the button into a header/toolbar instead of over an
   *  image (e.g. inside Slideshow's controls row). */
  className?: string;
}

const OVERLAY_CLASS =
  "absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-cream/40 bg-ink/50 text-cream backdrop-blur transition hover:bg-ink/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream";

/** Never reads real storage during the first render (server or client) --
 *  getServerSnapshot always returns false, so SSR and the pre-hydration
 *  client render agree, and useSyncExternalStore syncs to the true
 *  device-local value right after mount without a hydration warning. */
function useIsFavorite(photoId: string): boolean {
  return useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) => favoriteStore.subscribe(() => onStoreChange()),
      [],
    ),
    () => favoriteStore.has(photoId),
    () => false,
  );
}

/**
 * Fixed-size overlay control that toggles a photo's device-local favorite
 * state. Absolutely positioned by default so it never shifts the image
 * layout underneath it; pass `className` to reposition when embedding it in
 * a toolbar instead (Slideshow does this).
 */
export function FavoriteButton({ photoId, label, className }: FavoriteButtonProps) {
  const active = useIsFavorite(photoId);
  const subject = label && label.trim().length > 0 ? label : "this photo";

  // Favorites are local-first with background server sync (Favorites v2).
  // Booting the sync loop from the button itself means every surface that
  // shows favorite state -- cards, lightbox, slideshow, favorites page --
  // shares it without each caller having to remember to wire it.
  useEffect(() => {
    ensureFavoritesSync();
  }, []);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      // FavoriteButton is meant to sit on top of a clickable photo card /
      // lightbox surface; never let the toggle also trigger whatever the
      // photo itself does on click.
      event.preventDefault();
      event.stopPropagation();
      favoriteStore.toggle(photoId);
    },
    [photoId],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={active}
      aria-label={active ? `Remove ${subject} from favorites` : `Add ${subject} to favorites`}
      className={className ?? OVERLAY_CLASS}
    >
      <svg
        viewBox="0 0 24 24"
        width={16}
        height={16}
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 21s-6.72-4.35-9.33-8.1C1 10.06 1.6 6.7 4.6 5.2c2.3-1.15 4.9-.3 6.1 1.6l1.3 2 1.3-2c1.2-1.9 3.8-2.75 6.1-1.6 3 1.5 3.6 4.86 1.93 7.7C18.72 16.65 12 21 12 21z" />
      </svg>
    </button>
  );
}
