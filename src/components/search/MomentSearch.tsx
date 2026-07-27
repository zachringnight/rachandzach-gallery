"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ClientGalleryFacets, ClientPhoto } from "@/lib/gallery/client-types";
import { EventPicker } from "@/components/gallery/EventPicker";
import { PhotoCard } from "@/components/gallery/PhotoCard";
import { Lightbox } from "@/components/gallery/Lightbox";
import { SearchExamples } from "@/components/search/SearchExamples";
import { featureFlags } from "@/content/features";
// Imported from ./contracts, NOT "@/lib/search/moment-search": that module
// dynamically imports server-only Supabase/embedding code, and Next's client
// bundler taints any module reachable via that import graph even though the
// dynamic import() is deferred at runtime. See src/lib/search/contracts.ts's
// doc comment (added during wave 4 integration to fix a real build failure).
import {
  MOMENT_SEARCH_MAX_QUERY_LENGTH,
  MOMENT_SEARCH_MIN_QUERY_LENGTH,
  type MomentMatchType,
} from "@/lib/search/contracts";

export interface MomentSearchProps {
  events: ClientGalleryFacets["events"];
}

interface MomentSearchResultDTO {
  photo: ClientPhoto;
  similarity: number;
  matchType: MomentMatchType;
}

type SearchState = "idle" | "loading" | "ready" | "error";

/**
 * PhotoCard (task 06) takes required numeric width/height and applies them
 * as a literal inline pixel style -- it has no "fill the CSS grid cell"
 * mode, so a plain responsive `grid-cols-*` with one hardcoded PhotoCard
 * size would overflow or underflow the actual cell at every breakpoint but
 * one. Same fix and rationale as
 * src/components/personalization/MyWeekendGallery.tsx's identical helper
 * (small local copy in both files rather than a shared import, mirroring
 * src/components/gallery/VirtualPhotoGrid.tsx's own private
 * useContainerWidth, which is not exported).
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

const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Reads the "q" URL param for MomentSearch's initial query value, used
 * directly as its useState initializer below. Deriving the seed here, a
 * plain read during the first render, rather than via a post-mount
 * setState, is what keeps that hook clear of react-hooks/set-state-in-effect
 * (the earlier version set state inside a mount effect and suppressed the
 * rule; this removes the need for the suppression instead of silencing it).
 * Guards on `typeof window` because this component is server-rendered
 * first, where `window` does not exist, so the initializer returns "" on
 * the server. In the common case -- no "?q=" on the page -- that also
 * matches the client's first render exactly, no divergence at all. When a
 * "?q=" IS present (a deep link from a keyword chip elsewhere in the
 * gallery, per the effect below), the client's first render briefly
 * disagrees with the server's empty-string render; React recovers from that
 * the same way it recovers from any hydration mismatch, by re-rendering the
 * affected DOM to match the client, so the input still ends up showing the
 * right value. Parses window.location.search with URLSearchParams directly
 * rather than next/navigation's useSearchParams, the same parsing style
 * src/components/gallery/GalleryShell.tsx uses for its own URL-driven state
 * -- no Suspense boundary to wire up, and no new dependency.
 */
function initialQueryFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q") ?? "";
}

function useSquareTileSize(
  active = true,
): [React.RefObject<HTMLDivElement | null>, number] {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tileSize, setTileSize] = useState(0);
  useIsoLayoutEffect(() => {
    // Search results mount only after the async request resolves. Re-run this
    // setup when that deferred grid appears; the mount-only version returned
    // early while containerRef was null and could leave a populated result set
    // permanently invisible.
    if (!active) return;
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
  }, [active]);
  return [containerRef, tileSize];
}

/**
 * Natural-language scene/object search (packet 07). Hidden entirely while
 * the momentSearch feature flag is off (src/content/features.ts) -- never an
 * error page, per the packet's done-check. The parent page also skips
 * rendering this component server-side when the flag is off, so this check
 * is defense in depth, not the only gate.
 */
export function MomentSearch({ events }: MomentSearchProps) {
  const [query, setQuery] = useState<string>(initialQueryFromUrl);
  const [event, setEvent] = useState<string | null>(null);
  const [state, setState] = useState<SearchState>("idle");
  const [results, setResults] = useState<MomentSearchResultDTO[]>([]);
  const [usedFallback, setUsedFallback] = useState(false);
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);

  const run = useCallback(
    async (raw: string, eventFilter: string | null) => {
      const trimmed = raw.trim();
      if (trimmed.length < MOMENT_SEARCH_MIN_QUERY_LENGTH) return;
      setState("loading");
      try {
        const params = new URLSearchParams({ q: trimmed });
        if (eventFilter) params.set("event", eventFilter);
        const response = await fetch(`/api/search?${params.toString()}`);
        if (!response.ok) {
          setState("error");
          return;
        }
        const body = (await response.json()) as { results?: MomentSearchResultDTO[] };
        const items = body.results ?? [];
        setResults(items);
        setUsedFallback(items.some((item) => item.matchType === "keyword"));
        setState("ready");
      } catch {
        setState("error");
      }
    },
    [],
  );

  // Runs the search for a "?q=" URL param -- the same one that seeded
  // `query` above via initialQueryFromUrl -- so a keyword chip elsewhere in
  // the gallery (Lightbox) can deep-link straight into a running search, not
  // just a pre-filled box. Re-reads the URL here (rather than closing over
  // the `query` state) so this effect's dependency array does not need
  // `query` added to it. Mount only: `run` is stable (useCallback with no
  // deps), so this fires once per mount and does not react to a later
  // query-string-only navigation.
  //
  // The queueMicrotask wrapper is load-bearing, not decoration: `run` sets
  // `state` to "loading" synchronously, before its first `await`, so calling
  // `void run(initial, null)` directly here still counts as calling setState
  // synchronously within the effect body (react-hooks/set-state-in-effect
  // flags the call to `run` itself, not just a literal setQuery/setState
  // call -- confirmed by removing the wrapper and re-running the linter).
  // Deferring the call to the next microtask moves that setState call out of
  // the effect's own synchronous execution, which is exactly what avoids the
  // cascading-render-in-the-same-commit pattern the rule exists to catch,
  // not merely a way to quiet the linter. The delay is a single microtask
  // (resolves before the browser paints), so the deep-link search still
  // starts effectively immediately.
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q");
    if (!initial) return;
    queueMicrotask(() => void run(initial, null));
  }, [run]);

  const openIndex = useMemo(
    () => (openPhotoId ? results.findIndex((r) => r.photo.id === openPhotoId) : -1),
    [results, openPhotoId],
  );
  const openPhoto = openIndex >= 0 ? results[openIndex].photo : null;
  const [gridRef, tileSize] = useSquareTileSize(results.length > 0);

  if (!featureFlags.momentSearch) {
    return null;
  }

  return (
    <div className="atlas-moment-search">
      <p className="atlas-moment-search-intro">
        Search the gallery for a scene, not a name: &ldquo;sunset kiss,&rdquo; &ldquo;champagne
        toast,&rdquo; &ldquo;people dancing.&rdquo;
      </p>
      <form
        onSubmit={(formEvent) => {
          formEvent.preventDefault();
          void run(query, event);
        }}
        className="atlas-moment-search-form"
      >
        <label className="sr-only" htmlFor="moment-search-input">
          Describe a moment
        </label>
        <input
          id="moment-search-input"
          type="search"
          value={query}
          onChange={(changeEvent) => setQuery(changeEvent.target.value)}
          minLength={MOMENT_SEARCH_MIN_QUERY_LENGTH}
          maxLength={MOMENT_SEARCH_MAX_QUERY_LENGTH}
          placeholder="Describe a moment…"
          className="atlas-form-field"
        />
        <button
          type="submit"
          disabled={query.trim().length < MOMENT_SEARCH_MIN_QUERY_LENGTH}
          className="atlas-inline-action disabled:cursor-not-allowed disabled:opacity-40"
        >
          Search
        </button>
      </form>

      <div className="atlas-moment-search-examples">
        <SearchExamples
          onPick={(example) => {
            setQuery(example);
            void run(example, event);
          }}
        />
      </div>

      <div className="atlas-moment-search-events">
        <EventPicker events={events} selected={event} onSelect={setEvent} />
      </div>

      {state === "loading" ? <p className="atlas-search-state">Searching…</p> : null}
      {state === "error" ? (
        <p className="atlas-search-state">
          Search is unavailable right now. Try again shortly.
        </p>
      ) : null}
      {state === "ready" && results.length === 0 ? (
        <p className="atlas-search-state">No matches yet. Try a different description.</p>
      ) : null}
      {state === "ready" && usedFallback && results.length > 0 ? (
        <p className="atlas-search-state atlas-search-state-subtle">
          Showing keyword matches while visual search is unavailable.
        </p>
      ) : null}

      {results.length > 0 ? (
        <div ref={gridRef} className="atlas-search-results grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {tileSize > 0
            ? results.map((result) => (
                <div key={result.photo.id} className="aspect-square">
                  <PhotoCard
                    photo={result.photo}
                    width={tileSize}
                    height={tileSize}
                    onOpen={setOpenPhotoId}
                  />
                </div>
              ))
            : null}
        </div>
      ) : null}

      {openPhoto ? (
        <Lightbox
          photo={openPhoto}
          onClose={() => setOpenPhotoId(null)}
          position={openIndex + 1}
          total={results.length}
          previousPhoto={
            openIndex > 0 ? results[openIndex - 1].photo : undefined
          }
          nextPhoto={
            openIndex >= 0 && openIndex < results.length - 1
              ? results[openIndex + 1].photo
              : undefined
          }
          onPrev={
            openIndex > 0 ? () => setOpenPhotoId(results[openIndex - 1].photo.id) : undefined
          }
          onNext={
            openIndex >= 0 && openIndex < results.length - 1
              ? () => setOpenPhotoId(results[openIndex + 1].photo.id)
              : undefined
          }
          filmstrip={{
            photos: results.map((result) => result.photo),
            onSelect: setOpenPhotoId,
          }}
        />
      ) : null}
    </div>
  );
}
