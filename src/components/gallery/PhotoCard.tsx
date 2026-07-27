"use client";

import { Check, Download } from "lucide-react";
import { useCallback, useRef } from "react";

import { DownloadOriginalButton } from "@/components/downloads/DownloadOriginalButton";
import { FavoriteButton } from "@/components/favorites/FavoriteButton";
import { PhotoImage } from "@/components/gallery/PhotoImage";
import type { ClientPhoto } from "@/lib/gallery/client-types";

export interface PhotoCardProps {
  photo: ClientPhoto;
  /** Rendered pixel size from the justified layout (avoids layout shift). */
  width: number;
  height: number;
  onOpen: (photoId: string) => void;
  /** Optional caller-owned control rendered in the selection affordance slot. */
  selectionSlot?: React.ReactNode;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelection?: (photoId: string) => void;
  onStartSelection?: (photoId: string) => void;
}

function names(photo: ClientPhoto): string {
  return photo.people.map((person) => person.displayName).join(", ");
}

/**
 * One photo in the justified grid.
 *
 * The open target, favorite, original-download, and selection controls are
 * siblings so buttons never nest. A deliberate long press starts selection
 * on touch devices; ordinary taps continue to open the shared lightbox.
 */
export function PhotoCard({
  photo,
  width,
  height,
  onOpen,
  selectionSlot,
  selecting = false,
  selected = false,
  onToggleSelection,
  onStartSelection,
}: PhotoCardProps) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressOpen = useRef(false);
  const label = names(photo);
  const subject = label || photo.eventName;

  const cancelLongPress = useCallback(() => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }, []);

  const beginLongPress = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!onStartSelection || event.pointerType === "mouse") return;
      cancelLongPress();
      pressTimer.current = setTimeout(() => {
        suppressOpen.current = true;
        onStartSelection(photo.id);
      }, 480);
    },
    [cancelLongPress, onStartSelection, photo.id],
  );

  const handleOpen = useCallback(() => {
    cancelLongPress();
    if (suppressOpen.current) {
      suppressOpen.current = false;
      return;
    }
    if (selecting && onToggleSelection) {
      onToggleSelection(photo.id);
      return;
    }
    onOpen(photo.id);
  }, [cancelLongPress, onOpen, onToggleSelection, photo.id, selecting]);

  return (
    <div
      className="atlas-photo-card group relative"
      style={{ width, height }}
      // The shell reads this card's rect on open so the lightbox can expand
      // out of the frame that was clicked.
      data-photo-id={photo.id}
      data-selecting={selecting ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
    >
      <button
        type="button"
        onClick={handleOpen}
        onPointerDown={beginLongPress}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onPointerLeave={cancelLongPress}
        className="atlas-photo-open"
        role={selecting ? "checkbox" : undefined}
        aria-checked={selecting ? selected : undefined}
        aria-label={
          selecting
            ? `${selected ? "Deselect" : "Select"} photo from ${photo.eventName}${
                label ? ` with ${label}` : ""
              }`
            : label
              ? `Open photo from ${photo.eventName} with ${label}`
              : `Open photo from ${photo.eventName}`
        }
      >
        <PhotoImage
          photo={photo}
          alt={label ? `${label} at ${photo.eventName}` : photo.eventName}
          tier="card"
          targetWidth={width}
          className="h-full w-full"
          imageClassName="h-full w-full object-cover"
        />
      </button>

      {selectionSlot ?? (
        onToggleSelection && onStartSelection ? (
          <button
            type="button"
            className="atlas-photo-select"
            aria-label={`${selected ? "Deselect" : "Select"} ${subject}`}
            aria-pressed={selected}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!selecting) onStartSelection(photo.id);
              else onToggleSelection(photo.id);
            }}
          >
            <Check aria-hidden="true" size={15} strokeWidth={2} />
          </button>
        ) : null
      )}

      <FavoriteButton
        photoId={photo.id}
        label={subject}
        className="atlas-photo-favorite"
      />

      <DownloadOriginalButton
        photoId={photo.id}
        className="atlas-photo-download"
        ariaLabel={`Download ${subject}`}
        title="Download original"
      >
        <Download aria-hidden="true" size={15} strokeWidth={1.7} />
      </DownloadOriginalButton>
    </div>
  );
}
