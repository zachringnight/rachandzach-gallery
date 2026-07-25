"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClientGalleryFacets,
  ClientGalleryPage,
  ClientPhoto,
  GalleryFilterState,
} from "@/lib/gallery/client-types";
import {
  EMPTY_FILTER_STATE,
  GALLERY_SEARCH_URL_PARAM,
} from "@/lib/gallery/client-types";
import { FilterBar } from "@/components/gallery/FilterBar";
import { SelectionBar } from "@/components/gallery/SelectionBar";
import { useSelection } from "@/components/gallery/useSelection";
import { VirtualPhotoGrid } from "@/components/gallery/VirtualPhotoGrid";
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
}

const PAGE_LIMIT = 60;
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
  extra: { cursor?: string | null; ids?: string[] } = {},
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
  params.set("limit", String(PAGE_LIMIT));
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
  const selection = useSelection();
  const selectedIds = useMemo(
    () => Array.from(selection.selected),
    [selection.selected],
  );

  // Guards against stale responses when filters change mid-flight.
  const requestSeq = useRef(0);
  const requestBusyRef = useRef(false);
  const filtersRef = useRef(filters);

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
        setTotal(body.total);
        setExpiresAt(body.signedUrlExpiresAt);
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

  const loadMore = useCallback(async () => {
    if (!cursor || requestBusyRef.current) return;
    const seq = requestSeq.current;
    requestBusyRef.current = true;
    setState("loading");
    try {
      const res = await fetchWithRetry(apiUrl(filters, { cursor }), {
        cache: "no-store",
      });
      if (res.status === 401) {
        if (seq === requestSeq.current) {
          requestBusyRef.current = false;
          setState("error-session");
        }
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body: ClientGalleryPage = await res.json();
      if (seq !== requestSeq.current) return; // filters changed; drop this page
      setPhotos((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...body.photos.filter((p) => !seen.has(p.id))];
      });
      setCursor(body.nextCursor);
      setTotal(body.total);
      setExpiresAt(body.signedUrlExpiresAt);
      requestBusyRef.current = false;
      setState("idle");
    } catch {
      if (seq === requestSeq.current) {
        requestBusyRef.current = false;
        setState("error-network");
      }
    }
  }, [cursor, filters]);

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

  const favoriteSelected = useCallback(() => {
    for (const photoId of selectedIds) {
      if (!favoriteStore.has(photoId)) favoriteStore.toggle(photoId);
    }
  }, [selectedIds]);

  return (
    <div className="atlas-gallery-shell">
      <FilterBar
        facets={facets}
        filters={filters}
        total={total}
        onChange={applyFilters}
        onReset={resetFilters}
        selecting={selection.selecting}
        selectedCount={selectedIds.length}
        onStartSelection={selection.start}
      />

      <div className="atlas-gallery-main">
        {featureFlags.momentSearch || toolbarSlot ? (
          <div className="atlas-gallery-toolbar">
            {featureFlags.momentSearch ? (
              <details className="atlas-search-disclosure">
                <summary>Search the moments</summary>
                <div className="atlas-search-disclosure-body">
                  <MomentSearch events={facets.events} />
                </div>
              </details>
            ) : null}
            {toolbarSlot}
          </div>
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
          <VirtualPhotoGrid
            photos={photos}
            hasMore={cursor !== null}
            loading={state === "loading"}
            onOpenPhoto={openPhoto}
            onLoadMore={() => void loadMore()}
            selecting={selection.selecting}
            selected={selection.selected}
            onToggleSelection={selection.toggle}
            onStartSelection={(photoId) => selection.toggle(photoId)}
          />
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
