"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  NotebookPen,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { DownloadOriginalButton } from "@/components/downloads/DownloadOriginalButton";
import { FavoriteButton } from "@/components/favorites/FavoriteButton";
import { PhotoImage, pickTarget } from "@/components/gallery/PhotoImage";
import { SharePhotoButton } from "@/components/gallery/SharePhotoButton";
import { PhotoMemories } from "@/components/memories/PhotoMemories";
import { featureFlags } from "@/content/features";
import { favoriteStore } from "@/lib/favorites/store";
import type { ClientPhoto } from "@/lib/gallery/client-types";

export interface LightboxFilmstrip {
  /** Ordered photo list surrounding the open photo. */
  photos: ClientPhoto[];
  onSelect: (photoId: string) => void;
}

export interface LightboxProps {
  photo: ClientPhoto;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  previousPhoto?: ClientPhoto;
  nextPhoto?: ClientPhoto;
  position?: number;
  total?: number;
  /** Neighbouring frames rendered along the bottom edge (P2). */
  filmstrip?: LightboxFilmstrip;
  /** Optional slot for related photos etc., rendered inside the notes panel. */
  footer?: React.ReactNode;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

/**
 * Whether a control is actually rendered, for the focus trap.
 *
 * offsetParent alone is not enough: it only goes null for display:none, and
 * the closed Notes panel uses visibility:hidden, so its buttons stayed in the
 * trap's list. The trap then believed a hidden Notes control was its last
 * element, so tabbing off the last *visible* control was not intercepted and
 * focus could escape to the page behind the dialog.
 */
function isRenderedFocusable(element: HTMLElement): boolean {
  if (element.offsetParent === null) return false;
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({
      visibilityProperty: true,
      contentVisibilityAuto: true,
    } as CheckVisibilityOptions);
  }
  return getComputedStyle(element).visibility !== "hidden";
}

/** How long the pointer/keyboard must stay idle before the chrome fades. */
const CHROME_IDLE_MS = 2_000;

/** Neighbours rendered on each side of the active filmstrip frame. */
const FILMSTRIP_REACH = 8;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/** Mirrors usePrefersReducedMotion in Slideshow.tsx: getServerSnapshot always
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
 * Formats a capture timestamp for the caption in the weekend's own timezone.
 * Locale and zone are pinned so SSR (the deep-linked photo route) and the
 * client render identical text.
 */
function formatCaptureTime(capturedAt: string | null): string | null {
  if (!capturedAt) return null;
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Los_Angeles",
    }).format(date);
  } catch {
    return null;
  }
}

function smallestPreview(photo: ClientPhoto) {
  return photo.previews.reduce<ClientPhoto["previews"][number] | null>(
    (smallest, preview) =>
      smallest === null || preview.width < smallest.width ? preview : smallest,
    null,
  );
}

/**
 * Immersive, accessible photo dialog shared by the gallery, My Weekend,
 * Moment Search, favorites, and the deep-linked photo route.
 *
 * P2: the photograph is the surface. The image fills the viewport inside a
 * fixed minimum margin; the chrome (caption, tools, arrows, filmstrip)
 * overlays it and fades away after two seconds of inactivity, returning on
 * pointer movement or any key press. Reduced motion disables the fade.
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
  filmstrip,
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
  const suppressStageClick = useRef(false);

  const reducedMotion = usePrefersReducedMotion();
  const [chromeVisible, setChromeVisible] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const activeFrameRef = useRef<HTMLButtonElement | null>(null);
  const notesToggleRef = useRef<HTMLButtonElement | null>(null);
  const hideChromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleChromeHide = useCallback(() => {
    if (hideChromeTimer.current) clearTimeout(hideChromeTimer.current);
    // Reduced motion disables the fade entirely, and the chrome never fades
    // while the notes panel is open: its close control and form live in the
    // chrome layer.
    if (reducedMotion || notesOpen) return;
    // Nor on touch, where there is no way to bring it back. The fade is
    // driven by pointer idleness, and a finger emits no pointermove, so two
    // seconds after opening a photo every control was gone -- Close,
    // Download, Favorite, the arrows -- and tapping where Close used to be
    // lands outside the painted photo, which closes the lightbox instead of
    // restoring it. Exactly the moment a guest is trying to save a photo of
    // themselves.
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(hover: none)").matches
    ) {
      return;
    }
    hideChromeTimer.current = setTimeout(() => {
      // Never fade the chrome out from under the keyboard. A keyboard guest
      // lands on Close when the lightbox opens; hiding it after two idle
      // seconds took away the visible focused control and left them tabbing
      // blind, potentially into the page behind the dialog. The focusout
      // handler re-arms this once focus leaves the chrome.
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active.closest('[data-lightbox-chrome="true"]')
      ) {
        return;
      }
      setChromeVisible(false);
    }, CHROME_IDLE_MS);
  }, [notesOpen, reducedMotion]);

  const revealChrome = useCallback(() => {
    setChromeVisible(true);
    scheduleChromeHide();
  }, [scheduleChromeHide]);

  useEffect(() => {
    scheduleChromeHide();
    // Focus leaving the chrome re-arms the idle timer that the focus guard
    // above suppresses, so the chrome still fades once the keyboard moves on
    // rather than staying up for the rest of the session.
    const onFocusOut = () => {
      window.setTimeout(scheduleChromeHide, 0);
    };
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusout", onFocusOut);
      if (hideChromeTimer.current) clearTimeout(hideChromeTimer.current);
    };
  }, [scheduleChromeHide]);

  const caption = photo.people.map((person) => person.displayName).join(", ");
  const captureTime = formatCaptureTime(photo.capturedAt);
  const accessibleLabel = caption
    ? `${caption} at ${photo.eventName}`
    : photo.eventName;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      revealChrome();
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
          isRenderedFocusable(element) || element === document.activeElement,
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
    [onClose, onNext, onPrev, photo.id, revealChrome],
  );

  /**
   * Open once, restore once.
   *
   * This used to also carry the keydown listener, which put handleKeyDown in
   * its dependencies -- and handleKeyDown depends on revealChrome, which
   * depends on notesOpen. So every Notes toggle re-ran this whole effect and
   * re-focused the Close button, stealing focus from wherever the guest was.
   * Mount-only concerns and the listener are now separate.
   */
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    closeButtonRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const preloaders = [previousPhoto, nextPhoto]
      .flatMap((candidate) => {
        // Must resolve through the SAME selector the lightbox renders with.
        // This used to reduce on width alone, which ties for the widest tier
        // whenever more than one format exists at that width -- so the moment
        // a 2400 AVIF lands beside the 2400 JPEG, this would have warmed the
        // cache with whichever row came back first while the <img> requested
        // the other one, downloading both and preloading neither.
        const preview = candidate
          ? pickTarget(candidate.previews, "lightbox", 0)
          : null;
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

  const stripFrames = useMemo(() => {
    if (!filmstrip || filmstrip.photos.length < 2) return null;
    const index = filmstrip.photos.findIndex((frame) => frame.id === photo.id);
    if (index === -1) return null;
    const start = Math.max(0, index - FILMSTRIP_REACH);
    const end = Math.min(filmstrip.photos.length, index + FILMSTRIP_REACH + 1);
    return filmstrip.photos.slice(start, end);
  }, [filmstrip, photo.id]);

  /**
   * Keep the current frame visible in the filmstrip.
   *
   * The strip renders up to FILMSTRIP_REACH neighbours each side, so once a
   * guest is that far into the archive the active frame sits in the middle of
   * an overflowing rail that starts scrolled to 0. Without this, opening a
   * middle photo or stepping with the arrows left the current frame and every
   * forward neighbour off-screen until the guest scrolled the strip by hand.
   *
   * Centred inline, and never vertically: `block: "nearest"` stops this
   * scrolling the page itself. Jumps rather than animates under reduced
   * motion.
   */
  useEffect(() => {
    const active = activeFrameRef.current;
    if (!active) return;
    active.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [photo.id, reducedMotion, stripFrames]);

  return (
    <div
      className="atlas-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={accessibleLabel}
      ref={dialogRef}
      tabIndex={-1}
      data-chrome-visible={chromeVisible ? "true" : "false"}
      onPointerMove={revealChrome}
      onPointerDown={revealChrome}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
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
          suppressStageClick.current = true;
          if (deltaX > 0 && onPrev) onPrev();
          else if (deltaX < 0 && onNext) onNext();
        }}
        onPointerCancel={() => {
          swipeStart.current = null;
        }}
        onClick={(event) => {
          // The stage fills the viewport, so the dark letterbox around the
          // photograph is stage surface. A tap there still closes; a tap on
          // the painted photo (computed from the aspect ratio) does not.
          if (suppressStageClick.current) {
            suppressStageClick.current = false;
            return;
          }
          const figure = event.currentTarget.querySelector("figure");
          if (!figure) return;
          const box = figure.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return;
          const ratio = photo.aspectRatio > 0 ? photo.aspectRatio : 1;
          const boxRatio = box.width / box.height;
          const paintedWidth = boxRatio > ratio ? box.height * ratio : box.width;
          const paintedHeight =
            boxRatio > ratio ? box.height : box.width / ratio;
          const left = box.left + (box.width - paintedWidth) / 2;
          const top = box.top + (box.height - paintedHeight) / 2;
          const onPhoto =
            event.clientX >= left &&
            event.clientX <= left + paintedWidth &&
            event.clientY >= top &&
            event.clientY <= top + paintedHeight;
          if (!onPhoto) onClose();
        }}
      >
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
      </div>

      <header className="atlas-lightbox-header" data-lightbox-chrome="true">
        <div className="atlas-lightbox-title">
          <p className="atlas-lightbox-meta">
            <span>{photo.eventName}</span>
            {captureTime ? <span>{captureTime}</span> : null}
          </p>
          {/*
           * People sit on their own line in sentence case: a group frame can
           * carry ten names, and setting those in the uppercase utility voice
           * shouted over the photograph. The line truncates to keep the header
           * one row tall; the full list is in the Notes panel.
           */}
          {caption ? (
            <p className="atlas-lightbox-people" title={caption}>
              {caption}
            </p>
          ) : null}
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
            ref={notesToggleRef}
            type="button"
            onClick={() => {
              setNotesOpen((current) => !current);
              revealChrome();
            }}
            aria-expanded={notesOpen}
            aria-controls="lightbox-notes"
            className="atlas-lightbox-control"
          >
            <NotebookPen aria-hidden="true" size={16} strokeWidth={1.7} />
            <span>Notes</span>
          </button>
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

      {onPrev ? (
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous photo"
          className="atlas-lightbox-arrow atlas-lightbox-arrow-prev"
          data-lightbox-chrome="true"
        >
          <ChevronLeft aria-hidden="true" size={25} strokeWidth={1.35} />
        </button>
      ) : null}

      {onNext ? (
        <button
          type="button"
          onClick={onNext}
          aria-label="Next photo"
          className="atlas-lightbox-arrow atlas-lightbox-arrow-next"
          data-lightbox-chrome="true"
        >
          <ChevronRight aria-hidden="true" size={25} strokeWidth={1.35} />
        </button>
      ) : null}

      {stripFrames ? (
        <nav
          className="atlas-lightbox-filmstrip"
          aria-label="Nearby photos"
          data-lightbox-chrome="true"
        >
          {stripFrames.map((frame) => {
            const preview = smallestPreview(frame);
            const active = frame.id === photo.id;
            return (
              <button
                key={frame.id}
                ref={active ? activeFrameRef : undefined}
                type="button"
                onClick={() => {
                  if (!active) filmstrip?.onSelect(frame.id);
                }}
                aria-label={
                  active
                    ? "Current photo"
                    : `Open photo from ${frame.eventName}`
                }
                aria-current={active ? "true" : undefined}
                className="atlas-lightbox-frame"
                data-active={active ? "true" : "false"}
              >
                {preview ? (
                  <img
                    src={preview.url}
                    alt=""
                    width={preview.width}
                    height={preview.height}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span aria-hidden="true" />
                )}
              </button>
            );
          })}
        </nav>
      ) : null}

      <div
        id="lightbox-notes"
        className="atlas-lightbox-notes"
        data-open={notesOpen ? "true" : "false"}
      >
        <div className="atlas-lightbox-notes-head">
          <p>Notes</p>
          <button
            type="button"
            onClick={() => {
              setNotesOpen(false);
              // Return focus to the control that opened the panel. Closing
              // left focus on a button that visibility:hidden then removed
              // from the page, so focus fell to the body and the trap -- which
              // only wraps at its first or last visible control -- let the
              // next Tab escape to the page behind the dialog.
              notesToggleRef.current?.focus();
            }}
            className="atlas-lightbox-icon"
            aria-label="Close notes"
          >
            <X aria-hidden="true" size={16} strokeWidth={1.7} />
          </button>
        </div>

        {photo.approvedCaption ? (
          <blockquote className="atlas-lightbox-uploader-caption">
            <p>{photo.approvedCaption.text}</p>
            {photo.approvedCaption.byline ? (
              <footer>Shared by {photo.approvedCaption.byline}</footer>
            ) : null}
          </blockquote>
        ) : null}

        {photo.people.length > 0 ? (
          <div className="atlas-lightbox-note-block">
            <p className="atlas-kicker">In this photo</p>
            <p className="atlas-lightbox-note-people">{caption}</p>
          </div>
        ) : null}

        {photo.keywords.length > 0 ? (
          <ul aria-label="Keywords" className="atlas-keyword-list">
            {photo.keywords.map((keyword) => (
              <li key={keyword}>
                {featureFlags.momentSearch ? (
                  <Link href={`/photos?q=${encodeURIComponent(keyword)}`}>
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
