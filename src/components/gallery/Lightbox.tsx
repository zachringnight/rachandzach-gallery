"use client";

import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";

import { DownloadOriginalButton } from "@/components/downloads/DownloadOriginalButton";
import { FavoriteButton } from "@/components/favorites/FavoriteButton";
import { PhotoImage } from "@/components/gallery/PhotoImage";
import { SharePhotoButton } from "@/components/gallery/SharePhotoButton";
import { PhotoMemories } from "@/components/memories/PhotoMemories";
import { featureFlags } from "@/content/features";
import { favoriteStore } from "@/lib/favorites/store";
import type { ClientPhoto } from "@/lib/gallery/client-types";

export interface LightboxProps {
  photo: ClientPhoto;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  previousPhoto?: ClientPhoto;
  nextPhoto?: ClientPhoto;
  position?: number;
  total?: number;
  /** Optional slot for related photos etc., rendered under the caption. */
  footer?: React.ReactNode;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/**
 * Immersive, accessible photo dialog shared by the gallery, My Weekend,
 * Moment Search, favorites, and the deep-linked photo route.
 */
export function Lightbox({
  photo,
  onClose,
  onPrev,
  onNext,
  previousPhoto,
  nextPhoto,
  position,
  total,
  footer,
}: LightboxProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const downloadRef = useRef<HTMLAnchorElement | null>(null);
  const previouslyFocused = useRef<Element | null>(null);
  const swipeStart = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);

  const caption = photo.people.map((person) => person.displayName).join(", ");
  const accessibleLabel = caption
    ? `${caption} at ${photo.eventName}`
    : photo.eventName;

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
      if (!isTypingTarget(event.target) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        favoriteStore.toggle(photo.id);
        return;
      }
      if (!isTypingTarget(event.target) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        downloadRef.current?.click();
        return;
      }
      if (event.key !== "Tab") return;

      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter(
        (element) =>
          element.offsetParent !== null || element === document.activeElement,
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
    },
    [onClose, onNext, onPrev, photo.id],
  );

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    closeButtonRef.current?.focus();
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

  useEffect(() => {
    const preloaders = [previousPhoto, nextPhoto]
      .flatMap((candidate) => {
        const preview = candidate?.previews.reduce<
          ClientPhoto["previews"][number] | null
        >(
          (largest, preview) =>
            largest === null || preview.width > largest.width
              ? preview
              : largest,
          null,
        );
        return preview ? [preview] : [];
      })
      .map((preview) => {
        const image = new window.Image();
        image.decoding = "async";
        image.src = preview.url;
        return image;
      });

    return () => {
      for (const image of preloaders) image.src = "";
    };
  }, [nextPhoto, previousPhoto]);

  const showPosition =
    position !== undefined &&
    total !== undefined &&
    position > 0 &&
    total > 0;

  return (
    <div
      className="atlas-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={accessibleLabel}
      ref={dialogRef}
      tabIndex={-1}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="atlas-lightbox-header">
        <div className="atlas-lightbox-title">
          <p>{photo.eventName}</p>
          {caption ? <h2>{caption}</h2> : <h2>A moment from the weekend</h2>}
        </div>

        <div className="atlas-lightbox-tools">
          {showPosition ? (
            <span className="atlas-lightbox-position" aria-live="polite">
              {position} of {total}
            </span>
          ) : null}
          <FavoriteButton
            photoId={photo.id}
            label={caption || photo.eventName}
            className="atlas-lightbox-icon"
          />
          <DownloadOriginalButton
            photoId={photo.id}
            anchorRef={downloadRef}
            className="atlas-lightbox-control"
          >
            <Download aria-hidden="true" size={16} strokeWidth={1.7} />
            <span>Download</span>
          </DownloadOriginalButton>
          <SharePhotoButton photoId={photo.id} />
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="atlas-lightbox-icon"
            aria-label="Close"
          >
            <X aria-hidden="true" size={18} strokeWidth={1.7} />
          </button>
        </div>
      </header>

      <div
        className="atlas-lightbox-stage"
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" || (!onPrev && !onNext)) return;
          swipeStart.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          };
        }}
        onPointerUp={(event) => {
          const start = swipeStart.current;
          swipeStart.current = null;
          if (!start || start.pointerId !== event.pointerId) return;
          const deltaX = event.clientX - start.x;
          const deltaY = event.clientY - start.y;
          if (
            Math.abs(deltaX) < 48 ||
            Math.abs(deltaX) < Math.abs(deltaY) * 1.2
          ) {
            return;
          }
          if (deltaX > 0 && onPrev) onPrev();
          else if (deltaX < 0 && onNext) onNext();
        }}
        onPointerCancel={() => {
          swipeStart.current = null;
        }}
      >
        {onPrev ? (
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous photo"
            className="atlas-lightbox-arrow atlas-lightbox-arrow-prev"
          >
            <ChevronLeft aria-hidden="true" size={25} strokeWidth={1.35} />
          </button>
        ) : null}

        <figure className="atlas-lightbox-figure">
          <PhotoImage
            key={photo.id}
            photo={photo}
            alt={accessibleLabel}
            tier="lightbox"
            loading="eager"
            fetchPriority="high"
            className="atlas-lightbox-image"
            imageClassName="object-contain"
          />
        </figure>

        {onNext ? (
          <button
            type="button"
            onClick={onNext}
            aria-label="Next photo"
            className="atlas-lightbox-arrow atlas-lightbox-arrow-next"
          >
            <ChevronRight aria-hidden="true" size={25} strokeWidth={1.35} />
          </button>
        ) : null}
      </div>

      <div className="atlas-lightbox-notes">
        {photo.keywords.length > 0 ? (
          <ul aria-label="Keywords" className="atlas-keyword-list">
            {photo.keywords.map((keyword) => (
              <li key={keyword}>
                {featureFlags.momentSearch ? (
                  <Link href={`/my-weekend?q=${encodeURIComponent(keyword)}`}>
                    {keyword}
                  </Link>
                ) : (
                  <span>{keyword}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {footer ? <div className="atlas-lightbox-related">{footer}</div> : null}

        <div className="atlas-lightbox-memory">
          <span className="atlas-lightbox-margin-note">Leave a margin note</span>
          <PhotoMemories photoId={photo.id} />
        </div>

        <p className="atlas-lightbox-shortcuts" aria-hidden="true">
          Arrow keys to move · F to favorite · D to download · Esc to close
        </p>
      </div>
    </div>
  );
}
