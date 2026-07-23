"use client";

/**
 * Shuffle the Weekend (packet 11, launch). One action opens a varied
 * approved photo and can continue as a serendipitous slideshow.
 *
 * Intentionally generic like src/components/slideshow/Slideshow.tsx: this
 * component receives an already-fetched, already-signed candidate pool
 * (`photos: ClientPhoto[]`) rather than fetching anything itself. A future
 * integration point (dropping this into the home or photos page) is
 * responsible for querying the approved catalog and handing it down here,
 * the same way FavoritesGallery hands its list to Slideshow.
 */
import { useMemo, useState } from "react";
import type { ClientPhoto } from "@/lib/gallery/client-types";
import { Slideshow } from "@/components/slideshow/Slideshow";
import {
  buildShuffleSequence,
  pickShufflePhoto,
  type ShuffleCandidate,
} from "@/lib/modules/contracts";

export interface ShuffleWeekendProps {
  /** The full candidate pool this session may shuffle across. */
  photos: ClientPhoto[];
}

function toCandidates(photos: ClientPhoto[]): ShuffleCandidate[] {
  return photos.map((photo) => ({ id: photo.id, eventSlug: photo.eventSlug }));
}

function bestPreviewUrl(photo: ClientPhoto): string | null {
  if (photo.previews.length === 0) return null;
  return [...photo.previews].sort((a, b) => b.width - a.width)[0].url;
}

export function ShuffleWeekend({ photos }: ShuffleWeekendProps) {
  const candidates = useMemo(() => toCandidates(photos), [photos]);
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p] as const)), [photos]);
  const [history, setHistory] = useState<string[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  function shuffle() {
    const pick = pickShufflePhoto(candidates, history);
    if (!pick) return;
    setHistory(pick.nextHistory);
    setCurrentId(pick.photoId);
  }

  if (photos.length === 0) {
    return (
      <p className="font-body text-sm text-muted">
        Nothing to shuffle yet. Check back once the gallery fills in.
      </p>
    );
  }

  const current = currentId ? (byId.get(currentId) ?? null) : null;
  const currentSrc = current ? bestPreviewUrl(current) : null;
  const currentLabel = current
    ? current.people.map((p) => p.displayName).join(", ") || current.eventName
    : "";

  const slideshowOrder = playing
    ? buildShuffleSequence(candidates, currentId)
    : [];
  const slideshowPhotos = slideshowOrder
    .map((id) => byId.get(id))
    .filter((p): p is ClientPhoto => Boolean(p));

  return (
    <div className="flex flex-col items-start gap-4">
      <button
        type="button"
        onClick={shuffle}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-7 font-body text-sm font-medium text-cream hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
      >
        {current ? "Shuffle again" : "Shuffle the weekend"}
      </button>

      {current ? (
        <figure className="w-full max-w-sm overflow-hidden rounded-card border border-wheat bg-white shadow-soft">
          {currentSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived private-storage URL.
            <img
              src={currentSrc}
              alt={currentLabel ? `${currentLabel}` : current.eventName}
              className="aspect-[4/3] w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[4/3] w-full items-center justify-center bg-wheat/40 text-sm text-muted">
              Preview unavailable
            </div>
          )}
          <figcaption className="flex items-center justify-between gap-3 p-4">
            <span className="font-body text-sm text-ink">{current.eventName}</span>
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="font-body text-sm font-medium text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
            >
              Continue as a slideshow
            </button>
          </figcaption>
        </figure>
      ) : null}

      {playing && slideshowPhotos.length > 0 ? (
        <Slideshow
          photos={slideshowPhotos}
          modeLabel="Shuffle the weekend"
          startIndex={0}
          onClose={() => setPlaying(false)}
        />
      ) : null}
    </div>
  );
}
