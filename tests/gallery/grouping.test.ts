import { describe, expect, it } from "vitest";
import {
  buildDisplayList,
  displayIndexForPhotoIndex,
  displayItemPhotoIds,
} from "@/lib/gallery/grouping";
import type { ClientBurst, ClientPhoto } from "@/lib/gallery/client-types";

function clientPhoto(id: string, burst: ClientBurst | null = null): ClientPhoto {
  return {
    id,
    eventSlug: "ceremony",
    eventName: "Ceremony",
    source: "photographer",
    orientation: "landscape",
    width: 1600,
    height: 1067,
    aspectRatio: 1.5,
    capturedAt: "2025-07-19T17:00:00-07:00",
    people: [],
    keywords: [],
    previews: [],
    burst,
  };
}

const burstOf = (id: string, index: number, size: number): ClientBurst => ({
  id,
  index,
  size,
});

describe("buildDisplayList", () => {
  it("collapses an adjacent burst into one stack card", () => {
    const photos = [
      clientPhoto("a"),
      clientPhoto("b", burstOf("b", 0, 3)),
      clientPhoto("c", burstOf("b", 1, 3)),
      clientPhoto("d", burstOf("b", 2, 3)),
      clientPhoto("e"),
    ];
    const items = buildDisplayList(photos, new Set());
    expect(items.map((item) => item.kind)).toEqual(["photo", "stack", "photo"]);
    const stack = items[1];
    if (stack.kind !== "stack") throw new Error("expected stack");
    expect(stack.burstId).toBe("b");
    expect(stack.photos.map((p) => p.id)).toEqual(["b", "c", "d"]);
    expect(stack.photoIndex).toBe(1);
    expect(stack.size).toBe(3);
  });

  it("fans an expanded burst out into individual frames with a leader", () => {
    const photos = [
      clientPhoto("b", burstOf("b", 0, 2)),
      clientPhoto("c", burstOf("b", 1, 2)),
    ];
    const items = buildDisplayList(photos, new Set(["b"]));
    expect(items.map((item) => item.kind)).toEqual([
      "burst-frame",
      "burst-frame",
    ]);
    const [leader, follower] = items;
    if (leader.kind !== "burst-frame" || follower.kind !== "burst-frame") {
      throw new Error("expected burst frames");
    }
    expect(leader.leader).toBe(true);
    expect(follower.leader).toBe(false);
    expect(follower.photoIndex).toBe(1);
  });

  it("keeps the full burst size on a stack whose tail is not yet loaded", () => {
    // Page boundary: only 2 of 5 frames are loaded so far.
    const photos = [
      clientPhoto("b", burstOf("b", 0, 5)),
      clientPhoto("c", burstOf("b", 1, 5)),
    ];
    const items = buildDisplayList(photos, new Set());
    const stack = items[0];
    if (stack.kind !== "stack") throw new Error("expected stack");
    expect(stack.photos).toHaveLength(2);
    expect(stack.size).toBe(5);
  });

  it("treats a single loaded frame of a real burst as a stack, not a photo", () => {
    const photos = [clientPhoto("b", burstOf("b", 0, 4))];
    const items = buildDisplayList(photos, new Set());
    expect(items[0].kind).toBe("stack");
  });
});

describe("selection and index mapping", () => {
  const photos = [
    clientPhoto("a"),
    clientPhoto("b", burstOf("b", 0, 3)),
    clientPhoto("c", burstOf("b", 1, 3)),
    clientPhoto("d", burstOf("b", 2, 3)),
    clientPhoto("e"),
  ];
  const items = buildDisplayList(photos, new Set());

  it("selecting a stack means selecting every loaded frame", () => {
    expect(displayItemPhotoIds(items[1])).toEqual(["b", "c", "d"]);
    expect(displayItemPhotoIds(items[0])).toEqual(["a"]);
  });

  it("maps any photo index inside a collapsed stack to the stack card", () => {
    expect(displayIndexForPhotoIndex(items, 0)).toBe(0);
    expect(displayIndexForPhotoIndex(items, 1)).toBe(1);
    expect(displayIndexForPhotoIndex(items, 2)).toBe(1);
    expect(displayIndexForPhotoIndex(items, 3)).toBe(1);
    expect(displayIndexForPhotoIndex(items, 4)).toBe(2);
  });
});
