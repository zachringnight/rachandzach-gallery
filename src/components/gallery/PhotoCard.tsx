"use client";

import { useState } from "react";
import type { ClientPhoto } from "@/lib/gallery/client-types";
import { FavoriteButton } from "@/components/favorites/FavoriteButton";

export interface PhotoCardProps {
  photo: ClientPhoto;
  /** Rendered pixel size from the justified layout (avoids layout shift). */
  width: number;
  height: number;
  onOpen: (photoId: string) => void;
}

function bestPreviewUrl(photo: ClientPhoto, targetWidth: number): string | null {
  if (photo.previews.length === 0) return null;
  // Smallest preview at least as wide as the box; fall back to the largest.
  const sorted = [...photo.previews].sort((a, b) => a.width - b.width);
  const fit = sorted.find((p) => p.width >= targetWidth);
  return (fit ?? sorted[sorted.length - 1]).url;
}

function names(photo: ClientPhoto): string {
  return photo.people.map((p) => p.displayName).join(", ");
}

/**
 * One photo in the justified grid. The box dimensions are fixed by the layout
 * math, so the reserved space never shifts once the image decodes.
 *
 * Structure: a fixed-size relative wrapper holds the open-photo button and,
 * as a sibling (buttons must not nest), the absolutely-positioned
 * FavoriteButton overlay -- the same card pattern FavoritesGallery uses. The
 * overlay is positioned out of flow, so favoriting never shifts the image
 * layout (packet 09 contract).
 */
export function PhotoCard({ photo, width, height, onOpen }: PhotoCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = bestPreviewUrl(photo, width);
  const label = names(photo);

  return (
    <div className="group relative" style={{ width, height }}>
      <button
        type="button"
        onClick={() => onOpen(photo.id)}
        className="block h-full w-full overflow-hidden rounded-sm bg-wheat/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        aria-label={
          label
            ? `Open photo from ${photo.eventName} with ${label}`
            : `Open photo from ${photo.eventName}`
        }
      >
        {src && !failed ? (
          <img
            src={src}
            alt={label ? `${label} at ${photo.eventName}` : photo.eventName}
            width={photo.width}
            height={photo.height}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`h-full w-full object-cover transition-opacity duration-300 ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
            style={{ width, height }}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-tan/50 text-xs text-muted">
            {failed ? "Preview unavailable" : ""}
          </span>
        )}

        {label ? (
          <span className="pointer-events-none absolute inset-x-1 bottom-1 truncate rounded-sm bg-ink/70 px-2 py-1 text-xs font-medium text-cream opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
            {label}
          </span>
        ) : null}
      </button>

      <FavoriteButton photoId={photo.id} label={label || photo.eventName} />
    </div>
  );
}
