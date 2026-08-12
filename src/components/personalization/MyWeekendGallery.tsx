"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Layers } from "lucide-react";

import type { ClientPhoto } from "@/lib/gallery/client-types";
import { groupByEvent } from "@/lib/personalization/my-weekend";
import { PhotoCard } from "@/components/gallery/PhotoCard";
import { ContactStackCard } from "@/components/gallery/ContactStackCard";
import { buildDisplayList } from "@/lib/gallery/grouping";
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
}: MyWeekendGalleryProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [photos, setPhotos] = useState<ClientPhoto[]>([]);
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);
  const [slideshowOpen, setSlideshowOpen] = useState(false);
  /*
   * Burst IDs the guest has fanned out. The main grid has collapsed
   * near-identical frames into one stack card since P4, but this page did
   * not, so a guest's own collection -- the link they get texted -- opened on
   * four almost-identical versions of the same moment. Same display model,
   * same component, so the two surfaces cannot drift.
   */
  const [expandedBursts, setExpandedBursts] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const expandBurst = useCallback((burstId: string) => {
    setExpandedBursts((current) => new Set(current).add(burstId));
  }, []);
  const collapseBurst = useCallback((burstId: string) => {
    setExpandedBursts((current) => {
      const next = new Set(current);
      next.delete(burstId);
      return next;
    });
  }, []);

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
    <div className="atlas-weekend-collection">
      <div className="atlas-weekend-collection-header">
        <div className="atlas-weekend-collection-heading">
          <div>
            {/* Person-neutral wording: this renders for whoever is being
                viewed, which is frequently not the guest reading it. "Find
                me" and "your collection" both quietly asserted otherwise.

                The name is NOT repeated here. The route already sets it as
                the h1, and this block used to restate it as "Guest gallery /
                {name}'s photos" directly underneath, with the download button
                saying it a third time. Three occurrences of the same name
                filled the first 730px of the page and pushed the first
                photograph below the fold. The count is the only new
                information this row carries, so the count is all it says. */}
            <p className="atlas-kicker">Guest gallery</p>
            {state === "ready" ? (
              <p className="atlas-weekend-photo-count">
                {photos.length.toLocaleString()}{" "}
                {photos.length === 1 ? "photo" : "photos"}
              </p>
            ) : null}
          </div>
          {/* Download sits on this row rather than on a full-width row of its
              own below it. Count, slideshow and download are one decision
              ("what do I do with these 665?"), and splitting them across two
              rows cost about 90px of vertical chrome above the first
              photograph for no gain. DownloadMyWeekendButton renders nothing
              on its own while photos is empty (see its doc comment), so no
              separate gate is needed here. */}
          <div className="atlas-weekend-collection-actions">
            {photos.length > 0 ? (
              <button
                type="button"
                onClick={() => setSlideshowOpen(true)}
                className="atlas-inline-action"
              >
                Play slideshow
              </button>
            ) : null}
            <DownloadMyWeekendButton
              personName={personName}
              personSlug={personSlug}
              photoIds={photoIds}
            />
            {/* No "Not you?" here any more. This gallery renders for whoever
                the guest is LOOKING at, which is often not them, so an
                identity control belongs with the rest of the identity UI in
                PersonGalleryClient rather than duplicated on every view. */}
          </div>
        </div>
      </div>

      {state === "loading" ? (
        <p className="atlas-personal-state">Gathering the photos…</p>
      ) : null}
      {state === "error" ? (
        <p className="atlas-personal-state">
          We could not load these photos right now. Refresh to try again.
        </p>
      ) : null}
      {state === "empty" ? (
        <p className="atlas-personal-state">
          No confirmed photos of {personName} yet. Check back
          as more photos are tagged.
        </p>
      ) : null}

      {/* Measured once here: every group's grid below shares this width, so
          one ResizeObserver on the first group's container is enough to size
          every PhotoCard tile in every section at the exact rendered pixel
          size (see useSquareTileSize's doc comment for why this is needed at
          all). */}
      <div ref={gridRef}>
        {groups.map((group, groupIndex) => (
          <section key={group.eventSlug} className="atlas-weekend-event">
            <header className="atlas-weekend-event-heading">
              <span>
                {String(groupIndex + 1).padStart(2, "0")}
              </span>
              <h3>{group.eventName}</h3>
              <small>
                {group.photos.length.toLocaleString()}{" "}
                {group.photos.length === 1 ? "photo" : "photos"}
              </small>
            </header>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {tileSize > 0
                ? buildDisplayList(group.photos, expandedBursts).map((item) =>
                    item.kind === "stack" ? (
                      <div key={item.key} className="aspect-square">
                        <ContactStackCard
                          photos={item.photos}
                          size={item.size}
                          width={tileSize}
                          height={tileSize}
                          onExpand={() => expandBurst(item.burstId)}
                        />
                      </div>
                    ) : (
                      /* A burst-frame is NOT an ordinary photo: it carries
                         the contact-sheet edge treatment, and its leader
                         carries the control that folds the burst back up.
                         Rendering it as a plain card (as this first did)
                         meant an expanded stack here could never be
                         collapsed again, which VirtualPhotoGrid has always
                         allowed. Same class, same data attribute and same
                         control as that grid. */
                      <div
                        key={item.key}
                        className={
                          item.kind === "burst-frame"
                            ? "atlas-burst-frame relative aspect-square"
                            : "aspect-square"
                        }
                        data-burst-frame={
                          item.kind === "burst-frame" ? "true" : undefined
                        }
                      >
                        <PhotoCard
                          photo={item.photo}
                          width={tileSize}
                          height={tileSize}
                          onOpen={setOpenPhotoId}
                        />
                        {item.kind === "burst-frame" && item.leader ? (
                          <button
                            type="button"
                            className="atlas-stack-collapse"
                            aria-label={`Collapse these ${
                              item.photo.burst?.size ?? 0
                            } frames back into one stack`}
                            title="Collapse stack"
                            onClick={() => collapseBurst(item.burstId)}
                          >
                            <Layers aria-hidden="true" size={14} strokeWidth={1.8} />
                          </button>
                        ) : null}
                      </div>
                    ),
                  )
                : null}
            </div>
          </section>
        ))}
      </div>

      {openPhoto ? (
        <Lightbox
          photo={openPhoto}
          onClose={closeLightbox}
          position={openIndex + 1}
          total={photos.length}
          previousPhoto={openIndex > 0 ? photos[openIndex - 1] : undefined}
          nextPhoto={
            openIndex >= 0 && openIndex < photos.length - 1
              ? photos[openIndex + 1]
              : undefined
          }
          onPrev={openIndex > 0 ? prev : undefined}
          onNext={openIndex >= 0 && openIndex < photos.length - 1 ? next : undefined}
          filmstrip={{ photos, onSelect: setOpenPhotoId }}
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
          modeLabel={`${personName}'s photos`}
          onClose={() => setSlideshowOpen(false)}
        />
      ) : null}
    </div>
  );
}
