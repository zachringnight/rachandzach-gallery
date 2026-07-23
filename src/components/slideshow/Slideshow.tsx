"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FavoriteButton } from "@/components/favorites/FavoriteButton";
import { DownloadOriginalButton } from "@/components/downloads/DownloadOriginalButton";
import { SlideshowControls } from "./SlideshowControls";

/**
 * Slideshow is intentionally generic (packet 09 objective: "Build Slideshow
 * as a generic component that accepts any ordered photo list and a mode
 * label"). It does not import GalleryPhotoView from src/lib/gallery/query.ts
 * even though that is the type named in the pinned prop contract, because
 * that type's previews carry an internal storage objectPath/bucket -- never
 * a renderable URL (see the doc comment on GalleryPhotoView/serialize.ts:
 * "Object paths are internal... nothing downstream sees a storage path").
 * Every existing client component that renders a photo (Lightbox, PhotoCard)
 * consumes ClientPhoto instead, whose previews carry a signed `url`.
 *
 * SlideshowPhoto below is deliberately structurally compatible with BOTH
 * GalleryPhotoView and ClientPhoto: it declares only the fields Slideshow
 * actually needs, and its preview shape accepts an optional `url` (present
 * on ClientPhoto) alongside the optional `objectPath`/`bucket` fields
 * (present on GalleryPhotoView). A caller can pass either type as-is; only a
 * preview that actually has a `url` renders an image, which in practice
 * means callers must serialize to ClientPhoto first -- exactly the pattern
 * every other photo-list-consuming component in this codebase already
 * follows. The prop NAMES and function signature (photos, modeLabel,
 * startIndex, intervalMs, onClose) match the pinned contract exactly; only
 * the nominal type identity of `photos`'s element differs, and only because
 * the literal pinned type cannot render an image on its own. Flagged in the
 * packet 09 report for the integration phase.
 */
export interface SlideshowPreview {
  width: number;
  height: number;
  format: "avif" | "webp" | "jpeg";
  /** Present on ClientPhoto previews (a short-lived signed URL). */
  url?: string;
  /** Present on GalleryPhotoView previews; internal, never rendered. */
  objectPath?: string;
  bucket?: string;
}

export interface SlideshowPersonView {
  slug: string;
  displayName: string;
}

export interface SlideshowPhoto {
  id: string;
  eventSlug: string;
  eventName: string;
  source: "photographer" | "guest";
  orientation: "portrait" | "landscape" | "square";
  width: number;
  height: number;
  aspectRatio: number;
  capturedAt: string | null;
  people: SlideshowPersonView[];
  previews: SlideshowPreview[];
}

export interface SlideshowProps {
  photos: SlideshowPhoto[];
  modeLabel: string;
  startIndex?: number;
  intervalMs?: number;
  onClose?: () => void;
}

const DEFAULT_INTERVAL_MS = 5000;
const MIN_INTERVAL_MS = 2000;
const MAX_INTERVAL_MS = 15000;

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

function clampInterval(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_INTERVAL_MS;
  return Math.min(Math.max(Math.trunc(ms), MIN_INTERVAL_MS), MAX_INTERVAL_MS);
}

function largestPreviewUrl(photo: SlideshowPhoto): string | null {
  const withUrl = photo.previews.filter(
    (preview): preview is SlideshowPreview & { url: string } =>
      typeof preview.url === "string" && preview.url.length > 0,
  );
  if (withUrl.length === 0) return null;
  return [...withUrl].sort((a, b) => b.width - a.width)[0].url;
}

/** Mirrors useIsFavorite in FavoriteButton.tsx: getServerSnapshot always
 *  returns false, so SSR and the pre-hydration client render agree, and
 *  useSyncExternalStore syncs to the guest's real OS preference right after
 *  mount without a hydration warning or a setState-in-effect. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    useCallback((onStoreChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
      }
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onStoreChange);
      return () => query.removeEventListener("change", onStoreChange);
    }, []),
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false,
    () => false,
  );
}

/**
 * Full-screen slideshow over any ordered photo list. Wire the current
 * gallery filter results or the favorites list into this the same way
 * (`photos`), with a `modeLabel` describing which one ("All photos",
 * "Favorites", "My Weekend"). Respects prefers-reduced-motion by defaulting
 * to manual advance (never autoplaying) when the guest's OS requests it.
 */
export function Slideshow({
  photos,
  modeLabel,
  startIndex = 0,
  intervalMs = DEFAULT_INTERVAL_MS,
  onClose,
}: SlideshowProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(() => clampIndex(startIndex, photos.length));
  const [playing, setPlaying] = useState(() => !reducedMotion && photos.length > 1);
  const [showCaptions, setShowCaptions] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [interval_, setInterval_] = useState(() => clampInterval(intervalMs));

  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<Element | null>(null);
  const touchStartX = useRef<number | null>(null);

  // A photo list arriving after mount (e.g. favorites change while open)
  // should never leave the displayed photo pointing past the end. Derived
  // during render instead of a corrective effect: nothing writes `index`
  // except goTo/next/prev and the autoplay timer, which already re-clamp
  // against the current length, so it is only the *read* side that needs
  // the current length applied.
  const clampedIndex = clampIndex(index, photos.length);

  // Reduced motion should stop autoplay the instant the guest's OS reports
  // it (including arriving with it already on), but must not keep fighting
  // a manual Play press afterwards. That is a one-time reaction to
  // reducedMotion *changing*, not a continuous constraint, so it is adjusted
  // during render -- React's documented pattern for state that depends on a
  // changing value -- rather than in an effect.
  const [prevReducedMotion, setPrevReducedMotion] = useState(reducedMotion);
  if (reducedMotion !== prevReducedMotion) {
    setPrevReducedMotion(reducedMotion);
    if (reducedMotion) setPlaying(false);
  }

  const goTo = useCallback(
    (next: number) => {
      if (photos.length === 0) return;
      setIndex(clampIndex(next, photos.length));
    },
    [photos.length],
  );
  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  // Autoplay.
  useEffect(() => {
    if (!playing || photos.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => clampIndex(current + 1, photos.length));
    }, interval_);
    return () => window.clearInterval(timer);
  }, [playing, interval_, photos.length]);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === "undefined") return;
    try {
      if (!document.fullscreenElement && containerRef.current) {
        await containerRef.current.requestFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // Fullscreen denied or unsupported; the rest of the UI stays usable.
    }
  }, []);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Keyboard controls + focus trap, mirroring src/components/gallery/Lightbox.tsx.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
        return;
      }

      // The speed slider (an <input type="range">) needs its own native
      // Left/Right/Space/Home/End handling; a form control with focus always
      // wins those keys over the slideshow's global shortcuts. Tab still
      // needs the trap below regardless of focus.
      const activeTag = document.activeElement?.tagName;
      const formControlFocused =
        activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT";

      if (!formControlFocused && event.key === "ArrowLeft") {
        event.preventDefault();
        prev();
        return;
      }
      if (!formControlFocused && event.key === "ArrowRight") {
        event.preventDefault();
        next();
        return;
      }
      if (!formControlFocused && (event.key === " " || event.key === "Spacebar")) {
        event.preventDefault();
        setPlaying((current) => !current);
        return;
      }
      if (!formControlFocused && event.key.toLowerCase() === "c") {
        setShowCaptions((current) => !current);
        return;
      }
      if (!formControlFocused && event.key.toLowerCase() === "f") {
        void toggleFullscreen();
        return;
      }
      if (event.key === "Tab") {
        const root = containerRef.current;
        if (!root) return;
        const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement,
        );
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    [onClose, prev, next, toggleFullscreen],
  );

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    containerRef.current?.focus();
    document.addEventListener("keydown", handleKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = overflow;
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus();
      }
    };
  }, [handleKeyDown]);

  const photo = photos[clampedIndex] ?? null;
  const src = photo ? largestPreviewUrl(photo) : null;
  const caption = photo ? photo.people.map((person) => person.displayName).join(", ") : "";
  const dialogLabel = `${modeLabel} slideshow`;

  if (photos.length === 0) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={dialogLabel}
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-ink/95 p-6 text-center text-cream"
      >
        <p>There is nothing in {modeLabel} to show yet.</p>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-cream/30 bg-cream/10 px-4 py-2 text-sm hover:bg-cream/20"
          >
            Close
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={caption ? `${dialogLabel}: ${caption} at ${photo?.eventName}` : dialogLabel}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-ink text-cream"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStartX.current;
        touchStartX.current = null;
        if (start === null) return;
        const delta = (event.changedTouches[0]?.clientX ?? start) - start;
        if (delta > 60) prev();
        else if (delta < -60) next();
      }}
    >
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-cream/70">
            {modeLabel} &middot; {clampedIndex + 1} / {photos.length}
          </p>
          {showCaptions && (caption || photo?.eventName) ? (
            <h2 className="truncate text-lg font-medium">
              {caption ? `${caption} · ${photo?.eventName}` : photo?.eventName}
            </h2>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {photo ? (
            <FavoriteButton
              photoId={photo.id}
              label={caption || photo.eventName}
              className="static flex h-9 w-9 items-center justify-center rounded-full border border-cream/30 bg-cream/10 text-cream hover:bg-cream/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
            />
          ) : null}
          {photo ? (
            <DownloadOriginalButton
              photoId={photo.id}
              className="rounded-md border border-cream/30 bg-cream/10 px-3 py-1.5 text-sm text-cream hover:bg-cream/20"
            >
              Download
            </DownloadOriginalButton>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close slideshow"
              className="rounded-md border border-cream/30 bg-cream/10 px-3 py-1.5 text-sm hover:bg-cream/20"
            >
              Close
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {photos.length > 1 ? (
          <button
            type="button"
            onClick={prev}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 z-10 h-14 w-11 -translate-y-1/2 rounded-md border border-cream/25 bg-cream/10 text-2xl hover:bg-cream/20"
          >
            &lsaquo;
          </button>
        ) : null}

        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived and per-guest; next/image's remote loader is not worth wiring for a full-bleed slideshow view.
          <img
            src={src}
            alt={caption ? `${caption} at ${photo?.eventName}` : (photo?.eventName ?? "")}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <p className="text-sm text-cream/70">This preview is unavailable.</p>
        )}

        {photos.length > 1 ? (
          <button
            type="button"
            onClick={next}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 z-10 h-14 w-11 -translate-y-1/2 rounded-md border border-cream/25 bg-cream/10 text-2xl hover:bg-cream/20"
          >
            &rsaquo;
          </button>
        ) : null}
      </div>

      <SlideshowControls
        playing={playing}
        onTogglePlay={() => setPlaying((current) => !current)}
        onPrev={prev}
        onNext={next}
        disablePrevNext={photos.length < 2}
        showCaptions={showCaptions}
        onToggleCaptions={() => setShowCaptions((current) => !current)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => void toggleFullscreen()}
        intervalMs={interval_}
        onIntervalChange={(ms) => setInterval_(clampInterval(ms))}
        minIntervalMs={MIN_INTERVAL_MS}
        maxIntervalMs={MAX_INTERVAL_MS}
      />
    </div>
  );
}
