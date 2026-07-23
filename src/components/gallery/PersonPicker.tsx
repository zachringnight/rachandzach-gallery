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
    <section aria-label="Filter by person" className="atlas-picker atlas-person-picker">
      <h2>
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
        className="atlas-picker-search"
      />
      <div className="atlas-picker-options">
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
      className="atlas-picker-chip"
      data-active={active ? "true" : "false"}
    >
      <span className="truncate">{label}</span>
      {active && typeof count === "number" ? (
        <span>{count}</span>
      ) : null}
    </button>
  );
}
