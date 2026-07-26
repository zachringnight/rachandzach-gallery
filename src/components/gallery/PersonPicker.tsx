"use client";

import { useMemo, useState } from "react";
import type { ClientGalleryFacets } from "@/lib/gallery/client-types";
import faceThumbnails from "@/generated/face-thumbnails.json";

const FACES: Record<string, unknown> = faceThumbnails.people;

export interface PersonPickerProps {
  people: ClientGalleryFacets["people"];
  selected: string | null;
  onSelect: (slug: string | null) => void;
  /**
   * "chips" is the compact filter used inside the gallery control bar.
   * "faces" is the Find me picker: every guest, shown as a face.
   */
  variant?: "chips" | "faces";
}

/**
 * Person filter. Confirmed people only (the facet source already excludes
 * uncertain and background tags). A small type-ahead keeps a large guest list
 * usable without a giant chip wall.
 *
 * Photo counts are deliberately shown only on the selected person (Zach,
 * 2026-07-23): a resting chip wall that ranks guests by how many photos
 * they are in invites unhappy comparisons. Pick yourself, see your count.
 * That rule holds in both variants -- a face tile never carries a count.
 */
export function PersonPicker({
  people,
  selected,
  onSelect,
  variant = "chips",
}: PersonPickerProps) {
  const [query, setQuery] = useState("");
  const faces = variant === "faces";
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const base = needle
      ? people.filter((p) => p.displayName.toLowerCase().includes(needle))
      : people;
    // The chip variant caps the wall; the Find me variant must not, or a
    // guest late in the alphabet cannot find themselves without typing.
    return faces ? base : base.slice(0, 40);
  }, [people, query, faces]);

  if (people.length === 0) return null;

  return (
    <section
      aria-label="Filter by person"
      className="atlas-picker atlas-person-picker"
      data-variant={variant}
    >
      <h2>People</h2>
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
        {faces ? (
          <>
            <button
              type="button"
              onClick={() => onSelect(null)}
              aria-pressed={selected === null}
              className="atlas-face-tile atlas-face-tile-all"
              data-active={selected === null ? "true" : "false"}
            >
              <span className="atlas-face-tile-image" aria-hidden="true">
                Everyone
              </span>
              <span className="atlas-face-tile-name">Everyone</span>
            </button>
            {filtered.map((person) => (
              <FaceTile
                key={person.slug}
                slug={person.slug}
                name={person.displayName}
                active={selected === person.slug}
                onClick={() => onSelect(person.slug)}
              />
            ))}
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
      {faces && filtered.length === 0 ? (
        <p className="atlas-face-empty">
          No one by that name. Try a first name, or ask Rach or Zach to tag you.
        </p>
      ) : null}
    </section>
  );
}

/**
 * A guest's face, cropped at build time by scripts/build-face-thumbnails.mjs.
 * Guests the face pipeline never resolved fall back to their initials, so the
 * grid stays even rather than punching holes where the data is thin.
 */
function FaceTile({
  slug,
  name,
  active,
  onClick,
}: {
  slug: string;
  name: string;
  active: boolean;
  onClick: () => void;
}) {
  const hasFace = Object.hasOwn(FACES, slug);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("");

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="atlas-face-tile"
      data-active={active ? "true" : "false"}
    >
      <span className="atlas-face-tile-image">
        {hasFace ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/faces/${slug}.webp`}
            alt=""
            width={192}
            height={192}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span aria-hidden="true">{initials}</span>
        )}
      </span>
      <span className="atlas-face-tile-name">{name}</span>
    </button>
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
      {active && typeof count === "number" ? <span>{count}</span> : null}
    </button>
  );
}
