"use client";

import { Check } from "lucide-react";

import { PhotoImage } from "@/components/gallery/PhotoImage";
import type { ClientPhoto } from "@/lib/gallery/client-types";

export interface ContactStackCardProps {
  /** Loaded frames of the burst, archive order; the first is the face. */
  photos: ClientPhoto[];
  /** Full burst size within the result set (may exceed loaded frames). */
  size: number;
  /** Rendered pixel size from the justified layout. */
  width: number;
  height: number;
  onExpand: () => void;
  selecting?: boolean;
  /** True when every loaded frame of the burst is selected. */
  selected?: boolean;
  /** True when some but not all loaded frames are selected. */
  partiallySelected?: boolean;
  /** Toggle selection for the whole burst. */
  onToggleSelection?: () => void;
}

/**
 * One collapsed contact-sheet stack (design upgrade P4): the burst's first
 * frame with a stacked film edge and the frame count set in the archive's
 * utility voice. Activating the card fans the burst out inline; in
 * selection mode it selects every loaded frame at once.
 */
export function ContactStackCard({
  photos,
  size,
  width,
  height,
  onExpand,
  selecting = false,
  selected = false,
  partiallySelected = false,
  onToggleSelection,
}: ContactStackCardProps) {
  const face = photos[0];
  const label = face.people.map((person) => person.displayName).join(", ");
  const describe = label
    ? `${size} frames from ${face.eventName} with ${label}`
    : `${size} frames from ${face.eventName}`;

  return (
    <div
      className="atlas-stack-card"
      style={{ width, height }}
      data-selecting={selecting ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      data-partial={partiallySelected ? "true" : "false"}
    >
      <button
        type="button"
        className="atlas-stack-open"
        // No aria-expanded: this is not a disclosure control. Expanding
        // replaces the stack with its individual frames, so this button does
        // not persist in an expanded state, and a permanently "false" value
        // just tells assistive tech the wrong thing. The label carries the
        // affordance instead.
        aria-label={
          selecting
            ? `${selected ? "Deselect" : "Select"} ${describe}`
            : `Expand ${describe}`
        }
        onClick={() => {
          if (selecting && onToggleSelection) onToggleSelection();
          else onExpand();
        }}
      >
        <PhotoImage
          photo={face}
          alt={label ? `${label} at ${face.eventName}` : face.eventName}
          tier="card"
          targetWidth={width}
          className="h-full w-full"
          imageClassName="h-full w-full object-cover"
        />
      </button>

      <span className="atlas-stack-count" aria-hidden="true">
        {size} frames
      </span>

      {onToggleSelection ? (
        <button
          type="button"
          className="atlas-photo-select atlas-stack-select"
          aria-label={`${selected ? "Deselect" : "Select"} ${describe}`}
          aria-pressed={selected}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleSelection();
          }}
        >
          <Check aria-hidden="true" size={15} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}
