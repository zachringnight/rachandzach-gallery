"use client";

import type { ClientGalleryFacets } from "@/lib/gallery/client-types";

export interface EventPickerProps {
  events: ClientGalleryFacets["events"];
  selected: string | null;
  onSelect: (slug: string | null) => void;
}

/**
 * Event filter. Horizontally scrollable on narrow screens so it never forces
 * the page to overflow at 390px.
 */
export function EventPicker({ events, selected, onSelect }: EventPickerProps) {
  if (events.length === 0) return null;
  return (
    <section aria-label="Filter by event" className="atlas-picker">
      <h2>
        Events
      </h2>
      <div className="atlas-picker-options">
        <Chip
          label="All events"
          active={selected === null}
          onClick={() => onSelect(null)}
        />
        {events.map((event) => (
          <Chip
            key={event.slug}
            label={event.name}
            count={event.count}
            active={selected === event.slug}
            onClick={() => onSelect(event.slug)}
          />
        ))}
      </div>
    </section>
  );
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="atlas-picker-chip"
      data-active={active ? "true" : "false"}
    >
      <span className="truncate">{label}</span>
      {typeof count === "number" ? (
        <span>{count}</span>
      ) : null}
    </button>
  );
}
