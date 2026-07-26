"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ClientPhoto,
  ClientTimeline,
  ClientTimelineSegment,
} from "@/lib/gallery/client-types";

export interface LightBarProps {
  /**
   * The full filtered archive's timeline from the server. When null (e.g.
   * after a degraded response) the rail derives from the loaded photos'
   * per-photo light so it never invents a hand-authored gradient.
   */
  timeline: ClientTimeline | null;
  /** Loaded contiguous prefix of the archive order. */
  photos: readonly ClientPhoto[];
  /** Index of the first photograph currently on screen. */
  currentIndex: number;
  /** Jump the grid (loading intermediate pages when needed). */
  onJump: (photoIndex: number) => void;
  /** True while a jump is still paging toward its target. */
  jumping?: boolean;
}

/**
 * The Light Bar (design upgrade P3): the whole archive mapped onto the arc
 * of the day, tinted by the dominant light sampled from the photographs in
 * each window. Vertical rail on desktop, horizontal band above the grid on
 * mobile (CSS switches the axis; the DOM is one element).
 *
 * Accessibility mirrors the retired EventScrubber's pattern: the visible
 * rail is pointer-friendly, an invisible labelled range input spans it for
 * keyboard scrubbing, and a visually hidden select lists the events.
 *
 * Pointer routing: the range sits ABOVE the segments (it is what makes
 * drag-scrubbing and keyboard scrubbing work), so segment buttons never see
 * a mouse click -- document.elementFromPoint over a segment returns the
 * range. The rail therefore watches the pointer itself: a press that stays
 * within the click slop is a click on the named segment under it and jumps
 * to that segment's START (exactly what the button's own handler does; the
 * button remains the keyboard path), while a press that travels is a drag
 * and is left to the range's native scrubbing.
 */

/** Pointer travel (px) beyond which a press counts as a drag, not a click. */
const CLICK_SLOP_PX = 8;
export function LightBar({
  timeline,
  photos,
  currentIndex,
  onJump,
  jumping = false,
}: LightBarProps) {
  const derived = useMemo(
    () => timeline ?? deriveTimelineFromPhotos(photos),
    [timeline, photos],
  );
  const { segments, total } = derived;

  // Scrub commits are debounced so dragging the range (or holding an arrow
  // key) settles before the grid starts paging toward a far target.
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  // Pointer position over the rail, as a fraction of the day; drives the
  // hover flag naming the chapter under the pointer.
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Live press being judged click-vs-drag (see pointer routing above). */
  const pressRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  useEffect(
    () => () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    [],
  );

  if (segments.length < 2 || total === 0) return null;

  const value = scrubValue ?? Math.min(currentIndex, total - 1);
  const activeSegment =
    findSegment(segments, value) ?? segments[0];

  const scrubTo = (nextValue: number) => {
    const clamped = Math.max(0, Math.min(nextValue, total - 1));
    setScrubValue(clamped);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      setScrubValue(null);
      onJump(clamped);
    }, 220);
  };

  const thumbPercent = ((value + 0.5) / total) * 100;

  // While scrubbing, the flag follows the scrub value; otherwise it names
  // whatever the pointer is over.
  const flagFraction =
    scrubValue !== null ? (scrubValue + 0.5) / total : hoverAt;
  const flagSegment =
    flagFraction !== null
      ? findSegment(
          segments,
          Math.min(total - 1, Math.floor(flagFraction * total)),
        )
      : null;

  /** Fraction of the day under a pointer position, respecting the axis. */
  const railFraction = (clientX: number, clientY: number): number | null => {
    const rect = railRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const vertical = rect.height >= rect.width;
    const fraction = vertical
      ? (clientY - rect.top) / rect.height
      : (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(0.999, fraction));
  };

  const trackPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    if (press && press.pointerId === event.pointerId && !press.moved) {
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (dx * dx + dy * dy > CLICK_SLOP_PX * CLICK_SLOP_PX) {
        press.moved = true;
      }
    }
    const fraction = railFraction(event.clientX, event.clientY);
    if (fraction !== null) setHoverAt(fraction);
  };

  const beginPress = (event: React.PointerEvent<HTMLDivElement>) => {
    pressRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  };

  const endPress = (event: React.PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || press.pointerId !== event.pointerId || press.moved) return;
    const fraction = railFraction(event.clientX, event.clientY);
    if (fraction === null) return;
    const segment = findSegment(
      segments,
      Math.min(total - 1, Math.floor(fraction * total)),
    );
    if (!segment) return;
    // A clean click, not a scrub: drop the approximate scrub the range's
    // own pointerdown already queued, and jump to the segment's start.
    if (commitTimer.current) clearTimeout(commitTimer.current);
    setScrubValue(null);
    onJump(segment.start);
  };

  return (
    <nav
      className="atlas-light-bar"
      aria-label="The day in light"
      data-busy={jumping ? "true" : "false"}
    >
      <div
        ref={railRef}
        className="atlas-light-bar-rail"
        onPointerDown={beginPress}
        onPointerUp={endPress}
        onPointerCancel={() => {
          pressRef.current = null;
        }}
        onPointerMove={trackPointer}
        onPointerLeave={() => setHoverAt(null)}
      >
        {segments.map((segment) => (
          <button
            key={`${segment.slug}-${segment.start}`}
            type="button"
            className="atlas-light-bar-segment"
            style={{
              flexGrow: segment.count,
              ["--rz-light-stops" as string]: gradientStops(segment),
            }}
            data-active={segment === activeSegment ? "true" : "false"}
            aria-label={`Jump to ${segment.name}`}
            aria-current={segment === activeSegment ? "true" : undefined}
            title={segment.name}
            onClick={() => onJump(segment.start)}
          >
            <span aria-hidden="true" />
          </button>
        ))}
        <span
          className="atlas-light-bar-thumb"
          style={{ ["--rz-light-thumb" as string]: `${thumbPercent}%` }}
          aria-hidden="true"
        />
        {flagSegment && flagFraction !== null ? (
          <span
            className="atlas-light-bar-flag"
            style={{
              ["--rz-light-flag" as string]: `${flagFraction * 100}%`,
            }}
            aria-hidden="true"
          >
            {flagSegment.name}
          </span>
        ) : null}
        <input
          type="range"
          min={0}
          max={total - 1}
          value={value}
          onChange={(event) => scrubTo(Number(event.target.value))}
          aria-label="Scrub through the day"
          aria-valuetext={`${activeSegment.name}, photograph ${value + 1} of ${total}`}
        />
      </div>

      <label className="sr-only">
        Jump to event
        <select
          value={`${activeSegment.slug}-${activeSegment.start}`}
          onChange={(event) => {
            const segment = segments.find(
              (candidate) =>
                `${candidate.slug}-${candidate.start}` === event.target.value,
            );
            if (segment) onJump(segment.start);
          }}
        >
          {segments.map((segment) => (
            <option
              key={`${segment.slug}-${segment.start}`}
              value={`${segment.slug}-${segment.start}`}
            >
              {segment.name}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}

function findSegment(
  segments: readonly ClientTimelineSegment[],
  photoIndex: number,
): ClientTimelineSegment | null {
  let match: ClientTimelineSegment | null = null;
  for (const segment of segments) {
    if (segment.start <= photoIndex) match = segment;
    else break;
  }
  return match;
}

/**
 * CSS gradient stop list for one segment, straight from sampled light. A
 * segment with no sampled frames (possible for guest uploads approved after
 * the artifact was generated) falls back to transparent, i.e. the rail's
 * own paper background -- never an authored color.
 */
function gradientStops(segment: ClientTimelineSegment): string {
  if (segment.stops.length === 0) return "transparent, transparent";
  if (segment.stops.length === 1) {
    return `${segment.stops[0].tint}, ${segment.stops[0].tint}`;
  }
  return segment.stops
    .map((stop) => `${stop.tint} ${Math.round(stop.at * 100)}%`)
    .join(", ");
}

/**
 * Fallback shape when no server timeline exists: consecutive event runs of
 * the loaded photos, with stops averaged from their per-photo sampled
 * light. Same data source, smaller window.
 */
export function deriveTimelineFromPhotos(
  photos: readonly ClientPhoto[],
): ClientTimeline {
  const segments: ClientTimelineSegment[] = [];
  let runStart = 0;
  const flush = (endExclusive: number) => {
    if (endExclusive <= runStart) return;
    const run = photos.slice(runStart, endExclusive);
    const sampled = run.filter((photo) => photo.light);
    const stops =
      sampled.length > 0
        ? [
            average(sampled.slice(0, Math.ceil(sampled.length / 2))),
            average(sampled.slice(Math.floor(sampled.length / 2))),
          ].map((tint, index) => ({ at: index === 0 ? 0.25 : 0.75, ...tint }))
        : [];
    segments.push({
      slug: run[0].eventSlug,
      name: run[0].eventName,
      start: runStart,
      count: run.length,
      stops,
    });
    runStart = endExclusive;
  };
  for (let i = 1; i <= photos.length; i += 1) {
    if (i === photos.length || photos[i].eventSlug !== photos[runStart].eventSlug) {
      flush(i);
    }
  }
  return { total: photos.length, segments };
}

function average(
  photos: readonly ClientPhoto[],
): { tint: string; lum: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  let lum = 0;
  let count = 0;
  for (const photo of photos) {
    if (!photo.light) continue;
    const hex = photo.light.tint.replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(hex)) continue;
    r += Number.parseInt(hex.slice(0, 2), 16);
    g += Number.parseInt(hex.slice(2, 4), 16);
    b += Number.parseInt(hex.slice(4, 6), 16);
    lum += photo.light.lum;
    count += 1;
  }
  if (count === 0) return { tint: "#000000", lum: 0 };
  const channel = (v: number) =>
    Math.round(v / count)
      .toString(16)
      .padStart(2, "0");
  return {
    tint: `#${channel(r)}${channel(g)}${channel(b)}`,
    lum: Math.round((lum / count) * 100) / 100,
  };
}
