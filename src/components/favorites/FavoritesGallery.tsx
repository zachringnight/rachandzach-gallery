"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ClientPhoto } from "@/lib/gallery/client-types";
import { favoriteStore } from "@/lib/favorites/store";
import { ensureFavoritesSync } from "@/lib/favorites/sync";
import { FavoriteButton } from "./FavoriteButton";
import { Slideshow, type SlideshowPhoto } from "@/components/slideshow/Slideshow";
import { DownloadSelectionButton } from "@/components/downloads/DownloadSelectionButton";
import { SavePhotosButton } from "@/components/downloads/SavePhotosButton";
import { AlbumShortlistExport } from "@/components/downloads/AlbumShortlistExport";

/**
 * Mirrors src/lib/gallery/query.ts's MAX_IDS_LOOKUP (100). Not imported
 * directly: that module pulls in query/cursor logic this client bundle does
 * not need, and the value is part of the ids-lookup contract packet 06
 * pinned, not something expected to drift silently.
 */
const GALLERY_IDS_FETCH_CHUNK = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * favoriteStore.list() returns a fresh `[...ids]` array on every call, by
 * design (callers own the copy). useSyncExternalStore requires getSnapshot
 * to return a referentially stable value while nothing has changed --
 * without this cache, every call is "different" by reference alone and
 * React throws "Maximum update depth exceeded" on mount. useIsFavorite in
 * FavoriteButton.tsx does not need this: favoriteStore.has() returns a
 * primitive boolean, which Object.is already compares by value.
 */
function useFavoriteIds(): string[] {
  const cache = useRef<{ key: string; ids: string[] }>({ key: "", ids: [] });
  return useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) => favoriteStore.subscribe(() => onStoreChange()),
      [],
    ),
    () => {
      const current = favoriteStore.list();
      const key = current.join(",");
      if (key !== cache.current.key) {
        cache.current = { key, ids: current };
      }
      return cache.current.ids;
    },
    () => [],
  );
}

/**
 * Fetches favorited photos from GET /api/gallery?ids=... (the
 * GalleryQueryInput.ids exact-order batch lookup packet 06 produces),
 * chunked under the 100-id-per-request cap. Order is preserved: the ids
 * lookup returns each id's photo in the order requested, and favorite ids
 * are already in the guest's favorite order.
 */
async function fetchPhotosByIds(ids: string[]): Promise<ClientPhoto[]> {
  const photos: ClientPhoto[] = [];
  for (const group of chunk(ids, GALLERY_IDS_FETCH_CHUNK)) {
    const params = new URLSearchParams();
    for (const id of group) params.append("ids", id);
    const response = await fetch(`/api/gallery?${params.toString()}`);
    if (!response.ok) {
      throw new Error("Could not load your favorites.");
    }
    const body = (await response.json()) as { photos: ClientPhoto[] };
    photos.push(...body.photos);
  }
  return photos;
}

function toSlideshowPhoto(photo: ClientPhoto): SlideshowPhoto {
  return {
    id: photo.id,
    eventSlug: photo.eventSlug,
    eventName: photo.eventName,
    source: photo.source,
    orientation: photo.orientation,
    width: photo.width,
    height: photo.height,
    aspectRatio: photo.aspectRatio,
    capturedAt: photo.capturedAt,
    people: photo.people,
    previews: photo.previews,
  };
}

function bestTileUrl(photo: ClientPhoto, targetWidth: number): string | null {
  if (photo.previews.length === 0) return null;
  const sorted = [...photo.previews].sort((a, b) => a.width - b.width);
  const fit = sorted.find((preview) => preview.width >= targetWidth);
  return (fit ?? sorted[sorted.length - 1]).url;
}

/**
 * The /favorites page body: loads the guest's device-local favorites into
 * full photo records, offers a slideshow, a ZIP of the whole set, and an
 * album-shortlist export -- everything packet 09 owns for the favorites
 * surface (FavoriteStore, downloads, Slideshow) in one place.
 */
export function FavoritesGallery() {
  const favoriteIds = useFavoriteIds();
  const [photos, setPhotos] = useState<ClientPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slideshowIndex, setSlideshowIndex] = useState<number | null>(null);
  const hasFavorites = favoriteIds.length > 0;
  // favoriteIds is a fresh array on every store change; comparing by content
  // (join) avoids treating an identical list as a change.
  const favoriteIdsKey = favoriteIds.join(",");

  // A new (or newly-empty) favorites list makes any error left over from the
  // previous one stale. Cleared during render -- adjusting state when a
  // dependency changes, the React docs' pattern for this -- rather than as
  // the first thing the effect below does, so the effect body only ever
  // calls setState from inside the async fetch callbacks.
  const [prevFavoriteIdsKey, setPrevFavoriteIdsKey] = useState(favoriteIdsKey);
  if (favoriteIdsKey !== prevFavoriteIdsKey) {
    setPrevFavoriteIdsKey(favoriteIdsKey);
    setError(null);
  }

  // Boot the server sync even when this device has zero local favorites --
  // that is exactly the case (new device, cleared browser) where the server
  // copy has hearts this page should show. FavoriteButton boots it too, but
  // an empty favorites page renders no FavoriteButton.
  useEffect(() => {
    ensureFavoritesSync();
  }, []);

  useEffect(() => {
    if (!hasFavorites) {
      // Nothing to fetch. The empty state below is derived straight from
      // favoriteIds during render instead of resetting photos/error here.
      return;
    }
    let cancelled = false;
    fetchPhotosByIds(favoriteIds)
      .then((result) => {
        if (!cancelled) setPhotos(result);
      })
      .catch(() => {
        if (!cancelled) {
          setError("We could not load your favorites. Try again in a moment.");
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFavorites, favoriteIdsKey]);

  if (hasFavorites && photos === null && !error) {
    return <p className="mt-8 text-sm text-muted">Loading your favorites…</p>;
  }

  if (hasFavorites && error) {
    return (
      <div role="alert" className="mt-8 rounded-md border border-coral/40 bg-white p-6 text-sm">
        <p className="text-ink">{error}</p>
      </div>
    );
  }

  const items = hasFavorites ? (photos ?? []) : [];

  if (items.length === 0) {
    return (
      <p className="mt-8 text-sm text-muted">
        You have not favorited any photos yet. Play a slideshow from My Weekend and tap the
        heart on the ones you love.
      </p>
    );
  }

  const photoIds = items.map((photo) => photo.id);

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setSlideshowIndex(0)}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-cream transition hover:bg-ink/90"
        >
          Play slideshow
        </button>
        <DownloadSelectionButton photoIds={photoIds} label="Download all favorites" />
        <SavePhotosButton photoIds={photoIds} />
        <AlbumShortlistExport
          photos={items.map((photo) => ({
            id: photo.id,
            eventName: photo.eventName,
            people: photo.people.map((person) => person.displayName),
          }))}
          filenamePrefix="favorites-shortlist"
        />
      </div>

      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((photo, index) => {
          const label = photo.people.map((person) => person.displayName).join(", ");
          const src = bestTileUrl(photo, 400);
          return (
            <li key={photo.id} className="relative">
              <button
                type="button"
                onClick={() => setSlideshowIndex(index)}
                aria-label={
                  label
                    ? `Open photo from ${photo.eventName} with ${label}`
                    : `Open photo from ${photo.eventName}`
                }
                className="group block aspect-square w-full overflow-hidden rounded-sm bg-wheat/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                {src ? (
                  <img
                    src={src}
                    alt={label ? `${label} at ${photo.eventName}` : photo.eventName}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-xs text-muted">
                    Preview unavailable
                  </span>
                )}
              </button>
              <FavoriteButton photoId={photo.id} label={label || photo.eventName} />
            </li>
          );
        })}
      </ul>

      {slideshowIndex !== null ? (
        <Slideshow
          photos={items.map(toSlideshowPhoto)}
          modeLabel="Favorites"
          startIndex={slideshowIndex}
          onClose={() => setSlideshowIndex(null)}
        />
      ) : null}
    </div>
  );
}
