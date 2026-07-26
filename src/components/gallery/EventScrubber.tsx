"use client";

import { useState } from "react";

import type { ClientPhoto } from "@/lib/gallery/client-types";

export interface EventBoundary {
  slug: string;
  name: string;
  /** Index of the first currently-loaded photo in this event. */
  photoIndex: number;
}

export function computeEventBoundaries(
  photos: readonly ClientPhoto[],
): EventBoundary[] {
  const seen = new Set<string>();
  const boundaries: EventBoundary[] = [];
  photos.forEach((photo, photoIndex) => {
    if (seen.has(photo.eventSlug)) return;
    seen.add(photo.eventSlug);
    boundaries.push({
      slug: photo.eventSlug,
      name: photo.eventName,
      photoIndex,
    });
  });
  return boundaries;
}

export interface EventScrubberProps {
  boundaries: EventBoundary[];
  onJump: (photoIndex: number) => void;
}

/**
 * Fast event navigation for the loaded gallery range. The visible rail is
 * pointer-friendly; a native select mirrors it for keyboard and screen-reader
 * users. Boundaries grow as pagination loads more photos.
 */
export function EventScrubber({
  boundaries,
  onJump,
}: EventScrubberProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  if (boundaries.length < 2) return null;

  const safeIndex = Math.min(activeIndex, boundaries.length - 1);
  const active = boundaries[safeIndex];

  const jump = (index: number) => {
    const next = Math.max(0, Math.min(index, boundaries.length - 1));
    setActiveIndex(next);
    onJump(boundaries[next].photoIndex);
  };

  return (
    <nav className="atlas-event-scrubber" aria-label="Jump through the archive by event">
      <div className="atlas-event-scrubber-heading">
        <span>Archive index</span>
        <strong aria-live="polite">{active.name}</strong>
      </div>

      <div className="atlas-event-scrubber-rail">
        <span className="atlas-event-scrubber-line" aria-hidden="true" />
        {boundaries.map((boundary, index) => (
          <button
            key={boundary.slug}
            type="button"
            className="atlas-event-marker"
            data-active={index === safeIndex ? "true" : "false"}
            onClick={() => jump(index)}
            aria-label={`Jump to ${boundary.name}`}
            title={boundary.name}
          >
            <span aria-hidden="true" />
          </button>
        ))}
        <input
          type="range"
          min={0}
          max={boundaries.length - 1}
          value={safeIndex}
          onChange={(event) => jump(Number(event.target.value))}
          aria-label="Scrub by event"
        />
      </div>

      <label className="sr-only">
        Jump to event
        <select
          value={active.slug}
          onChange={(event) => {
            const index = boundaries.findIndex(
              (boundary) => boundary.slug === event.target.value,
            );
            if (index >= 0) jump(index);
          }}
        >
          {boundaries.map((boundary) => (
            <option key={boundary.slug} value={boundary.slug}>
              {boundary.name}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
