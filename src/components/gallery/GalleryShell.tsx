"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClientGalleryFacets,
  ClientGalleryPage,
  ClientPhoto,
  ClientTimeline,
  GalleryFilterState,
} from "@/lib/gallery/client-types";
import {
  EMPTY_FILTER_STATE,
  GALLERY_SEARCH_URL_PARAM,
} from "@/lib/gallery/client-types";
import { FilterBar } from "@/components/gallery/FilterBar";
import { LightBar } from "@/components/gallery/LightBar";
import { SelectionBar } from "@/components/gallery/SelectionBar";
import { useSelection } from "@/components/gallery/useSelection";
import {
  VirtualPhotoGrid,
  type VirtualPhotoGridHandle,
} from "@/components/gallery/VirtualPhotoGrid";
import { Lightbox } from "@/components/gallery/Lightbox";
import { DownloadSelectionButton } from "@/components/downloads/DownloadSelectionButton";
import { SavePhotosButton } from "@/components/downloads/SavePhotosButton";
import { MomentSearch } from "@/components/search/MomentSearch";
import { featureFlags } from "@/content/features";
import { favoriteStore } from "@/lib/favorites/store";
import { fetchWithRetry } from "@/lib/http/fetch-with-retry";

export interface GalleryShellProps {
  initialPage: ClientGalleryPage;
  facets: ClientGalleryFacets;
  initialFilters: GalleryFilterState;
  initialPhotoId: string | null;
  toolbarSlot?: React.ReactNode;
  /**
   * Page headline rendered as the single compact header above the control
   * bar, with the live result count beside it (P1: one headline per page).
   */
  heading?: string;
}

const PAGE_LIMIT = 60;
/** Larger pages while the Light Bar races toward a far scrub target. */
const JUMP_PAGE_LIMIT = 100;
const RENEW_LEAD_MS = 60_000;

type LoadState = "idle" | "loading" | "error-session" | "error-network";

function pageUrl(filters: GalleryFilterState, photoId: string | null): string {
  const params = new URLSearchParams();
  if (filters.q) params.set(GALLERY_SEARCH_URL_PARAM, filters.q);
  if (filters.person) params.set("person", filters.person);
  if (filters.event) params.set("event", filters.event);
  if (filters.orientation) params.set("orientation", filters.orientation);
  if (filters.source) params.set("source", filters.source);
  if (filters.sort !== "weekend") params.set("sort", filters.sort);
  if (photoId) params.set("photo", photoId);
  const qs = params.toString();
  return qs ? `/photos?${qs}` : "/photos";
}

function apiUrl(
  filters: GalleryFilterState,
  extra: { cursor?: string | null; ids?: string[]; limit?: number } = {},
): string {
  const params = new URLSearchParams();
  if (extra.ids && extra.ids.length > 0) {
    for (const id of extra.ids) params.append("ids", id);
    return `/api/gallery?${params.toString()}`;
  }
  if (filters.q) params.set("q", filters.q);
  if (filters.person) params.set("person", filters.person);
  if (filters.event) params.set("event", filters.event);
  if (filters.orientation) params.set("orientation", filters.orientation);
  if (filters.source) params.set("source", filters.source);
  params.set("sort", filters.sort);
  params.set("limit", String(extra.limit ?? PAGE_LIMIT));
  if (extra.cursor) params.set("cursor", extra.cursor);
  return `/api/gallery?${params.toString()}`;
}

function filtersFromSearch(search: string): GalleryFilterState {
  const params = new URLSearchParams(search);
  const orientation = params.get("orientation");
  const source = params.get("source");
  const sort = params.get("sort");
  return {
    q:
      params
        .get(GALLERY_SEARCH_URL_PARAM)
        ?.trim()
        .replace(/\s+/g, " ") ?? "",
    person: params.get("person"),
    event: params.get("event"),
    orientation:
      orientation === "portrait" ||
      orientation === "landscape" ||
      orientation === "square"
        ? orientation
        : null,
    source: source === "photographer" || source === "guest" ? source : null,
    sort: sort === "newest" ? "newest" : "weekend",
  };
}

export function GalleryShell({
  initialPage,
  facets,
  initialFilters,
  initialPhotoId,
  toolbarSlot,
  heading,
}: GalleryShellProps) {
  const [filters, setFilters] = useState<GalleryFilterState>(initialFilters);
  const [photos, setPhotos] = useState<ClientPhoto[]>(initialPage.photos);
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor);
  const [total, setTotal] = useState<number>(initialPage.total);
  const [expiresAt, setExpiresAt] = useState<string>(
    initialPage.signedUrlExpiresAt,
  );
  const [state, setState] = useState<LoadState>("idle");
  const [activePhotoId, setActivePhotoId] = useState<string | null>(
    initialPhotoId,
  );
  // The archive's light timeline (P3) and contact-sheet state (P4).
  const [timeline, setTimeline] = useState<ClientTimeline | null>(
    initialPage.timeline ?? null,
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [expandedBursts, setExpandedBursts] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [jumping, setJumping] = useState(false);
  const gridRef = useRef<VirtualPhotoGridHandle | null>(null);
  const selection = useSelection();
  const selectedIds = useMemo(
    () => Array.from(selection.selected),
    [selection.selected],
  );

  // Guards against stale responses when filters change mid-flight.
  const requestSeq = useRef(0);
  const requestBusyRef = useRef(false);
  const filtersRef = useRef(filters);
  // Live mirrors for the Light Bar's paging jump loop.
  const photosCountRef = useRef(photos.length);
  const cursorRef = useRef(cursor);
  useEffect(() => {
    photosCountRef.current = photos.length;
  }, [photos.length]);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  const runQuery = useCallback(
    async (next: GalleryFilterState) => {
      const seq = ++requestSeq.current;
      requestBusyRef.current = true;
      setState("loading");
      try {
        const res = await fetchWithRetry(apiUrl(next), { cache: "no-store" });
        if (res.status === 401) {
          if (seq === requestSeq.current) {
            requestBusyRef.current = false;
            setState("error-session");
          }
          return;
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body: ClientGalleryPage = await res.json();
        if (seq !== requestSeq.current) return;
        setPhotos(body.photos);
        setCursor(body.nextCursor);
        cursorRef.current = body.nextCursor;
        setTotal(body.total);
        setExpiresAt(body.signedUrlExpiresAt);
        setTimeline(body.timeline ?? null);
        setExpandedBursts(new Set<string>());
        setCurrentIndex(0);
        requestBusyRef.current = false;
        setState("idle");
      } catch {
        if (seq === requestSeq.current) {
          requestBusyRef.current = false;
          setState("error-network");
        }
      }
    },
    [],
  );

  /**
   * Fetch and append the next page. Shared by grid tail-loading and Light
   * Bar jumps. "busy" means another request holds the wire (retryable);
   * "end" means the last page is already loaded; "stale" covers filter
   * changes and failures (both end a jump).
   */
  const fetchNextPage = useCallback(
    async (limit: number): Promise<"appended" | "busy" | "end" | "stale"> => {
      const nextCursor = cursorRef.current;
      if (!nextCursor) return "end";
      if (requestBusyRef.current) return "busy";
      const seq = requestSeq.current;
      requestBusyRef.current = true;
      setState("loading");
      try {
        const res = await fetchWithRetry(
          apiUrl(filtersRef.current, { cursor: nextCursor, limit }),
          { cache: "no-store" },
        );
        if (res.status === 401) {
          if (seq === requestSeq.current) {
            requestBusyRef.current = false;
            setState("error-session");
          }
          return "stale";
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body: ClientGalleryPage = await res.json();
        if (seq !== requestSeq.current) return "stale"; // filters changed
        setPhotos((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          const next = [...prev, ...body.photos.filter((p) => !seen.has(p.id))];
          photosCountRef.current = next.length;
          return next;
        });
        setCursor(body.nextCursor);
        cursorRef.current = body.nextCursor;
        setTotal(body.total);
        setExpiresAt(body.signedUrlExpiresAt);
        if (body.timeline) setTimeline(body.timeline);
        requestBusyRef.current = false;
        setState("idle");
        return "appended";
      } catch {
        if (seq === requestSeq.current) {
          requestBusyRef.current = false;
          setState("error-network");
        }
        return "stale";
      }
    },
    [],
  );

  const loadMore = useCallback(async () => {
    await fetchNextPage(PAGE_LIMIT);
  }, [fetchNextPage]);

  /**
   * Light Bar scrub target (P3). Anything already loaded scrolls
   * immediately; a farther target pages toward it first, keeping the
   * loaded list a contiguous prefix of the archive order.
   */
  const pendingJumpRef = useRef<number | null>(null);
  // Land a deferred jump only after the grid has committed the rows that
  // contain it (scrolling before the re-render would target stale layout).
  useEffect(() => {
    const target = pendingJumpRef.current;
    if (target !== null && photos.length > target) {
      pendingJumpRef.current = null;
      requestAnimationFrame(() => gridRef.current?.scrollToIndex(target));
    }
  }, [photos.length]);

  const jumpToIndex = useCallback(
    async (photoIndex: number) => {
      if (photoIndex < photosCountRef.current) {
        pendingJumpRef.current = null;
        gridRef.current?.scrollToIndex(photoIndex);
        return;
      }
      const seq = requestSeq.current;
      pendingJumpRef.current = photoIndex;
      setJumping(true);
      try {
        while (
          seq === requestSeq.current &&
          photosCountRef.current <= photoIndex &&
          cursorRef.current
        ) {
          const outcome = await fetchNextPage(JUMP_PAGE_LIMIT);
          if (outcome === "busy") {
            // Another request (e.g. tail-loading) holds the wire; let it
            // land, then keep paging toward the target.
            await new Promise((resolve) => setTimeout(resolve, 150));
            continue;
          }
          if (outcome !== "appended") break;
        }
      } finally {
        setJumping(false);
      }
      if (seq !== requestSeq.current) {
        pendingJumpRef.current = null;
        return;
      }
      // Ran out of archive before the target (or the effect above already
      // landed it): settle on the last loaded photograph.
      if (pendingJumpRef.current !== null && photosCountRef.current > 0) {
        const target = Math.min(photoIndex, photosCountRef.current - 1);
        pendingJumpRef.current = null;
        requestAnimationFrame(() => gridRef.current?.scrollToIndex(target));
      }
    },
    [fetchNextPage],
  );

  const toggleBurst = useCallback((burstId: string) => {
    setExpandedBursts((current) => {
      const next = new Set(current);
      if (next.has(burstId)) next.delete(burstId);
      else next.add(burstId);
      return next;
    });
  }, []);

  /** Selecting a stack selects its loaded frames; again deselects them. */
  const toggleBurstSelection = useCallback(
    (photoIds: string[]) => {
      const allSelected =
        photoIds.length > 0 &&
        photoIds.every((id) => selection.selected.has(id));
      for (const id of photoIds) {
        if (allSelected || !selection.selected.has(id)) selection.toggle(id);
      }
    },
    [selection],
  );

  const applyFilters = useCallback(
    (patch: Partial<GalleryFilterState>) => {
      const next = { ...filtersRef.current, ...patch };
      filtersRef.current = next;
      setFilters(next);
      window.history.replaceState({}, "", pageUrl(next, activePhotoId));
      void runQuery(next);
    },
    [activePhotoId, runQuery],
  );

  const resetFilters = useCallback(() => {
    const next = { ...EMPTY_FILTER_STATE };
    filtersRef.current = next;
    setFilters(next);
    window.history.replaceState({}, "", pageUrl(next, activePhotoId));
    void runQuery(next);
  }, [activePhotoId, runQuery]);

  // Lightbox open/close with browser history.
  const openPhoto = useCallback(
    (photoId: string) => {
      // Hand the lightbox the rect of the card that was clicked so it can
      // expand out of that frame rather than materialising over it. Read
      // synchronously here: once state changes the card may be unmounted by
      // the virtualizer.
      const card = document.querySelector<HTMLElement>(
        `[data-photo-id="${CSS.escape(photoId)}"]`,
      );
      if (card) {
        const r = card.getBoundingClientRect();
        const root = document.documentElement;
        root.style.setProperty("--rz-open-x", `${Math.round(r.left + r.width / 2)}px`);
        root.style.setProperty("--rz-open-y", `${Math.round(r.top + r.height / 2)}px`);
        root.style.setProperty(
          "--rz-open-scale",
          `${Math.max(0.12, Math.min(r.width / window.innerWidth, 0.9)).toFixed(3)}`,
        );
      }
      window.history.pushState({}, "", pageUrl(filters, photoId));
      setActivePhotoId(photoId);
    },
    [filters],
  );
  const closePhoto = useCallback(() => {
    // Prefer real back navigation so the history entry unwinds.
    if (window.history.state && activePhotoId) {
      window.history.back();
    } else {
      window.history.replaceState({}, "", pageUrl(filters, null));
      setActivePhotoId(null);
    }
  }, [activePhotoId, filters]);
  const selectPhoto = useCallback(
    (photoId: string) => {
      window.history.replaceState({}, "", pageUrl(filters, photoId));
      setActivePhotoId(photoId);
    },
    [filters],
  );

  // Reflect back/forward navigation into state.
  useEffect(() => {
    const onPopState = () => {
      const search = window.location.search;
      const params = new URLSearchParams(search);
      const nextFilters = filtersFromSearch(search);
      setActivePhotoId(params.get("photo"));
      const previous = filtersRef.current;
      const changed =
        previous.q !== nextFilters.q ||
        previous.person !== nextFilters.person ||
        previous.event !== nextFilters.event ||
        previous.orientation !== nextFilters.orientation ||
        previous.source !== nextFilters.source ||
        previous.sort !== nextFilters.sort;
      if (changed) {
        filtersRef.current = nextFilters;
        setFilters(nextFilters);
        void runQuery(nextFilters);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [runQuery]);

  // Renew signed URLs shortly before they expire, in place (no scroll reset).
  useEffect(() => {
    if (photos.length === 0) return;
    const due = new Date(expiresAt).getTime() - Date.now() - RENEW_LEAD_MS;
    const timer = setTimeout(
      () => {
        void renewSignedUrls(filters, photos, (fresh, freshExpiry) => {
          setPhotos((prev) =>
            prev.map((p) =>
              fresh.has(p.id) ? { ...p, previews: fresh.get(p.id)! } : p,
            ),
          );
          setExpiresAt(freshExpiry);
        });
      },
      Math.max(0, due),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, photos, filters]);

  const activeIndex = activePhotoId
    ? photos.findIndex((p) => p.id === activePhotoId)
    : -1;
  const activePhoto = activeIndex >= 0 ? photos[activeIndex] : null;

  const showEmpty = state === "idle" && photos.length === 0;

  // Sticky chapter label (P3): where the guest is in the day right now.
  const chapterPhoto =
    photos.length > 0
      ? photos[Math.max(0, Math.min(currentIndex, photos.length - 1))]
      : null;
  const chapterClock = chapterPhoto
    ? formatChapterClock(chapterPhoto.capturedAt)
    : null;

  const favoriteSelected = useCallback(() => {
    for (const photoId of selectedIds) {
      if (!favoriteStore.has(photoId)) favoriteStore.toggle(photoId);
    }
  }, [selectedIds]);

  return (
    <div className="atlas-gallery-shell">
      {heading ? (
        <header className="atlas-page-bar">
          <h1>{heading}</h1>
          <p className="atlas-page-bar-count" aria-live="polite">
            <strong>{total.toLocaleString()}</strong>
            {total === 1 ? " photo" : " photos"}
          </p>
        </header>
      ) : null}

      <FilterBar
        facets={facets}
        filters={filters}
        total={total}
        onChange={applyFilters}
        onReset={resetFilters}
        selecting={selection.selecting}
        selectedCount={selectedIds.length}
        onStartSelection={selection.start}
        momentSearchSlot={
          featureFlags.momentSearch ? (
            <MomentSearch events={facets.events} />
          ) : undefined
        }
      />

      <div className="atlas-gallery-main">
        {toolbarSlot ? (
          <div className="atlas-gallery-toolbar">{toolbarSlot}</div>
        ) : null}

        {state === "error-session" ? (
          <ErrorState
            title="Your session expired"
            body="Enter the password from your invite to keep browsing."
            actionLabel="Enter the password"
            onAction={() => {
              window.location.href = "/enter?next=/photos";
            }}
          />
        ) : state === "error-network" ? (
          <ErrorState
            title="We could not load photos"
            body="This looks like a connection hiccup, not an empty gallery."
            actionLabel="Try again"
            onAction={() => void runQuery(filters)}
          />
        ) : showEmpty ? (
          <div className="atlas-empty-state">
            <p>No photos match these filters.</p>
            <button
              type="button"
              onClick={resetFilters}
              className="atlas-text-button"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {chapterPhoto ? (
              <div className="atlas-chapter">
                <span className="atlas-chapter-kicker">Now in</span>
                <strong>{chapterPhoto.eventName}</strong>
                {chapterClock ? (
                  <span className="atlas-chapter-clock">{chapterClock}</span>
                ) : null}
                <span className="atlas-chapter-position">
                  {String(
                    Math.min(currentIndex + 1, total),
                  ).padStart(String(total).length, "0")}
                  &thinsp;/&thinsp;{total}
                </span>
              </div>
            ) : null}

            <LightBar
              timeline={timeline}
              photos={photos}
              currentIndex={currentIndex}
              onJump={(photoIndex) => void jumpToIndex(photoIndex)}
              jumping={jumping}
            />

            <VirtualPhotoGrid
              ref={gridRef}
              photos={photos}
              hasMore={cursor !== null}
              loading={state === "loading"}
              onOpenPhoto={openPhoto}
              onLoadMore={() => void loadMore()}
              selecting={selection.selecting}
              selected={selection.selected}
              onToggleSelection={selection.toggle}
              onStartSelection={(photoId) => selection.toggle(photoId)}
              expandedBursts={expandedBursts}
              onToggleBurst={toggleBurst}
              onToggleBurstSelection={toggleBurstSelection}
              onFirstVisiblePhotoChange={setCurrentIndex}
            />
          </>
        )}
      </div>

      {selection.selecting ? (
        <SelectionBar
          count={selectedIds.length}
          onFavoriteAll={favoriteSelected}
          onClear={selection.clear}
          onSelectAllVisible={() =>
            selection.selectAllVisible(photos.map((photo) => photo.id))
          }
          downloadControl={
            <DownloadSelectionButton
              photoIds={selectedIds}
              label="Download"
              zipFilename="rach-and-zach-selection.zip"
              className="atlas-selection-download"
            />
          }
          saveControl={
            <SavePhotosButton
              photoIds={selectedIds}
              label="Save photos"
              className="atlas-selection-save"
            />
          }
        />
      ) : null}

      {activePhoto ? (
        <Lightbox
          photo={activePhoto}
          onClose={closePhoto}
          position={activeIndex + 1}
          total={total}
          filmstrip={{ photos, onSelect: selectPhoto }}
          previousPhoto={
            activeIndex > 0 ? photos[activeIndex - 1] : undefined
          }
          nextPhoto={
            activeIndex >= 0 && activeIndex < photos.length - 1
              ? photos[activeIndex + 1]
              : undefined
          }
          onPrev={
            activeIndex > 0
              ? () => selectPhoto(photos[activeIndex - 1].id)
              : undefined
          }
          onNext={
            activeIndex >= 0 && activeIndex < photos.length - 1
              ? () => selectPhoto(photos[activeIndex + 1].id)
              : cursor !== null
                ? () => void loadMore()
                : undefined
          }
        />
      ) : null}
    </div>
  );
}

/**
 * Wall-clock label for the chapter strip, in the wedding's timezone
 * (matching the lightbox caption's formatting).
 */
function formatChapterClock(capturedAt: string | null): string | null {
  if (!capturedAt) return null;
  const parsed = new Date(capturedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Los_Angeles",
    }).format(parsed);
  } catch {
    // A runtime without the requested IANA zone throws here; the chapter
    // clock is decoration and must not take the gallery down with it.
    return null;
  }
}

function ErrorState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      role="alert"
      className="atlas-empty-state"
    >
      <p>{title}</p>
      <p>{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="atlas-inline-action"
      >
        {actionLabel}
      </button>
    </div>
  );
}

async function renewSignedUrls(
  filters: GalleryFilterState,
  photos: ClientPhoto[],
  apply: (
    fresh: Map<string, ClientPhoto["previews"]>,
    expiresAt: string,
  ) => void,
): Promise<void> {
  const ids = photos.map((p) => p.id);
  const fresh = new Map<string, ClientPhoto["previews"]>();
  let latestExpiry = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      const res = await fetchWithRetry(apiUrl(filters, { ids: chunk }), {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body: ClientGalleryPage = await res.json();
      for (const photo of body.photos) fresh.set(photo.id, photo.previews);
      latestExpiry = body.signedUrlExpiresAt;
    } catch {
      return;
    }
  }
  if (fresh.size > 0) apply(fresh, latestExpiry);
}
