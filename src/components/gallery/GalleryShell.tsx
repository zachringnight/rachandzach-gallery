"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientGalleryFacets,
  ClientGalleryPage,
  ClientPhoto,
  GalleryFilterState,
} from "@/lib/gallery/client-types";
import { EMPTY_FILTER_STATE } from "@/lib/gallery/client-types";
import { FilterBar } from "@/components/gallery/FilterBar";
import { VirtualPhotoGrid } from "@/components/gallery/VirtualPhotoGrid";
import { Lightbox } from "@/components/gallery/Lightbox";

export interface GalleryShellProps {
  initialPage: ClientGalleryPage;
  facets: ClientGalleryFacets;
  initialFilters: GalleryFilterState;
  initialPhotoId: string | null;
}

const PAGE_LIMIT = 60;
const RENEW_LEAD_MS = 60_000;

type LoadState = "idle" | "loading" | "error-session" | "error-network";

function pageUrl(filters: GalleryFilterState, photoId: string | null): string {
  const params = new URLSearchParams();
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

  // Guards against stale responses when filters change mid-flight.
  const requestSeq = useRef(0);

  const runQuery = useCallback(
    async (next: GalleryFilterState) => {
      const seq = ++requestSeq.current;
      setState("loading");
      try {
        const res = await fetch(apiUrl(next), { cache: "no-store" });
        if (res.status === 401) {
          if (seq === requestSeq.current) setState("error-session");
          return;
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body: ClientGalleryPage = await res.json();
        if (seq !== requestSeq.current) return;
        setPhotos(body.photos);
        setCursor(body.nextCursor);
        setTotal(body.total);
        setExpiresAt(body.signedUrlExpiresAt);
        setState("idle");
      } catch {
        if (seq === requestSeq.current) setState("error-network");
      }
    },
    [],
  );

  const loadMore = useCallback(async () => {
    if (!cursor || state === "loading") return;
    const seq = requestSeq.current;
    setState("loading");
    try {
      const res = await fetch(apiUrl(filters, { cursor }), {
        cache: "no-store",
      });
      if (res.status === 401) {
        setState("error-session");
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
      setState("idle");
    } catch {
      setState("error-network");
    }
  }, [cursor, filters, state]);

  const applyFilters = useCallback(
    (patch: Partial<GalleryFilterState>) => {
      setFilters((prev) => {
        const next = { ...prev, ...patch };
        window.history.replaceState({}, "", pageUrl(next, activePhotoId));
        void runQuery(next);
        return next;
      });
    },
    [activePhotoId, runQuery],
  );

  const resetFilters = useCallback(() => {
    setFilters(() => {
      const next = { ...EMPTY_FILTER_STATE };
      window.history.replaceState({}, "", pageUrl(next, activePhotoId));
      void runQuery(next);
      return next;
    });
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
      setFilters((prev) => {
        const changed =
          prev.person !== nextFilters.person ||
          prev.event !== nextFilters.event ||
          prev.orientation !== nextFilters.orientation ||
          prev.source !== nextFilters.source ||
          prev.sort !== nextFilters.sort;
        if (changed) void runQuery(nextFilters);
        return changed ? nextFilters : prev;
      });
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

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <FilterBar
        facets={facets}
        filters={filters}
        total={total}
        onChange={applyFilters}
        onReset={resetFilters}
      />

      <div className="min-w-0">
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
          <div className="rounded-md border border-wheat bg-white p-10 text-center">
            <p className="text-lg text-ink">No photos match these filters.</p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-3 text-sm underline underline-offset-4"
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
          />
        )}
      </div>

      {activePhoto ? (
        <Lightbox
          photo={activePhoto}
          onClose={closePhoto}
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
      className="rounded-md border border-coral/40 bg-white p-10 text-center"
    >
      <p className="text-lg text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink/70">{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-4 rounded-md bg-ink px-4 py-2 text-sm text-cream"
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
      const res = await fetch(apiUrl(filters, { ids: chunk }), {
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
