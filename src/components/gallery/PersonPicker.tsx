"use client";

import { useMemo, useState } from "react";
import type { ClientGalleryFacets } from "@/lib/gallery/client-types";

export interface PersonPickerProps {
  people: ClientGalleryFacets["people"];
  selected: string | null;
  onSelect: (slug: string | null) => void;
}

/**
 * Person filter. Confirmed people only (the facet source already excludes
 * uncertain and background tags). A small type-ahead keeps a large guest list
 * usable without a giant chip wall.
 *
 * Photo counts are deliberately shown only on the selected person (Zach,
 * 2026-07-23): a resting chip wall that ranks guests by how many photos
 * they are in invites unhappy comparisons. Pick yourself, see your count.
 */
export function PersonPicker({ people, selected, onSelect }: PersonPickerProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const base = needle
      ? people.filter((p) => p.displayName.toLowerCase().includes(needle))
      : people;
    return base.slice(0, 40);
  }, [people, query]);

  if (people.length === 0) return null;

  return (
    <section aria-label="Filter by person">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        People
      </h2>
      <label className="sr-only" htmlFor="person-search">
        Search people
      </label>
      <input
        id="person-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search people"
        className="mb-2 w-full rounded-md border border-wheat bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
      />
      <div className="flex gap-2 overflow-x-auto pb-1 sm:max-h-72 sm:flex-col sm:overflow-y-auto sm:overflow-x-visible">
        <Chip
          label="Everyone"
          active={selected === null}
          onClick={() => onSelect(null)}
        />
        {filtered.map((person) => (
          <Chip
            key={person.slug}
            label={person.displayName}
            count={person.count}
            active={selected === person.slug}
            onClick={() => onSelect(person.slug)}
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
      {active && typeof count === "number" ? (
        <span className="text-cream/70">{count}</span>
      ) : null}
    </button>
  );
}
