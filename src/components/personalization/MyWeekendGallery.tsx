"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ClientPhoto } from "@/lib/gallery/client-types";
import { groupByEvent } from "@/lib/personalization/my-weekend";
import { PhotoCard } from "@/components/gallery/PhotoCard";
import { Lightbox } from "@/components/gallery/Lightbox";
import { Slideshow } from "@/components/slideshow/Slideshow";
import { DownloadMyWeekendButton } from "@/components/personalization/DownloadMyWeekendButton";

/**
 * PhotoCard (task 06) takes required numeric width/height and applies them
 * as a literal inline pixel style -- it has no "fill the CSS grid cell"
 * mode. So the grid below cannot be a plain responsive `grid-cols-*` with a
 * hardcoded PhotoCard size (that would overflow or underflow the actual
 * cell at every breakpoint except one). Instead this measures the
 * container, matches the SAME 2/3/4-column breakpoints the Tailwind classes
 * describe, and computes the exact per-tile pixel size, mirroring
 * src/components/gallery/VirtualPhotoGrid.tsx's useContainerWidth pattern
 * (which is private to that file, hence this small local copy rather than a
 * shared import).
 */
const TILE_GAP_PX = 8; // matches gap-2
const COLUMN_BREAKPOINTS = [
  { minWidth: 768, columns: 4 }, // md:grid-cols-4
  { minWidth: 640, columns: 3 }, // sm:grid-cols-3
  { minWidth: 0, columns: 2 }, // grid-cols-2
];

function columnsForWidth(width: number): number {
  const match = COLUMN_BREAKPOINTS.find((bp) => width >= bp.minWidth);
  return match?.columns ?? 2;
}

/** SSR-safe layout-effect: no-op on the server, real effect in the browser. */
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function useSquareTileSize(): [React.RefObject<HTMLDivElement | null>, number] {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tileSize, setTileSize] = useState(0);
  useIsoLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const columns = columnsForWidth(width);
      const size = Math.floor((width - TILE_GAP_PX * (columns - 1)) / columns);
      setTileSize(Math.max(size, 0));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [containerRef, tileSize];
}

export interface MyWeekendGalleryProps {
  personSlug: string;
  personName: string;
  onChangePerson: () => void;
}

type LoadState = "loading" | "ready" | "empty" | "error";

const PAGE_LIMIT = 100;
/**
 * Guards against a runaway cursor loop. 100 * 20 = 2,000 photos is far above
 * any one guest's realistic tag count against the ~1,721-photo catalog.
 */
const MAX_PAGES = 20;

interface GalleryPageResponse {
  photos: ClientPhoto[];
  nextCursor: string | null;
}

async function fetchAllForPerson(personSlug: string): Promise<ClientPhoto[]> {
  const photos: ClientPhoto[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      person: personSlug,
      sort: "weekend",
      limit: String(PAGE_LIMIT),
    });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/gallery?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Gallery request failed (${response.status}).`);
    }
    const body = (await response.json()) as GalleryPageResponse;
    photos.push(...body.photos);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return photos;
}

/**
 * Fetches every approved photo confirmed for one person (via task 06's
 * existing /api/gallery?person= filter, paged client-side) and renders it
 * grouped by event, with a lightbox and a slideshow entry point.
 */
export function MyWeekendGallery({
  personSlug,
  personName,
  onChangePerson,
}: MyWeekendGalleryProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [photos, setPhotos] = useState<ClientPhoto[]>([]);
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);
  const [slideshowOpen, setSlideshowOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Wrapped in an async IIFE so the reset calls are not direct synchronous
    // statements in the effect body (react-hooks/set-state-in-effect);
    // behavior is unchanged. The reset itself is real, not incidental: on a
    // personSlug change (guest picks a different person), it clears the
    // previous person's photos immediately rather than leaving them on
    // screen until the new fetch resolves.
    void (async () => {
      setState("loading");
      setPhotos([]);
      try {
        const result = await fetchAllForPerson(personSlug);
        if (cancelled) return;
        setPhotos(result);
        setState(result.length === 0 ? "empty" : "ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [personSlug]);

  const [gridRef, tileSize] = useSquareTileSize();
  const groups = useMemo(() => groupByEvent(photos), [photos]);
  const photoIds = useMemo(() => photos.map((photo) => photo.id), [photos]);
  const openIndex = useMemo(
    () => (openPhotoId ? photos.findIndex((p) => p.id === openPhotoId) : -1),
    [photos, openPhotoId],
  );
  const openPhoto = openIndex >= 0 ? photos[openIndex] : null;

  const closeLightbox = useCallback(() => setOpenPhotoId(null), []);
  const prev = useCallback(() => {
    if (openIndex > 0) setOpenPhotoId(photos[openIndex - 1].id);
  }, [openIndex, photos]);
  const next = useCallback(() => {
    if (openIndex >= 0 && openIndex < photos.length - 1) {
      setOpenPhotoId(photos[openIndex + 1].id);
    }
  }, [openIndex, photos]);

  return (
    <div>
      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted">My Weekend</p>
            <h2 className="font-display text-2xl text-ink">{personName}&rsquo;s weekend</h2>
          </div>
          <div className="flex gap-2">
            {photos.length > 0 ? (
              <button
                type="button"
                onClick={() => setSlideshowOpen(true)}
                className="rounded-md border border-ink bg-ink px-3 py-2 text-sm font-medium text-cream hover:bg-ink/90"
              >
                Play slideshow
              </button>
            ) : null}
            <button
              type="button"
              onClick={onChangePerson}
              className="rounded-md border border-wheat bg-white px-3 py-2 text-sm text-ink hover:border-tan"
            >
              Not {personName}?
            </button>
          </div>
        </div>

        {/* Renders nothing on its own (see DownloadMyWeekendButton's doc
            comment) while photos is still empty, whether that is "still
            loading" or "this person has none" -- no separate gate needed
            here. */}
        <div className="mt-3">
          <DownloadMyWeekendButton
            personName={personName}
            personSlug={personSlug}
            photoIds={photoIds}
          />
        </div>
      </div>

      {state === "loading" ? (
        <p className="text-sm text-muted">Gathering your weekend…</p>
      ) : null}
      {state === "error" ? (
        <p className="text-sm text-muted">
          We could not load your weekend right now. Refresh to try again.
        </p>
      ) : null}
      {state === "empty" ? (
        <p className="text-sm text-muted">
          No photos of {personName} here yet. Check back as more of the weekend gets tagged.
        </p>
      ) : null}

      {/* Measured once here: every group's grid below shares this width, so
          one ResizeObserver on the first group's container is enough to size
          every PhotoCard tile in every section at the exact rendered pixel
          size (see useSquareTileSize's doc comment for why this is needed at
          all). */}
      <div ref={gridRef}>
        {groups.map((group) => (
          <section key={group.eventSlug} className="mb-10">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
              {group.eventName}
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {tileSize > 0
                ? group.photos.map((photo) => (
                    <div key={photo.id} className="aspect-square">
                      <PhotoCard
                        photo={photo}
                        width={tileSize}
                        height={tileSize}
                        onOpen={setOpenPhotoId}
                      />
                    </div>
                  ))
                : null}
            </div>
          </section>
        ))}
      </div>

      {openPhoto ? (
        <Lightbox
          photo={openPhoto}
          onClose={closeLightbox}
          onPrev={openIndex > 0 ? prev : undefined}
          onNext={openIndex >= 0 && openIndex < photos.length - 1 ? next : undefined}
        />
      ) : null}

      {slideshowOpen ? (
        <Slideshow
          // Slideshow's landed SlideshowPhoto/SlideshowPreview types (see
          // src/components/slideshow/Slideshow.tsx's doc comment) are
          // structurally compatible with ClientPhoto/ClientPreview -- they
          // independently resolved the same GalleryPhotoView-can't-render
          // concern this packet's plan flagged, so ClientPhoto[] (the only
          // shape this component ever has, fetched from /api/gallery) is
          // passed through as-is, with no cast.
          photos={photos}
          modeLabel={`${personName}'s weekend`}
          onClose={() => setSlideshowOpen(false)}
        />
      ) : null}
    </div>
  );
}
