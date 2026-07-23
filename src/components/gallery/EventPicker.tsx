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
    <section aria-label="Filter by event">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        Events
      </h2>
      <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-col sm:overflow-visible">
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
      className={`flex shrink-0 items-center justify-between gap-3 whitespace-nowrap rounded-full border px-3 py-2 text-left text-sm sm:w-full sm:rounded-md ${
        active
          ? "border-ink bg-ink text-cream"
          : "border-wheat bg-white text-ink hover:border-tan"
      }`}
    >
      <span className="truncate">{label}</span>
      {typeof count === "number" ? (
        <span className={active ? "text-cream/70" : "text-ink/50"}>{count}</span>
      ) : null}
    </button>
  );
}
