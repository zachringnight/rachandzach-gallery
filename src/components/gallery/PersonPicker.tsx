"use client";

import { useMemo, useState } from "react";
import type { ClientGalleryFacets } from "@/lib/gallery/client-types";
import {
  faceCropCss,
  type ClientFaceDirectory,
  type ClientPersonFace,
} from "@/lib/people/face-types";

export interface PersonPickerProps {
  people: ClientGalleryFacets["people"];
  selected: string | null;
  onSelect: (slug: string | null) => void;
  /**
   * "chips" is the compact filter used inside the gallery control bar.
   * "faces" is the Find me picker: every guest, shown as a face.
   */
  variant?: "chips" | "faces";
  /**
   * How to draw each guest's face, supplied by an authenticated server
   * component (see buildFaceDirectory in src/lib/people/overrides.ts):
   * a hand-picked crop of a signed preview beats the committed automatic
   * crop at /faces/{slug}.webp; an absent entry falls back to initials.
   *
   * This deliberately does NOT import src/generated/face-thumbnails.json.
   * This is a "use client" module, so importing it compiled every guest's
   * name slug and face-confidence score into a /_next/static chunk -- and
   * src/proxy.ts serves that path without authentication, so the private
   * guest list was fetchable by anyone with the URL. Guest identities only
   * travel through gated server data.
   */
  faces?: ClientFaceDirectory;
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
  faces: faceDirectory,
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

  // The two variants do different jobs, so they announce different jobs. The
  // chip variant narrows the gallery ("Filter by person"); the face variant is
  // the Find me surface, where a guest is locating themselves, and hearing
  // "Filter by person" there misstates the page's purpose entirely.
  const purposeLabel = faces ? "Choose your name" : "Filter by person";
  const heading = faces ? "Find your name" : "People";

  return (
    <section
      aria-label={purposeLabel}
      className="atlas-picker atlas-person-picker"
      data-variant={variant}
    >
      <h2>{heading}</h2>
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
                // Keyed on the face, not just the slug: a re-signed URL or a
                // newly saved crop remounts the tile, which is what resets its
                // load-failure state without an effect.
                key={`${person.slug}:${faceKeyOf(faceDirectory?.[person.slug])}`}
                slug={person.slug}
                name={person.displayName}
                face={faceDirectory?.[person.slug] ?? null}
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
 * A guest's face. A hand-picked override (chosen in /admin/faces) CSS-crops
 * a signed preview at runtime -- Vercel's filesystem is read-only, so no
 * image is ever written; the crop is pure geometry over the already-signed
 * photo. Otherwise the committed automatic crop from
 * scripts/build-face-thumbnails.mjs renders, and guests the face pipeline
 * never resolved fall back to their initials, so the grid stays even rather
 * than punching holes where the data is thin.
 */
/** Identity of the face currently shown, used to key the tile. */
function faceKeyOf(face: ClientPersonFace | null | undefined): string {
  if (!face) return "none";
  return face.kind === "crop" ? `crop:${face.url}` : "committed";
}

function FaceTile({
  slug,
  name,
  face,
  active,
  onClick,
}: {
  slug: string;
  name: string;
  face: ClientPersonFace | null;
  active: boolean;
  onClick: () => void;
}) {
  // No effect resets these. A fresh signed URL deserves a fresh attempt, and
  // the call site keys this component on the face identity, so a changed face
  // remounts the tile and the flags start false again. Resetting from an
  // effect would setState during an effect body and cascade a render.
  const [cropFailed, setCropFailed] = useState(false);
  const [committedFailed, setCommittedFailed] = useState(false);

  const showCrop = face?.kind === "crop" && !cropFailed;
  // Only attempt the committed file for someone the directory says has a face:
  // either it IS the committed kind, or a crop just failed and a committed one
  // may sit underneath it. A person with no face at all goes straight to
  // initials rather than firing a request that 404s.
  const showCommitted =
    !showCrop &&
    !committedFailed &&
    (face?.kind === "committed" || face?.kind === "crop");

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
      <span
        className="atlas-face-tile-image"
        style={showCrop ? { position: "relative" } : undefined}
      >
        {showCrop ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={face.url}
            alt=""
            loading="lazy"
            decoding="async"
            // Signed preview URLs carry a TTL (an hour by default). The picker
            // is not rendered until a returning guest clicks "Not ...?", which
            // can be long after the page loaded, so this URL may already be
            // dead. Degrade to the committed crop, then to initials, rather
            // than showing a broken image.
            onError={() => setCropFailed(true)}
            style={{
              position: "absolute",
              maxWidth: "none",
              ...faceCropCss(face.crop, face.aspectRatio),
            }}
          />
        ) : showCommitted ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/faces/${slug}.webp`}
            alt=""
            width={192}
            height={192}
            loading="lazy"
            decoding="async"
            onError={() => setCommittedFailed(true)}
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
