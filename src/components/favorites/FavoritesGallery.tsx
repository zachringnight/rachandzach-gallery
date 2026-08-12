"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Heart } from "lucide-react";
import type { ClientPhoto } from "@/lib/gallery/client-types";
import { favoriteStore } from "@/lib/favorites/store";
import { ensureFavoritesSync } from "@/lib/favorites/sync";
import { FavoriteButton } from "./FavoriteButton";
import { Slideshow, type SlideshowPhoto } from "@/components/slideshow/Slideshow";
import { DownloadSelectionButton } from "@/components/downloads/DownloadSelectionButton";
import { SavePhotosButton } from "@/components/downloads/SavePhotosButton";
import { AlbumShortlistExport } from "@/components/downloads/AlbumShortlistExport";
import { PhotoImage } from "@/components/gallery/PhotoImage";

/**
 * Mirrors src/lib/gallery/query.ts's MAX_IDS_LOOKUP (100). Not imported
 * directly: that module pulls in query/cursor logic this client bundle does
 * not need, and the value is part of the ids-lookup contract packet 06
 * pinned, not something expected to drift silently.
 */
const GALLERY_IDS_FETCH_CHUNK = 100;

function chunk<T>(items: readonly T[], size: number): T[][] {
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
/* getServerSnapshot has the same referential-stability contract as
 * getSnapshot. Returning a fresh `[]` literal made React warn "The result of
 * getServerSnapshot should be cached to avoid an infinite loop" on every
 * /favorites load. One frozen module-level empty array satisfies Object.is. */
const NO_FAVORITE_IDS: readonly string[] = Object.freeze([]);

function useFavoriteIds(): readonly string[] {
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
    () => NO_FAVORITE_IDS,
  );
}

/**
 * Fetches favorited photos from GET /api/gallery?ids=... (the
 * GalleryQueryInput.ids exact-order batch lookup packet 06 produces),
 * chunked under the 100-id-per-request cap. Order is preserved: the ids
 * lookup returns each id's photo in the order requested, and favorite ids
 * are already in the guest's favorite order.
 */
async function fetchPhotosByIds(ids: readonly string[]): Promise<ClientPhoto[]> {
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

/** How many photographs the empty state offers to start a shortlist with. */
const SUGGESTION_COUNT = 6;
/** Sampled from this many, so the six are not six frames of one moment. */
const SUGGESTION_POOL = 60;

/**
 * A small sample for the empty state.
 *
 * Deliberately NOT a "best of": nothing in the data ranks photographs, and
 * inventing a ranking here would be the site asserting a preference it has
 * no basis for. But the first six in weekend order are six frames of the
 * same table, because the day opens on details -- taking the head of the
 * list produced a strip of six near-identical flower arrangements.
 *
 * So: drop burst followers (the archive already knows which frames are
 * near-duplicates of each other), then take an even spread across a larger
 * window. That is a sampling rule, not a judgement about which photographs
 * are good.
 */
async function fetchSuggestions(): Promise<ClientPhoto[]> {
  const response = await fetch(`/api/gallery?limit=${SUGGESTION_POOL}`);
  if (!response.ok) throw new Error("Could not load suggestions.");
  const body = (await response.json()) as { photos: ClientPhoto[] };
  const pool = body.photos.filter(
    (photo) => !photo.burst || photo.burst.index === 0,
  );
  if (pool.length <= SUGGESTION_COUNT) return pool;
  const stride = pool.length / SUGGESTION_COUNT;
  return Array.from({ length: SUGGESTION_COUNT }, (_, i) =>
    pool[Math.floor(i * stride)],
  );
}

/**
 * The single /favorites page header (P1): headline, live count, and the
 * collection controls on one line. Rendered here rather than in the server
 * page because the count and actions are client-side favorite state.
 */
function FavoritesPageBar({
  count,
  actions,
}: {
  count: number;
  actions?: ReactNode;
}) {
  return (
    <header className="atlas-page-bar">
      <h1>Favorites</h1>
      <p className="atlas-page-bar-count" aria-live="polite">
        <strong>{count.toLocaleString()}</strong>
        {count === 1 ? " photo" : " photos"}
      </p>
      {actions ? <div className="atlas-page-bar-actions">{actions}</div> : null}
    </header>
  );
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

/**
 * The /favorites page body: loads the guest's device-local favorites into
 * full photo records, offers a slideshow, a ZIP of the whole set, and an
 * album-shortlist export -- everything packet 09 owns for the favorites
 * surface (FavoriteStore, downloads, Slideshow) in one place.
 */
export function FavoritesGallery() {
  const favoriteIds = useFavoriteIds();
  const [photos, setPhotos] = useState<ClientPhoto[] | null>(null);
  const [suggestions, setSuggestions] = useState<ClientPhoto[] | null>(null);
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

  /*
   * An empty favorites page used to be a headline and two links on the left
   * half of the screen with the right half blank to the footer, and it asked
   * the guest to go somewhere else to do the one thing the page is about.
   * These few photographs give the heart something to act on in place: the
   * tile carries a real FavoriteButton, so a guest can start their shortlist
   * without leaving. Fetched only when there is nothing to show, so a guest
   * who already has favorites never pays for it.
   */
  useEffect(() => {
    if (hasFavorites) return;
    let cancelled = false;
    fetchSuggestions()
      .then((result) => {
        if (!cancelled) setSuggestions(result);
      })
      // A failed suggestion strip is not an error worth showing: the empty
      // state below still renders its copy and both links.
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [hasFavorites]);

  if (hasFavorites && photos === null && !error) {
    return (
      <div>
        <FavoritesPageBar count={favoriteIds.length} />
        <p className="atlas-personal-state">Loading your favorites…</p>
      </div>
    );
  }

  if (hasFavorites && error) {
    return (
      <div>
        <FavoritesPageBar count={favoriteIds.length} />
        <div role="alert" className="atlas-favorites-error">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const items = hasFavorites ? (photos ?? []) : [];

  if (items.length === 0) {
    return (
      <div>
        <FavoritesPageBar count={0} />
        {/* The second column only exists when there is something to put in
            it. Reserving it unconditionally made the void WORSE on the very
            case that matters -- suggestions still loading, or the fetch
            failed -- by narrowing the copy AND leaving the right half
            blank. */}
        <section
          className="atlas-favorites-empty"
          data-has-strip={
            suggestions && suggestions.length > 0 ? "true" : "false"
          }
        >
          <div className="atlas-favorites-empty-copy">
            <Heart aria-hidden="true" size={40} strokeWidth={1} />
            <p className="atlas-kicker">A collection in the making</p>
            <p>
              Tap the heart on any photo and it lands here. Your shortlist
              stays private and is ready whenever you return.
            </p>
            {/* An empty screen is an invitation to act, so the two ways in are
             * controls rather than the names of pages mentioned in prose. */}
            <div className="atlas-favorites-empty-actions">
              <Link href="/my-weekend" className="atlas-primary-link">
                Find my photos
                <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.5} />
              </Link>
              <Link href="/photos" className="archive-outline-link">
                Browse all photos
                <ArrowUpRight aria-hidden="true" size={15} strokeWidth={1.5} />
              </Link>
            </div>
          </div>

          {suggestions && suggestions.length > 0 ? (
            <div className="atlas-favorites-empty-strip">
              <p className="atlas-kicker">Or start here</p>
              <ul>
                {suggestions.map((photo) => {
                  const label = photo.people
                    .map((person) => person.displayName)
                    .join(", ");
                  return (
                    <li key={photo.id} className="atlas-favorite-tile">
                      <PhotoImage
                        photo={photo}
                        alt={
                          label
                            ? `${label} at ${photo.eventName}`
                            : photo.eventName
                        }
                        tier="card"
                        targetWidth={260}
                        className="h-full w-full"
                        imageClassName="h-full w-full object-cover"
                      />
                      <FavoriteButton
                        photoId={photo.id}
                        label={label || photo.eventName}
                        className="atlas-photo-favorite"
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    );
  }

  const photoIds = items.map((photo) => photo.id);

  return (
    <div className="atlas-favorites-collection">
      <FavoritesPageBar
        count={items.length}
        actions={
          <>
            <button
              type="button"
              onClick={() => setSlideshowIndex(0)}
              className="atlas-inline-action"
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
          </>
        }
      />

      <ul className="atlas-favorites-grid">
        {items.map((photo, index) => {
          const label = photo.people.map((person) => person.displayName).join(", ");
          return (
            <li key={photo.id} className="atlas-favorite-tile">
              <button
                type="button"
                onClick={() => setSlideshowIndex(index)}
                aria-label={
                  label
                    ? `Open photo from ${photo.eventName} with ${label}`
                    : `Open photo from ${photo.eventName}`
                }
                className="atlas-favorite-open"
              >
                <PhotoImage
                  photo={photo}
                  alt={label ? `${label} at ${photo.eventName}` : photo.eventName}
                  tier="card"
                  targetWidth={400}
                  className="h-full w-full"
                  imageClassName="h-full w-full object-cover"
                />
              </button>
              <FavoriteButton
                photoId={photo.id}
                label={label || photo.eventName}
                className="atlas-photo-favorite"
              />
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
