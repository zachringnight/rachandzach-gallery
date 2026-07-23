"use client";

import { CheckSquare, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

import type {
  ClientGalleryFacets,
  ClientOrientation,
  ClientSource,
  GalleryFilterState,
} from "@/lib/gallery/client-types";
import { EventPicker } from "@/components/gallery/EventPicker";
import { PersonPicker } from "@/components/gallery/PersonPicker";

export interface FilterBarProps {
  facets: ClientGalleryFacets;
  filters: GalleryFilterState;
  total: number;
  onChange: (patch: Partial<GalleryFilterState>) => void;
  onReset: () => void;
  selecting?: boolean;
  selectedCount?: number;
  onStartSelection?: () => void;
}

const ORIENTATIONS: { value: ClientOrientation; label: string }[] = [
  { value: "landscape", label: "Landscape" },
  { value: "portrait", label: "Portrait" },
  { value: "square", label: "Square" },
];

const SOURCES: { value: ClientSource; label: string }[] = [
  { value: "photographer", label: "Photographer" },
  { value: "guest", label: "Guests" },
];

/**
 * Sticky on desktop (a left rail), compact and horizontally scrollable on
 * mobile. Every control writes straight to the shared filter state, which the
 * shell reflects into the URL.
 */
export function FilterBar({
  facets,
  filters,
  total,
  onChange,
  onReset,
  selecting = false,
  selectedCount = 0,
  onStartSelection,
}: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const hasFilters =
    filters.person !== null ||
    filters.event !== null ||
    filters.orientation !== null ||
    filters.source !== null;

  return (
    <aside className="atlas-filter-rail">
      <div className="atlas-filter-summary">
        <p aria-live="polite">
          <strong>{total.toLocaleString()}</strong>
          {total === 1 ? " photo" : " photos"}
        </p>

        <div className="atlas-filter-summary-actions">
          {onStartSelection ? (
            <button
              type="button"
              onClick={onStartSelection}
              aria-pressed={selecting}
              className="atlas-filter-action"
            >
              <CheckSquare aria-hidden="true" size={15} strokeWidth={1.6} />
              {selecting
                ? `${selectedCount.toLocaleString()} selected`
                : "Select"}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls="gallery-filter-groups"
            className="atlas-filter-action"
          >
            <SlidersHorizontal
              aria-hidden="true"
              size={15}
              strokeWidth={1.6}
            />
            Filters
          </button>

          {hasFilters ? (
            <button
              type="button"
              onClick={onReset}
              className="atlas-filter-action"
            >
              <X aria-hidden="true" size={15} strokeWidth={1.6} />
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div
        id="gallery-filter-groups"
        className="atlas-filter-groups"
        data-open={open ? "true" : "false"}
      >
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Sort
          </legend>
          <div className="flex gap-2">
            <Toggle
              label="Weekend order"
              active={filters.sort === "weekend"}
              onClick={() => onChange({ sort: "weekend" })}
            />
            <Toggle
              label="Newest"
              active={filters.sort === "newest"}
              onClick={() => onChange({ sort: "newest" })}
            />
          </div>
        </fieldset>

        <EventPicker
          events={facets.events}
          selected={filters.event}
          onSelect={(event) => onChange({ event })}
        />

        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Orientation
          </legend>
          <div className="flex flex-wrap gap-2">
            {ORIENTATIONS.map((option) => (
              <Toggle
                key={option.value}
                label={option.label}
                active={filters.orientation === option.value}
                onClick={() =>
                  onChange({
                    orientation:
                      filters.orientation === option.value ? null : option.value,
                  })
                }
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Source
          </legend>
          <div className="flex flex-wrap gap-2">
            {SOURCES.map((option) => (
              <Toggle
                key={option.value}
                label={option.label}
                active={filters.source === option.value}
                onClick={() =>
                  onChange({
                    source:
                      filters.source === option.value ? null : option.value,
                  })
                }
              />
            ))}
          </div>
        </fieldset>

        <PersonPicker
          people={facets.people}
          selected={filters.person}
          onSelect={(person) => onChange({ person })}
        />
      </div>
    </aside>
  );
}

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
        active
          ? "atlas-filter-toggle atlas-filter-toggle-active"
          : "atlas-filter-toggle"
      }`}
    >
      {label}
    </button>
  );
}
