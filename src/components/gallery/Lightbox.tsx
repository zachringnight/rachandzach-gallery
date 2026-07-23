"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import type { ClientPhoto } from "@/lib/gallery/client-types";
import { featureFlags } from "@/content/features";
import { FavoriteButton } from "@/components/favorites/FavoriteButton";
import { PhotoMemories } from "@/components/memories/PhotoMemories";

export interface LightboxProps {
  photo: ClientPhoto;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** Optional slot for related photos etc., rendered under the caption. */
  footer?: React.ReactNode;
}

function largestPreviewUrl(photo: ClientPhoto): string | null {
  if (photo.previews.length === 0) return null;
  return [...photo.previews].sort((a, b) => b.width - a.width)[0].url;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

/**
 * Accessible photo dialog: focus-trapped, Escape to close, arrow keys and
 * swipe to page, and previous/next controls. Browser history is owned by the
 * caller (the URL ?photo= param), so back/forward simply moves the selection.
 */
export function Lightbox({ photo, onClose, onPrev, onNext, footer }: LightboxProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<Element | null>(null);
  const touchStartX = useRef<number | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && onPrev) {
        event.preventDefault();
        onPrev();
        return;
      }
      if (event.key === "ArrowRight" && onNext) {
        event.preventDefault();
        onNext();
        return;
      }
      if (event.key === "Tab") {
        const root = dialogRef.current;
        if (!root) return;
        const focusable = Array.from(
          root.querySelectorAll<HTMLElement>(FOCUSABLE),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
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
    [onClose, onPrev, onNext],
  );

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    dialogRef.current?.focus();
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

  const src = largestPreviewUrl(photo);
  const caption = photo.people.map((p) => p.displayName).join(", ");
  const keywords = photo.keywords;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-ink/95 p-4 text-cream"
      role="dialog"
      aria-modal="true"
      aria-label={caption ? `${caption} at ${photo.eventName}` : photo.eventName}
      ref={dialogRef}
      tabIndex={-1}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStartX.current;
        touchStartX.current = null;
        if (start === null) return;
        const delta = (event.changedTouches[0]?.clientX ?? start) - start;
        if (delta > 60 && onPrev) onPrev();
        else if (delta < -60 && onNext) onNext();
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-cream/70">
            {photo.eventName}
          </p>
          {caption ? (
            <h2 className="truncate text-lg font-medium">{caption}</h2>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Toolbar placement (not the default image overlay): the top info
              area sits outside the image box, so favoriting never shifts the
              photo layout. Same fixed 36px height as the Close button. */}
          <FavoriteButton
            photoId={photo.id}
            label={caption || photo.eventName}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-cream/30 bg-cream/10 text-cream hover:bg-cream/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
          />
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-cream/30 bg-cream/10 px-3 text-sm hover:bg-cream/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
            aria-label="Close"
          >
            Close
          </button>
        </div>
      </div>

      {keywords.length > 0 ? (
        <ul aria-label="Keywords" className="mt-2 flex flex-wrap gap-1.5">
          {keywords.map((keyword) =>
            featureFlags.momentSearch ? (
              <li key={keyword}>
                <Link
                  href={`/my-weekend?q=${encodeURIComponent(keyword)}`}
                  className="inline-block rounded-full bg-wheat px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-sand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
                >
                  {keyword}
                </Link>
              </li>
            ) : (
              <li key={keyword}>
                <span className="inline-block rounded-full bg-wheat px-2.5 py-1 text-xs font-medium text-ink">
                  {keyword}
                </span>
              </li>
            ),
          )}
        </ul>
      ) : null}

      <div className="relative flex min-h-0 flex-1 items-center justify-center py-4">
        {onPrev ? (
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 z-10 h-14 w-11 -translate-y-1/2 rounded-md border border-cream/25 bg-cream/10 text-2xl hover:bg-cream/20"
          >
            ‹
          </button>
        ) : null}

        {src ? (
          <img
            src={src}
            alt={caption ? `${caption} at ${photo.eventName}` : photo.eventName}
            width={photo.width}
            height={photo.height}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        ) : (
          <p className="text-sm text-cream/70">This preview is unavailable.</p>
        )}

        {onNext ? (
          <button
            type="button"
            onClick={onNext}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 z-10 h-14 w-11 -translate-y-1/2 rounded-md border border-cream/25 bg-cream/10 text-2xl hover:bg-cream/20"
          >
            ›
          </button>
        ) : null}
      </div>

      {footer ? <div className="shrink-0">{footer}</div> : null}

      {/* Memories wall (Round Two): every lightbox surface carries it, so it
          lives here rather than in each caller's footer slot. */}
      <div className="shrink-0">
        <PhotoMemories photoId={photo.id} />
      </div>
    </div>
  );
}
