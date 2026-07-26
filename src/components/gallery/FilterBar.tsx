"use client";

import { CheckSquare, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  ClientGalleryFacets,
  ClientOrientation,
  ClientSource,
  GalleryFilterState,
} from "@/lib/gallery/client-types";
import { EventPicker } from "@/components/gallery/EventPicker";
import { PersonPicker } from "@/components/gallery/PersonPicker";
import { CopyCurrentViewButton } from "@/components/ui/CopyCurrentViewButton";

export interface FilterBarProps {
  facets: ClientGalleryFacets;
  filters: GalleryFilterState;
  total: number;
  onChange: (patch: Partial<GalleryFilterState>) => void;
  onReset: () => void;
  selecting?: boolean;
  selectedCount?: number;
  onStartSelection?: () => void;
  /** Optional Moment Search panel, toggled from the control bar. */
  momentSearchSlot?: React.ReactNode;
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
 * P1 control bar: a single compact row (search, active-filter chips,
 * actions) that stays docked below the site header at every scroll depth.
 * The full filter groups and the optional Moment Search panel expand from
 * the same docked bar. Every control writes straight to the shared filter
 * state, which the shell reflects into the URL.
 */
export function FilterBar({
  facets,
  filters,
  onChange,
  onReset,
  selecting = false,
  selectedCount = 0,
  onStartSelection,
  momentSearchSlot,
}: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const [momentOpen, setMomentOpen] = useState(false);
  const activeFilterCount = [
    filters.q,
    filters.person,
    filters.event,
    filters.orientation,
    filters.source,
  ].filter(Boolean).length;
  const hasFilters =
    filters.q !== "" ||
    filters.person !== null ||
    filters.event !== null ||
    filters.orientation !== null ||
    filters.source !== null;

  const activeFilters = useMemo(() => {
    const chips: {
      key: keyof GalleryFilterState;
      label: string;
      patch: Partial<GalleryFilterState>;
    }[] = [];
    if (filters.q) {
      chips.push({
        key: "q",
        label: `Search: ${filters.q}`,
        patch: { q: "" },
      });
    }
    if (filters.event) {
      const event = facets.events.find((item) => item.slug === filters.event);
      chips.push({
        key: "event",
        label: event?.name ?? filters.event,
        patch: { event: null },
      });
    }
    if (filters.person) {
      const person = facets.people.find((item) => item.slug === filters.person);
      chips.push({
        key: "person",
        label: person?.displayName ?? filters.person,
        patch: { person: null },
      });
    }
    if (filters.orientation) {
      chips.push({
        key: "orientation",
        label:
          ORIENTATIONS.find((item) => item.value === filters.orientation)
            ?.label ?? filters.orientation,
        patch: { orientation: null },
      });
    }
    if (filters.source) {
      chips.push({
        key: "source",
        label:
          SOURCES.find((item) => item.value === filters.source)?.label ??
          filters.source,
        patch: { source: null },
      });
    }
    return chips;
  }, [facets.events, facets.people, filters]);

  return (
    <aside className="atlas-filter-rail">
      <div className="atlas-control-row">
        <GallerySearchField
          key={filters.q}
          value={filters.q}
          onChange={(q) => onChange({ q })}
        />

        {activeFilters.length > 0 ? (
          <div className="atlas-active-filters" aria-label="Active filters">
            {activeFilters.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => {
                  onChange(chip.patch);
                }}
                className="atlas-active-filter"
                aria-label={`Remove filter: ${chip.label}`}
              >
                <span>{chip.label}</span>
                <X aria-hidden="true" size={13} strokeWidth={1.7} />
              </button>
            ))}
          </div>
        ) : null}

        <div className="atlas-control-actions">
          <CopyCurrentViewButton className="atlas-filter-action" />

          {onStartSelection ? (
            <button
              type="button"
              onClick={onStartSelection}
              aria-pressed={selecting}
              aria-label={
                selecting
                  ? `${selectedCount.toLocaleString()} selected`
                  : "Select"
              }
              className="atlas-filter-action"
            >
              <CheckSquare aria-hidden="true" size={15} strokeWidth={1.6} />
              <span>
                {selecting
                  ? `${selectedCount.toLocaleString()} selected`
                  : "Select"}
              </span>
            </button>
          ) : null}

          {momentSearchSlot ? (
            <button
              type="button"
              onClick={() => {
                setMomentOpen((current) => {
                  if (!current) setOpen(false);
                  return !current;
                });
              }}
              aria-expanded={momentOpen}
              aria-controls="gallery-moment-search"
              aria-label="Moment search"
              className="atlas-filter-action"
            >
              <Sparkles aria-hidden="true" size={15} strokeWidth={1.6} />
              <span>Moments</span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setOpen((current) => {
                if (!current) setMomentOpen(false);
                return !current;
              });
            }}
            aria-expanded={open}
            aria-controls="gallery-filter-groups"
            aria-label={
              activeFilterCount > 0
                ? `Filters, ${activeFilterCount} active`
                : "Filters"
            }
            className="atlas-filter-action"
          >
            <SlidersHorizontal
              aria-hidden="true"
              size={15}
              strokeWidth={1.6}
            />
            <span>Filters</span>
            {activeFilterCount > 0 ? (
              <span
                className="atlas-filter-count"
                aria-label={`${activeFilterCount} active ${
                  activeFilterCount === 1 ? "filter" : "filters"
                }`}
              >
                {activeFilterCount}
              </span>
            ) : null}
          </button>

          {hasFilters ? (
            <button
              type="button"
              onClick={onReset}
              aria-label="Clear filters"
              className="atlas-filter-action"
            >
              <X aria-hidden="true" size={15} strokeWidth={1.6} />
              <span>Clear</span>
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
          <div className="flex flex-wrap gap-2">
            <Toggle
              label="Chronological"
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

      {momentSearchSlot ? (
        <div
          id="gallery-moment-search"
          className="atlas-moment-panel"
          data-open={momentOpen ? "true" : "false"}
        >
          {momentOpen ? momentSearchSlot : null}
        </div>
      ) : null}
    </aside>
  );
}

function GallerySearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (query: string) => void;
}) {
  const [query, setQuery] = useState(value);

  useEffect(() => {
    const normalized = query.trim().replace(/\s+/g, " ");
    if (normalized === value) return;
    const timer = window.setTimeout(() => onChange(normalized), 250);
    return () => window.clearTimeout(timer);
  }, [onChange, query, value]);

  return (
    <label className="atlas-gallery-search">
      <Search aria-hidden="true" size={17} strokeWidth={1.6} />
      <span className="sr-only">Search photos</span>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        maxLength={120}
        placeholder="Search names, events, tags"
        autoComplete="off"
      />
      {query ? (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            onChange("");
          }}
          aria-label="Clear photo search"
          title="Clear search"
        >
          <X aria-hidden="true" size={15} strokeWidth={1.6} />
        </button>
      ) : null}
    </label>
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
