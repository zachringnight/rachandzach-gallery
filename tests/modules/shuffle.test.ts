/**
 * Shuffle the Weekend algorithm tests (packet 11, bonus coverage beyond the
 * packet's required done-check files). Proves the two properties the packet
 * names explicitly: event diversity, and no repeats until the recent-history
 * queue is exhausted.
 */
import { describe, expect, it } from "vitest";
import {
  buildShuffleSequence,
  pickShufflePhoto,
  type ShuffleCandidate,
} from "@/lib/modules/contracts";

function candidates(spec: Array<[string, string]>): ShuffleCandidate[] {
  return spec.map(([id, eventSlug]) => ({ id, eventSlug }));
}

describe("pickShufflePhoto", () => {
  it("returns null for an empty candidate pool", () => {
    expect(pickShufflePhoto([], [])).toBeNull();
  });

  it("picks the only candidate when there is exactly one", () => {
    const pool = candidates([["a1", "A"]]);
    const pick = pickShufflePhoto(pool, []);
    expect(pick).toEqual({ photoId: "a1", nextHistory: ["a1"] });
  });

  it("never repeats a candidate until every other candidate has appeared", () => {
    const pool = candidates([
      ["a1", "A"],
      ["a2", "A"],
      ["b1", "B"],
      ["c1", "C"],
      ["c2", "C"],
    ]);
    let history: string[] = [];
    const seenThisCycle = new Set<string>();
    for (let i = 0; i < pool.length; i++) {
      const pick = pickShufflePhoto(pool, history);
      expect(pick).not.toBeNull();
      expect(seenThisCycle.has(pick!.photoId), `repeated ${pick!.photoId} before the cycle exhausted`).toBe(false);
      seenThisCycle.add(pick!.photoId);
      history = pick!.nextHistory;
    }
    expect(seenThisCycle.size).toBe(pool.length);
    // history now covers every candidate exactly once.
    expect([...history].sort()).toEqual(pool.map((c) => c.id).sort());
  });

  it("resets the cycle once every candidate has appeared, instead of returning null", () => {
    const pool = candidates([
      ["a1", "A"],
      ["b1", "B"],
    ]);
    let history: string[] = [];
    for (let i = 0; i < pool.length; i++) {
      history = pickShufflePhoto(pool, history)!.nextHistory;
    }
    // Every candidate has now appeared once; the next pick must still
    // succeed (a fresh cycle), not return null.
    const afterExhaustion = pickShufflePhoto(pool, history);
    expect(afterExhaustion).not.toBeNull();
    // The reset shows up as a short nextHistory (a fresh cycle), not the
    // ever-growing external history.
    expect(afterExhaustion!.nextHistory).toEqual([afterExhaustion!.photoId]);
  });

  it("prefers the least-recently-represented event (diversity)", () => {
    // Event A has already appeared once in history; event B has not
    // appeared at all. With only one candidate left per event, the pick is
    // forced deterministically to the under-represented event's photo.
    const pool = candidates([
      ["a1", "A"],
      ["a2", "A"],
      ["b1", "B"],
    ]);
    const pick = pickShufflePhoto(pool, ["a1"]);
    expect(pick!.photoId).toBe("b1");
  });

  it("never lets the minority event wait behind every majority-event pick", () => {
    // 8 photos in event A, 2 in event B. Trace the guarantee exactly: round
    // 1 ties all 10 candidates at count 0, so it can land on either event.
    // If round 1 lands on A, every remaining A instantly has count 1 while
    // both B's still sit at 0, so round 2 is FORCED onto a B (the unique
    // minimum). If round 1 lands on B instead, a B has already appeared in
    // round 1. Either way a B photo must appear within the first two picks,
    // for any random() implementation -- this holds regardless of seed, so
    // the assertion is exercised across a spread of seeds rather than once.
    const pool = candidates([
      ...Array.from({ length: 8 }, (_, i) => [`a${i}`, "A"] as [string, string]),
      ["b1", "B"],
      ["b2", "B"],
    ]);
    for (const seed of [0, 0.05, 0.15, 0.5, 0.85, 0.95, 0.999]) {
      let history: string[] = [];
      const order: string[] = [];
      for (let i = 0; i < pool.length; i++) {
        const pick = pickShufflePhoto(pool, history, () => seed);
        order.push(pick!.photoId);
        history = pick!.nextHistory;
      }
      const firstBIndex = order.findIndex((id) => id.startsWith("b"));
      expect(firstBIndex, `seed ${seed}: order was ${order.join(",")}`).toBeLessThanOrEqual(1);
      // And the permutation guarantee still holds under a constant seed.
      expect(new Set(order).size).toBe(pool.length);
    }
  });

  it("is deterministic given a seeded random function", () => {
    const pool = candidates([
      ["a1", "A"],
      ["a2", "A"],
    ]);
    const pickZero = pickShufflePhoto(pool, [], () => 0);
    const pickAlmostOne = pickShufflePhoto(pool, [], () => 0.9999);
    expect(pickZero!.photoId).toBe("a1");
    expect(pickAlmostOne!.photoId).toBe("a2");
  });
});

describe("buildShuffleSequence", () => {
  it("returns an empty sequence for an empty pool", () => {
    expect(buildShuffleSequence([], null)).toEqual([]);
  });

  it("builds a full permutation with no duplicates", () => {
    const pool = candidates([
      ["a1", "A"],
      ["a2", "A"],
      ["b1", "B"],
      ["c1", "C"],
    ]);
    const sequence = buildShuffleSequence(pool, null);
    expect(sequence).toHaveLength(pool.length);
    expect(new Set(sequence).size).toBe(pool.length);
    expect([...sequence].sort()).toEqual(pool.map((c) => c.id).sort());
  });

  it("starts from startId when it is a real candidate", () => {
    const pool = candidates([
      ["a1", "A"],
      ["a2", "A"],
      ["b1", "B"],
    ]);
    const sequence = buildShuffleSequence(pool, "b1");
    expect(sequence[0]).toBe("b1");
    expect(new Set(sequence).size).toBe(pool.length);
  });

  it("ignores a startId that is not in the candidate pool", () => {
    const pool = candidates([
      ["a1", "A"],
      ["a2", "A"],
    ]);
    const sequence = buildShuffleSequence(pool, "not-a-real-id");
    expect(sequence).toHaveLength(pool.length);
    expect(new Set(sequence).size).toBe(pool.length);
  });
});
