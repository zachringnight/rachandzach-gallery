import { describe, expect, it } from "vitest";
import {
  buildDisplayList,
  collectWholeBurstIds,
  displayIndexForPhotoIndex,
  displayItemPhotoIds,
  type BurstPageResult,
  type BurstPager,
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

describe("collectWholeBurstIds", () => {
  /**
   * Simulates GalleryShell's paging: pages append to a live loaded list,
   * and each fetch resolves with the raw page body.
   */
  function pagerOf(
    initial: ClientPhoto[],
    pages: ClientPhoto[][],
    overrides: Partial<BurstPager> = {},
  ): { pager: BurstPager; loaded: () => ClientPhoto[] } {
    let loaded = [...initial];
    let pageIndex = 0;
    const pager: BurstPager = {
      loadedPhotos: () => loaded,
      hasMore: () => pageIndex < pages.length,
      fetchNextPage: async (): Promise<BurstPageResult> => {
        const page = pages[pageIndex];
        if (!page) return { status: "end" };
        pageIndex += 1;
        loaded = [...loaded, ...page];
        return { status: "appended", photos: page };
      },
      isStale: () => false,
      waitForWire: async () => {},
      ...overrides,
    };
    return { pager, loaded: () => loaded };
  }

  it("completes a burst that crosses a pagination boundary before it counts as selected", async () => {
    // The regression this pins: a 5-frame burst whose last 3 frames sit on
    // the next page. Selecting the stack BEFORE that page loads must still
    // yield all 5 ids -- the count on the card and the set every export
    // path receives have to be the same number.
    const loadedNow = [
      clientPhoto("a"),
      clientPhoto("b", burstOf("b", 0, 5)),
      clientPhoto("c", burstOf("b", 1, 5)),
    ];
    const nextPage = [
      clientPhoto("d", burstOf("b", 2, 5)),
      clientPhoto("e", burstOf("b", 3, 5)),
      clientPhoto("f", burstOf("b", 4, 5)),
      clientPhoto("g"),
    ];
    const { pager } = pagerOf(loadedNow, [nextPage]);
    await expect(collectWholeBurstIds("b", 5, pager)).resolves.toEqual([
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });

  it("keeps paging when one page is not enough", async () => {
    const loadedNow = [clientPhoto("b", burstOf("b", 0, 4))];
    const { pager } = pagerOf(loadedNow, [
      [clientPhoto("c", burstOf("b", 1, 4))],
      [clientPhoto("d", burstOf("b", 2, 4)), clientPhoto("e", burstOf("b", 3, 4))],
    ]);
    await expect(collectWholeBurstIds("b", 4, pager)).resolves.toEqual([
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("returns null, never a partial set, when paging fails mid-burst", async () => {
    const loadedNow = [
      clientPhoto("b", burstOf("b", 0, 5)),
      clientPhoto("c", burstOf("b", 1, 5)),
    ];
    const { pager } = pagerOf(loadedNow, [], {
      hasMore: () => true,
      fetchNextPage: async () => ({ status: "stale" }),
    });
    await expect(collectWholeBurstIds("b", 5, pager)).resolves.toBeNull();
  });

  it("returns null when the result set went stale during the fetch", async () => {
    let fetched = false;
    const loadedNow = [clientPhoto("b", burstOf("b", 0, 3))];
    const { pager } = pagerOf(
      loadedNow,
      [[clientPhoto("c", burstOf("b", 1, 3)), clientPhoto("d", burstOf("b", 2, 3))]],
      { isStale: () => fetched },
    );
    const original = pager.fetchNextPage;
    pager.fetchNextPage = async () => {
      const result = await original();
      fetched = true; // filters changed while the page was in flight
      return result;
    };
    await expect(collectWholeBurstIds("b", 3, pager)).resolves.toBeNull();
  });

  it("waits out a busy wire and finishes the burst from the loaded list", async () => {
    // A concurrent tail-load appends the burst's tail; our own fetch only
    // ever reports "busy". The completer must pick the frames up from the
    // loaded list instead of giving up.
    let loaded = [clientPhoto("b", burstOf("b", 0, 2))];
    let busyTurns = 0;
    const pager: BurstPager = {
      loadedPhotos: () => loaded,
      hasMore: () => true,
      fetchNextPage: async () => {
        busyTurns += 1;
        return { status: "busy" };
      },
      isStale: () => false,
      waitForWire: async () => {
        loaded = [...loaded, clientPhoto("c", burstOf("b", 1, 2))];
      },
    };
    await expect(collectWholeBurstIds("b", 2, pager)).resolves.toEqual([
      "b",
      "c",
    ]);
    expect(busyTurns).toBe(1);
  });

  it("resolves immediately when the burst is already fully loaded", async () => {
    const loadedNow = [
      clientPhoto("b", burstOf("b", 0, 2)),
      clientPhoto("c", burstOf("b", 1, 2)),
    ];
    let fetches = 0;
    const { pager } = pagerOf(loadedNow, [], {
      fetchNextPage: async () => {
        fetches += 1;
        return { status: "end" };
      },
    });
    await expect(collectWholeBurstIds("b", 2, pager)).resolves.toEqual([
      "b",
      "c",
    ]);
    expect(fetches).toBe(0);
  });
});
