"use client";

import type { ClientPhoto } from "@/lib/gallery/client-types";

export interface RelatedPhotosProps {
  photos: ClientPhoto[];
  onOpen: (photoId: string) => void;
}

function thumbUrl(photo: ClientPhoto): string | null {
  if (photo.previews.length === 0) return null;
  return [...photo.previews].sort((a, b) => a.width - b.width)[0].url;
}

/** A quiet strip of related photos shown under a lightbox / detail view. */
export function RelatedPhotos({ photos, onOpen }: RelatedPhotosProps) {
  if (photos.length === 0) return null;
  return (
    <section aria-label="Related photos" className="pt-3">
      <h3 className="mb-2 text-xs uppercase tracking-wider text-cream/60">
        More like this
      </h3>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {photos.map((photo) => {
          const src = thumbUrl(photo);
          return (
            <button
              key={photo.id}
              type="button"
              onClick={() => onOpen(photo.id)}
              className="h-20 w-20 shrink-0 overflow-hidden rounded-sm border border-cream/20 bg-cream/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
              aria-label={`Open related photo from ${photo.eventName}`}
            >
              {src ? (
                <img
                  src={src}
                  alt={photo.eventName}
                  width={photo.width}
                  height={photo.height}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
