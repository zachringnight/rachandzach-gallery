import { describe, expect, it } from "vitest";
import {
  createJumpController,
  type JumpController,
  type JumpIo,
} from "@/lib/gallery/jump";

/**
 * Simulates GalleryShell's wiring: pages of `pageSize` append to a loaded
 * count, and every append reports back through notifyLoaded (the
 * photos.length effect). scrollAfterCommit/scrollTo record landings.
 */
function harness(options: {
  loaded?: number;
  totalAvailable?: number;
  pageSize?: number;
  requestSeq?: () => number;
  fetchOverride?: (defaultFetch: () => Promise<{ status: "appended" | "busy" | "end" | "stale" }>) => Promise<{ status: "appended" | "busy" | "end" | "stale" }>;
}) {
  const pageSize = options.pageSize ?? 100;
  const total = options.totalAvailable ?? Number.MAX_SAFE_INTEGER;
  const state = {
    loaded: options.loaded ?? 60,
    fetches: 0,
    scrolls: [] as { index: number; deferred: boolean }[],
    busyLog: [] as boolean[],
  };
  // Indirection because the controller does not exist yet when the io is
  // built; the shell's photos.length effect is what this stands in for.
  const commit = { notify: () => {} };
  const defaultFetch = async (): Promise<{
    status: "appended" | "busy" | "end" | "stale";
  }> => {
    state.fetches += 1;
    if (state.loaded >= total) return { status: "end" };
    state.loaded = Math.min(total, state.loaded + pageSize);
    // The shell's photos.length effect fires after every append.
    commit.notify();
    return { status: "appended" };
  };
  const io: JumpIo = {
    loadedCount: () => state.loaded,
    hasMore: () => state.loaded < total,
    requestSeq: options.requestSeq ?? (() => 1),
    fetchNextPage: () =>
      options.fetchOverride
        ? options.fetchOverride(defaultFetch)
        : defaultFetch(),
    waitForWire: async () => {},
    scrollTo: (index) => state.scrolls.push({ index, deferred: false }),
    scrollAfterCommit: (index) =>
      state.scrolls.push({ index, deferred: true }),
    setBusy: (busy) => state.busyLog.push(busy),
  };
  const controller: JumpController = createJumpController(io);
  commit.notify = () => controller.notifyLoaded();
  return { controller, state };
}

describe("createJumpController", () => {
  it("a second far jump wins over a first still paging (the race this pins)", async () => {
    // Regression: two rapid far scrubs used to share one pending target;
    // the NEARER (earlier) jump finished first, cleared the newer target,
    // scrolled to its own index and idled the rail, so the guest's latest
    // scrub was silently ignored. The latest jump must always land.
    const { controller, state } = harness({ loaded: 60 });
    const first = controller.jumpTo(200); // nearer target, started first
    const second = controller.jumpTo(400); // the guest's real destination
    await Promise.all([first, second]);

    const lastScroll = state.scrolls[state.scrolls.length - 1];
    expect(lastScroll).toEqual({ index: 400, deferred: true });
    // The stale first jump must not have landed 200 anywhere.
    expect(state.scrolls.some((s) => s.index === 200)).toBe(false);
    // The rail ends idle exactly once the LATEST jump finishes.
    expect(state.busyLog[state.busyLog.length - 1]).toBe(false);
    // The superseded loop stopped instead of paging on: 60 -> 460 needs 4
    // pages; the abandoned loop got at most its one in-flight fetch.
    expect(state.fetches).toBeLessThanOrEqual(5);
    expect(controller.pendingTarget()).toBeNull();
  });

  it("a jump to an already-loaded index cancels a pending far jump and idles the rail", async () => {
    const { controller, state } = harness({ loaded: 60, totalAvailable: 500 });
    const far = controller.jumpTo(400);
    const near = controller.jumpTo(30); // resolves synchronously
    await Promise.all([far, near]);

    const lastScroll = state.scrolls[state.scrolls.length - 1];
    expect(lastScroll).toEqual({ index: 30, deferred: false });
    expect(state.scrolls.some((s) => s.index === 400)).toBe(false);
    expect(controller.pendingTarget()).toBeNull();
    // Superseded far loop must not flip the rail busy again after the
    // immediate jump idled it.
    expect(state.busyLog[state.busyLog.length - 1]).toBe(false);
  });

  it("pages toward a single far target and lands on it", async () => {
    const { controller, state } = harness({ loaded: 60 });
    await controller.jumpTo(400);
    expect(state.scrolls).toEqual([{ index: 400, deferred: true }]);
    expect(state.busyLog).toEqual([true, false]);
    expect(state.fetches).toBe(4); // 60 -> 160 -> 260 -> 360 -> 460
  });

  it("settles on the last loaded photo when the archive runs out", async () => {
    const { controller, state } = harness({ loaded: 60, totalAvailable: 300 });
    await controller.jumpTo(400);
    expect(state.scrolls).toEqual([{ index: 299, deferred: true }]);
    expect(controller.pendingTarget()).toBeNull();
  });

  it("abandons the jump without scrolling when the result set went stale", async () => {
    let seq = 1;
    const { controller, state } = harness({
      loaded: 60,
      requestSeq: () => seq,
      fetchOverride: async (defaultFetch) => {
        const result = await defaultFetch();
        seq = 2; // filters changed while the page was in flight
        return result;
      },
    });
    await controller.jumpTo(400);
    // notifyLoaded may not land it (count still below target after one
    // page), and the stale branch must clear the pending target.
    expect(state.scrolls).toEqual([]);
    expect(controller.pendingTarget()).toBeNull();
    expect(state.busyLog[state.busyLog.length - 1]).toBe(false);
  });

  it("waits out a busy wire and still reaches the target", async () => {
    let busyTurns = 2;
    const { controller, state } = harness({
      loaded: 60,
      fetchOverride: async (defaultFetch) => {
        if (busyTurns > 0) {
          busyTurns -= 1;
          return { status: "busy" };
        }
        return defaultFetch();
      },
    });
    await controller.jumpTo(150);
    expect(state.scrolls).toEqual([{ index: 150, deferred: true }]);
  });
});
