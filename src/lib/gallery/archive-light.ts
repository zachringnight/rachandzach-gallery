/**
 * The archive's shape in light and time (design upgrade P3 + P4).
 *
 * Pure logic, no I/O: everything here operates on data the query layer
 * already holds, plus per-photo light samples produced at import/build time
 * by scripts/sample-photo-light.mjs (dominant light tint, mean luminance,
 * and a 64-bit perceptual dHash, keyed by the immutable imageDataHash that
 * names every preview object).
 *
 * Two consumers:
 *  - The Light Bar (P3): `computeTimeline` folds the full filtered result
 *    set into per-event segments whose gradient stops are averaged from the
 *    photographs' own sampled light. No hand-authored color ever enters.
 *  - Contact-sheet stacks (P4): `assignBursts` clusters adjacent
 *    near-duplicate frames using capture-time proximity with the perceptual
 *    hash as a scene-change veto, tuned against the real catalog (see the
 *    thresholds' comment).
 */

/** One photo's sampled light, from src/generated/photo-light.json. */
export interface PhotoLightSample {
  /** Dominant-light tint as a 6-char lowercase hex string (no '#'). */
  t: string;
  /** Mean relative luminance, 0-1. */
  l: number;
  /** 64-bit perceptual dHash, 16-char hex. */
  p: string;
}

export type LightLookup = (imageKey: string) => PhotoLightSample | null;

/** The minimal photo shape both burst and timeline logic need. */
export interface LightSortedPhoto {
  id: string;
  eventSlug: string;
  eventName: string;
  orientation: string;
  capturedAt: string | null;
  /** imageDataHash extracted from the photo's preview objects, if any. */
  lightKey: string | null;
}

export interface BurstAssignment {
  /** Stable burst id: the id of the burst's first frame in sort order. */
  id: string;
  /** This frame's position within the burst, 0-based. */
  index: number;
  /** Total frames in the burst within the current result set. */
  size: number;
}

export interface TimelineStop {
  /** Position within the segment, 0-1. */
  at: number;
  /** Averaged dominant-light tint, '#rrggbb'. */
  tint: string;
  /** Averaged luminance, 0-1. */
  lum: number;
}

export interface TimelineSegment {
  slug: string;
  name: string;
  /** Index of the segment's first photo in the full sorted result set. */
  start: number;
  count: number;
  stops: TimelineStop[];
}

export interface ArchiveTimeline {
  total: number;
  segments: TimelineSegment[];
}

/**
 * Preview objects live at previews/{imageDataHash}/{width}.{format}. The
 * hash is the stable content key the light artifact is indexed by, so a
 * photo keeps its sampled light across database re-imports.
 */
const PREVIEW_KEY_PATTERN = /^previews\/([0-9a-f]{16,64})\//;

export function imageKeyFromPreviewPath(objectPath: string): string | null {
  const match = PREVIEW_KEY_PATTERN.exec(objectPath);
  return match ? match[1] : null;
}

/**
 * Wall-clock milliseconds of a capture timestamp, IGNORING its UTC offset.
 * The archive's strict total order compares capturedAt as a string, i.e. by
 * local wall clock; a second camera in this catalog stamped -08:00 while the
 * primary stamped -07:00, so honoring offsets would make sorted neighbours
 * appear an hour apart. Burst gaps must follow the same clock the sort uses.
 */
export function wallClockMs(capturedAt: string | null): number | null {
  if (!capturedAt || capturedAt.length < 19) return null;
  const ms = Date.parse(`${capturedAt.slice(0, 19)}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Format a capture timestamp as the wall clock it was stamped with.
 *
 * Must pair with wallClockMs above. That function deliberately ignores the
 * UTC offset because a second camera in this catalog stamped -08:00 during a
 * -07:00 weekend; the sort order and burst grouping both follow the stamped
 * wall clock. Formatting the same value as an instant in Los Angeles would
 * honour that bad offset and add an hour, so a photo the archive orders (and
 * groups) at 1:54 PM would be captioned 2:54 PM.
 *
 * Reading the wall-clock portion and formatting it in UTC gives back exactly
 * the digits the camera stamped, which is what every other surface uses.
 */
export function formatWallClock(
  capturedAt: string | null,
  options: Intl.DateTimeFormatOptions,
): string | null {
  const ms = wallClockMs(capturedAt);
  if (ms === null) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
      new Date(ms),
    );
  } catch {
    // A runtime without the requested formatting options must not take a
    // caption or a chapter label down with it.
    return null;
  }
}

/**
 * Hamming distance between two 64-bit hex hashes, computed 32 bits at a
 * time (the build target predates BigInt literals).
 */
export function hammingDistance(a: string, b: string): number {
  let bits = 0;
  for (const [from, to] of [
    [0, 8],
    [8, 16],
  ] as const) {
    let x =
      (Number.parseInt(a.slice(from, to), 16) ^
        Number.parseInt(b.slice(from, to), 16)) >>>
      0;
    while (x > 0) {
      bits += x & 1;
      x >>>= 1;
    }
  }
  return bits;
}

/**
 * Burst thresholds, tuned against the real 1,721-photo catalog:
 *
 * - Rapid sequence: frames within 8s of the previous frame. 28% of all
 *   same-event neighbour gaps are <= 3s (the photographer worked in bursts),
 *   and the hash acts as a VETO (<= 30 of 64 bits) that splits genuine scene
 *   changes; measured on burst pairs (gap <= 2s) the dHash medians 19 bits
 *   because subjects move, so a strict near-identity bound would reject real
 *   bursts.
 * - Slow near-identical: up to 20s apart when the hash is genuinely close
 *   (<= 12 bits), e.g. re-posed formals from a tripod-still composition.
 *
 * Frames must share the event and orientation, and both need capture times
 * and light samples; anything else never joins a stack.
 */
export const BURST_RAPID_GAP_SECONDS = 8;
export const BURST_RAPID_MAX_HAMMING = 30;
export const BURST_SLOW_GAP_SECONDS = 20;
export const BURST_SLOW_MAX_HAMMING = 12;

interface BurstCandidate {
  photo: LightSortedPhoto;
  wallMs: number | null;
  phash: string | null;
}

function joinsPrevious(prev: BurstCandidate, next: BurstCandidate): boolean {
  if (prev.photo.eventSlug !== next.photo.eventSlug) return false;
  if (prev.photo.orientation !== next.photo.orientation) return false;
  if (prev.wallMs === null || next.wallMs === null) return false;
  if (prev.phash === null || next.phash === null) return false;
  // `newest` sort walks the same physical sequence backwards; the pair is
  // the same either way, so the gap is directionless.
  const gapSeconds = Math.abs(next.wallMs - prev.wallMs) / 1000;
  const hamming = hammingDistance(prev.phash, next.phash);
  if (gapSeconds <= BURST_RAPID_GAP_SECONDS && hamming <= BURST_RAPID_MAX_HAMMING) {
    return true;
  }
  return gapSeconds <= BURST_SLOW_GAP_SECONDS && hamming <= BURST_SLOW_MAX_HAMMING;
}

/**
 * Cluster the SORTED result set into bursts. Returns assignments only for
 * photos inside a multi-frame burst; singletons are absent from the map.
 * Deterministic for a given input order, so pagination windows cut from the
 * same sorted list always agree about membership.
 */
export function assignBursts(
  photos: readonly LightSortedPhoto[],
  lookup: LightLookup,
): Map<string, BurstAssignment> {
  const assignments = new Map<string, BurstAssignment>();
  let cluster: BurstCandidate[] = [];

  const flush = () => {
    if (cluster.length >= 2) {
      const id = cluster[0].photo.id;
      cluster.forEach((member, index) => {
        assignments.set(member.photo.id, {
          id,
          index,
          size: cluster.length,
        });
      });
    }
    cluster = [];
  };

  for (const photo of photos) {
    const sample = photo.lightKey ? lookup(photo.lightKey) : null;
    const candidate: BurstCandidate = {
      photo,
      wallMs: wallClockMs(photo.capturedAt),
      phash: sample?.p ?? null,
    };
    const previous = cluster[cluster.length - 1];
    if (previous && joinsPrevious(previous, candidate)) {
      cluster.push(candidate);
    } else {
      flush();
      cluster = [candidate];
    }
  }
  flush();
  return assignments;
}

/** Gradient stops per segment scale with how much of the day it covers. */
function stopCountFor(photoCount: number): number {
  return Math.max(2, Math.min(6, Math.ceil(photoCount / 50)));
}

function parseTint(hex: string): [number, number, number] | null {
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function toCssTint([r, g, b]: [number, number, number]): string {
  const channel = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * Fold the full sorted result set into per-event segments with gradient
 * stops averaged from the photographs' sampled light. Segments are
 * consecutive runs of the same event in sort order, so the rail follows
 * whatever order the guest is actually scrolling.
 */
export function computeTimeline(
  photos: readonly LightSortedPhoto[],
  lookup: LightLookup,
): ArchiveTimeline {
  const segments: TimelineSegment[] = [];
  let runStart = 0;

  const flushRun = (endExclusive: number) => {
    if (endExclusive <= runStart) return;
    const run = photos.slice(runStart, endExclusive);
    const first = run[0];
    const stops: TimelineStop[] = [];
    const stopCount = stopCountFor(run.length);
    for (let i = 0; i < stopCount; i += 1) {
      const from = Math.floor((i * run.length) / stopCount);
      const to = Math.max(from + 1, Math.floor(((i + 1) * run.length) / stopCount));
      let r = 0;
      let g = 0;
      let b = 0;
      let lum = 0;
      let sampled = 0;
      for (let j = from; j < to; j += 1) {
        const sample = run[j].lightKey ? lookup(run[j].lightKey!) : null;
        if (!sample) continue;
        const rgb = parseTint(sample.t);
        if (!rgb) continue;
        r += rgb[0];
        g += rgb[1];
        b += rgb[2];
        lum += sample.l;
        sampled += 1;
      }
      if (sampled === 0) continue;
      stops.push({
        at: (i + 0.5) / stopCount,
        tint: toCssTint([r / sampled, g / sampled, b / sampled]),
        lum: Math.round((lum / sampled) * 100) / 100,
      });
    }
    segments.push({
      slug: first.eventSlug,
      name: first.eventName,
      start: runStart,
      count: run.length,
      stops,
    });
    runStart = endExclusive;
  };

  for (let i = 1; i <= photos.length; i += 1) {
    if (i === photos.length || photos[i].eventSlug !== photos[runStart].eventSlug) {
      flushRun(i);
    }
  }

  return { total: photos.length, segments };
}
