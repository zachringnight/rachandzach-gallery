import { describe, expect, it } from "vitest";
import {
  assignBursts,
  computeTimeline,
  hammingDistance,
  imageKeyFromPreviewPath,
  wallClockMs,
  type LightSortedPhoto,
  type PhotoLightSample,
} from "@/lib/gallery/archive-light";

const ZERO_HASH = "0000000000000000";
const NEAR_HASH = "0000000000000003"; // 2 bits from zero
const FAR_HASH = "ffffffffffffffff"; // 64 bits from zero

function photo(overrides: Partial<LightSortedPhoto>): LightSortedPhoto {
  return {
    id: "p0",
    eventSlug: "ceremony",
    eventName: "Ceremony",
    orientation: "landscape",
    capturedAt: "2025-07-19T17:00:00-07:00",
    lightKey: "k0",
    ...overrides,
  };
}

function lookupFrom(
  samples: Record<string, PhotoLightSample>,
): (key: string) => PhotoLightSample | null {
  return (key) => samples[key] ?? null;
}

describe("imageKeyFromPreviewPath", () => {
  it("extracts the content hash from a preview object path", () => {
    expect(
      imageKeyFromPreviewPath("previews/281379aee834fa0ece2c416fe2f2a321/480.webp"),
    ).toBe("281379aee834fa0ece2c416fe2f2a321");
  });

  it("returns null for non-preview paths", () => {
    expect(imageKeyFromPreviewPath("originals/abc123/photo.jpg")).toBeNull();
    expect(imageKeyFromPreviewPath("previews/NOT-A-HASH/480.webp")).toBeNull();
  });
});

describe("wallClockMs", () => {
  it("ignores the UTC offset so mixed-camera stamps follow the sort clock", () => {
    // The catalog's second camera stamped -08:00; the sort order compares
    // capturedAt as a string, so 13:54:55-08:00 sorts BEFORE 13:56:33-07:00
    // and the wall-clock gap between them must be 98 seconds, not -3502.
    const a = wallClockMs("2025-07-19T13:54:55-08:00")!;
    const b = wallClockMs("2025-07-19T13:56:33-07:00")!;
    expect((b - a) / 1000).toBe(98);
  });

  it("returns null for null or malformed stamps", () => {
    expect(wallClockMs(null)).toBeNull();
    expect(wallClockMs("garbage")).toBeNull();
  });
});

describe("hammingDistance", () => {
  it("counts differing bits across the full 64-bit hash", () => {
    expect(hammingDistance(ZERO_HASH, ZERO_HASH)).toBe(0);
    expect(hammingDistance(ZERO_HASH, NEAR_HASH)).toBe(2);
    expect(hammingDistance(ZERO_HASH, FAR_HASH)).toBe(64);
    expect(hammingDistance("00000000ffffffff", "ffffffff00000000")).toBe(64);
  });
});

describe("assignBursts", () => {
  const samples = {
    k0: { t: "d8c2a4", l: 0.6, p: ZERO_HASH },
    k1: { t: "d8c2a4", l: 0.6, p: NEAR_HASH },
    k2: { t: "d8c2a4", l: 0.6, p: FAR_HASH },
  };

  it("clusters a rapid same-scene sequence and keys it to the first frame", () => {
    const photos = [
      photo({ id: "a", capturedAt: "2025-07-19T17:00:00-07:00", lightKey: "k0" }),
      photo({ id: "b", capturedAt: "2025-07-19T17:00:02-07:00", lightKey: "k1" }),
      photo({ id: "c", capturedAt: "2025-07-19T17:00:05-07:00", lightKey: "k0" }),
      // 40s later: a separate moment, never joins.
      photo({ id: "d", capturedAt: "2025-07-19T17:00:45-07:00", lightKey: "k0" }),
    ];
    const bursts = assignBursts(photos, lookupFrom(samples));
    expect(bursts.get("a")).toEqual({ id: "a", index: 0, size: 3 });
    expect(bursts.get("b")).toEqual({ id: "a", index: 1, size: 3 });
    expect(bursts.get("c")).toEqual({ id: "a", index: 2, size: 3 });
    expect(bursts.has("d")).toBe(false);
  });

  it("vetoes a scene change even seconds apart", () => {
    const photos = [
      photo({ id: "a", capturedAt: "2025-07-19T17:00:00-07:00", lightKey: "k0" }),
      photo({ id: "b", capturedAt: "2025-07-19T17:00:02-07:00", lightKey: "k2" }),
    ];
    expect(assignBursts(photos, lookupFrom(samples)).size).toBe(0);
  });

  it("joins slow near-identical frames but not slow different ones", () => {
    const photos = [
      photo({ id: "a", capturedAt: "2025-07-19T17:00:00-07:00", lightKey: "k0" }),
      // 15s apart, 2 bits apart: the tripod-still case.
      photo({ id: "b", capturedAt: "2025-07-19T17:00:15-07:00", lightKey: "k1" }),
    ];
    const bursts = assignBursts(photos, lookupFrom(samples));
    expect(bursts.get("b")?.id).toBe("a");
  });

  it("never joins across events, orientations, or missing data", () => {
    const base = photo({ id: "a", capturedAt: "2025-07-19T17:00:00-07:00" });
    const twin = (overrides: Partial<LightSortedPhoto>) =>
      assignBursts(
        [
          base,
          photo({
            id: "b",
            capturedAt: "2025-07-19T17:00:01-07:00",
            ...overrides,
          }),
        ],
        lookupFrom(samples),
      ).size;
    expect(twin({ eventSlug: "reception", eventName: "Reception" })).toBe(0);
    expect(twin({ orientation: "portrait" })).toBe(0);
    expect(twin({ capturedAt: null })).toBe(0);
    expect(twin({ lightKey: null })).toBe(0);
    expect(twin({ lightKey: "unknown-key" })).toBe(0);
  });

  it("clusters the reversed (newest-sort) sequence identically", () => {
    const photos = [
      photo({ id: "c", capturedAt: "2025-07-19T17:00:05-07:00", lightKey: "k0" }),
      photo({ id: "b", capturedAt: "2025-07-19T17:00:02-07:00", lightKey: "k1" }),
      photo({ id: "a", capturedAt: "2025-07-19T17:00:00-07:00", lightKey: "k0" }),
    ];
    const bursts = assignBursts(photos, lookupFrom(samples));
    expect(bursts.get("c")).toEqual({ id: "c", index: 0, size: 3 });
    expect(bursts.get("a")).toEqual({ id: "c", index: 2, size: 3 });
  });
});

describe("computeTimeline", () => {
  const samples: Record<string, PhotoLightSample> = {
    cool: { t: "6688aa", l: 0.4, p: ZERO_HASH },
    warm: { t: "aa8866", l: 0.7, p: ZERO_HASH },
  };

  it("builds one segment per consecutive event run with averaged stops", () => {
    const photos = [
      photo({ id: "a", eventSlug: "morning", eventName: "Morning", lightKey: "cool" }),
      photo({ id: "b", eventSlug: "morning", eventName: "Morning", lightKey: "cool" }),
      photo({ id: "c", eventSlug: "party", eventName: "Party", lightKey: "warm" }),
    ];
    const timeline = computeTimeline(photos, lookupFrom(samples));
    expect(timeline.total).toBe(3);
    expect(timeline.segments.map((s) => [s.slug, s.start, s.count])).toEqual([
      ["morning", 0, 2],
      ["party", 2, 1],
    ]);
    // Every stop's tint comes from the sampled light, verbatim here since
    // each bucket averages identical samples.
    expect(timeline.segments[0].stops.length).toBeGreaterThan(0);
    for (const stop of timeline.segments[0].stops) {
      expect(stop.tint).toBe("#6688aa");
      expect(stop.lum).toBe(0.4);
    }
    expect(timeline.segments[1].stops[0].tint).toBe("#aa8866");
  });

  it("yields stopless segments (not invented color) when light is unknown", () => {
    const photos = [
      photo({ id: "a", eventSlug: "morning", eventName: "Morning", lightKey: null }),
      photo({ id: "b", eventSlug: "party", eventName: "Party", lightKey: "warm" }),
    ];
    const timeline = computeTimeline(photos, lookupFrom(samples));
    expect(timeline.segments[0].stops).toEqual([]);
    expect(timeline.segments[1].stops.length).toBeGreaterThan(0);
  });
});
