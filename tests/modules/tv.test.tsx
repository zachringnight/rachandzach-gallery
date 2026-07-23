/**
 * TV mode tests (Round Two, docs/0719_Round_Two_Features_v1.md: "/tv full-
 * screen auto-looping slideshow for gatherings").
 *
 * Layered to match src/app/(guest)/tv/, testing each piece where its logic
 * actually lives instead of re-mocking everything for every assertion:
 *
 *  - fetchApprovedPool (pool.ts): walks getGalleryPage's cursor to assemble
 *    the WHOLE approved catalog. Exercised against the same 1,721-photo
 *    seeded fixture tests/gallery/query.test.ts uses, so "the whole pool, no
 *    dupes, no gaps, in weekend order" is proven the same way cursor
 *    stability is proven there.
 *  - orderForTv (pool.ts): a thin wrapper around src/lib/modules/
 *    contracts.ts's buildShuffleSequence (the same diversity algorithm
 *    Shuffle the Weekend uses). The algorithm's own diversity/no-repeat
 *    guarantees are already proven in tests/modules/shuffle.test.ts; these
 *    tests only prove the wrapper delegates faithfully and returns real
 *    ClientPhoto objects, not bare ids.
 *  - TvPage (page.tsx): the actual route, rendered end to end with
 *    createAdminClient / createSupabaseGalleryDataSource mocked out (same
 *    vi.hoisted + vi.mock pattern as tests/favorites/api-favorites.test.ts)
 *    and a small seeded fixture standing in for Supabase -- "route renders
 *    with a mocked pool."
 *  - TvClient (TvClient.tsx): the client-rendered experience -- mounting
 *    Slideshow full-bleed, the fading Esc hint, reduced-motion, and the
 *    Screen Wake Lock hook. TvClient carries no server import, so it renders
 *    directly with a hand-built photo list, mirroring how
 *    tests/favorites/slideshow.test.tsx exercises Slideshow itself.
 *
 * serialize.ts and query.ts start with `import "server-only"`; mocking that
 * marker package to a no-op is this repo's standard way to unit test a
 * server-only-tagged module directly (see tests/gallery/serialize.test.ts's
 * own comment on the same line below).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

vi.mock("server-only", () => ({}));

const { pushMock, createAdminClientMock, createSupabaseGalleryDataSourceMock } =
  vi.hoisted(() => ({
    pushMock: vi.fn(),
    createAdminClientMock: vi.fn(),
    createSupabaseGalleryDataSourceMock: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/gallery/supabase-source", () => ({
  createSupabaseGalleryDataSource: createSupabaseGalleryDataSourceMock,
}));

import { compareBySortKey, type GalleryPhotoSource } from "@/lib/gallery/query";
import { buildShuffleSequence } from "@/lib/modules/contracts";
import type { ClientPhoto } from "@/lib/gallery/client-types";
import { fetchApprovedPool, orderForTv } from "@/app/(guest)/tv/pool";
import { TvClient } from "@/app/(guest)/tv/TvClient";
import TvPage from "@/app/(guest)/tv/page";
import { buildGalleryFixture } from "../fixtures/gallery/catalog";

afterEach(() => {
  cleanup();
  pushMock.mockClear();
  createAdminClientMock.mockClear();
  createSupabaseGalleryDataSourceMock.mockClear();
  Reflect.deleteProperty(window, "matchMedia");
  Reflect.deleteProperty(navigator, "wakeLock");
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function keyOf(photo: GalleryPhotoSource) {
  return {
    eventOrder: photo.eventOrder,
    capturedAt: photo.capturedAt,
    originalFilename: photo.originalFilename,
    id: photo.id,
  };
}

function clientPhoto(
  id: string,
  eventSlug = "ceremony",
  eventName = "Ceremony",
): ClientPhoto {
  return {
    id,
    eventSlug,
    eventName,
    source: "photographer",
    orientation: "landscape",
    width: 1200,
    height: 800,
    aspectRatio: 1.5,
    capturedAt: null,
    people: [],
    keywords: [],
    previews: [
      { url: `https://example.test/${id}.jpg`, width: 1200, height: 800, format: "jpeg" },
    ],
  };
}

/** Mirrors tests/gallery/serialize.test.ts's fakeSigningClient exactly: a
 *  Supabase storage stub that signs every requested path unconditionally. */
function fakeSigningClient(): SupabaseClient<Database> {
  const fake = {
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((p) => ({
            path: p,
            signedUrl: `https://signed.example.invalid/${encodeURIComponent(p)}`,
            error: null,
          })),
          error: null,
        }),
      }),
    },
  };
  return fake as unknown as SupabaseClient<Database>;
}

/** Static prefers-reduced-motion stub -- Slideshow's own
 *  tests/favorites/slideshow.test.tsx exhaustively covers the live-toggle
 *  behavior; TvClient only needs to prove it does not disturb the mount-time
 *  read. */
function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

function mockWakeLock() {
  const release = vi.fn().mockResolvedValue(undefined);
  const sentinel = { release } as unknown as WakeLockSentinel;
  const request = vi.fn().mockResolvedValue(sentinel);
  Object.defineProperty(navigator, "wakeLock", {
    value: { request },
    configurable: true,
  });
  return { request, release };
}

function playPauseButton() {
  return screen.getByRole("button", { name: /^(play|pause)$/i });
}

// ---------------------------------------------------------------------------
// fetchApprovedPool
// ---------------------------------------------------------------------------

describe("fetchApprovedPool", () => {
  it("walks every page and returns the whole approved catalog, no dupes or gaps", async () => {
    const fixture = buildGalleryFixture();
    const listPhotosSpy = vi.spyOn(fixture.dataSource, "listPhotos");

    const pool = await fetchApprovedPool(fixture.dataSource);
    const ids = pool.map((p) => p.id);

    expect(pool).toHaveLength(1721);
    expect(new Set(ids).size).toBe(1721);
    expect([...ids].sort()).toEqual([...fixture.approvedIds].sort());
    // ceil(1721 / MAX_GALLERY_LIMIT); mirrors this file's own doc comment
    // and pool.ts's "~18 pages" note for the real catalog's current size.
    expect(listPhotosSpy).toHaveBeenCalledTimes(18);
  });

  it("returns photos in weekend order across the page boundary, not just within a page", async () => {
    const fixture = buildGalleryFixture();
    const pool = await fetchApprovedPool(fixture.dataSource);
    const expected = [...fixture.approved]
      .sort((a, b) => compareBySortKey(keyOf(a), keyOf(b), "weekend"))
      .map((p) => p.id);
    expect(pool.map((p) => p.id)).toEqual(expected);
  });

  it("fetches exactly one page when the catalog is at the page limit", async () => {
    const fixture = buildGalleryFixture(100);
    const listPhotosSpy = vi.spyOn(fixture.dataSource, "listPhotos");
    const pool = await fetchApprovedPool(fixture.dataSource);
    expect(pool).toHaveLength(100);
    expect(listPhotosSpy).toHaveBeenCalledTimes(1);
  });

  it("fetches a second page for exactly one photo past the limit", async () => {
    const fixture = buildGalleryFixture(101);
    const listPhotosSpy = vi.spyOn(fixture.dataSource, "listPhotos");
    const pool = await fetchApprovedPool(fixture.dataSource);
    expect(pool).toHaveLength(101);
    expect(listPhotosSpy).toHaveBeenCalledTimes(2);
  });

  it("returns an empty pool when nothing is approved, never leaking pending/hidden/rejected rows", async () => {
    const fixture = buildGalleryFixture(0);
    const pool = await fetchApprovedPool(fixture.dataSource);
    expect(pool).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// orderForTv
// ---------------------------------------------------------------------------

describe("orderForTv", () => {
  it("returns an empty array for an empty pool", () => {
    expect(orderForTv([])).toEqual([]);
  });

  it("returns a full permutation of real ClientPhoto objects, not bare ids", () => {
    const photos = [
      clientPhoto("a1", "ceremony", "Ceremony"),
      clientPhoto("a2", "ceremony", "Ceremony"),
      clientPhoto("b1", "reception", "Reception"),
      clientPhoto("c1", "dancing", "Dancing"),
    ];
    const ordered = orderForTv(photos, () => 0);

    expect(ordered).toHaveLength(photos.length);
    expect(new Set(ordered.map((p) => p.id)).size).toBe(photos.length);
    expect([...ordered.map((p) => p.id)].sort()).toEqual(
      [...photos.map((p) => p.id)].sort(),
    );
    const first = ordered[0];
    expect(first.eventName).toBe(photos.find((p) => p.id === first.id)!.eventName);
  });

  it("delegates to buildShuffleSequence: same candidates and seed produce the same order", () => {
    const photos = [
      clientPhoto("a1", "A", "Event A"),
      clientPhoto("a2", "A", "Event A"),
      clientPhoto("b1", "B", "Event B"),
    ];
    const random = () => 0.42;
    const ordered = orderForTv(photos, random);
    const expected = buildShuffleSequence(
      photos.map((p) => ({ id: p.id, eventSlug: p.eventSlug })),
      null,
      random,
    );
    expect(ordered.map((p) => p.id)).toEqual(expected);
  });

  it("also works with the default random source when none is injected", () => {
    const photos = [clientPhoto("a"), clientPhoto("b"), clientPhoto("c")];
    const ordered = orderForTv(photos);
    expect(new Set(ordered.map((p) => p.id)).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// TvPage: the route, rendered end to end with a mocked pool
// ---------------------------------------------------------------------------

describe("TvPage (the /tv route)", () => {
  it("renders the whole mocked approved pool full-bleed as a TV mode slideshow", async () => {
    const fixture = buildGalleryFixture(12);
    createSupabaseGalleryDataSourceMock.mockReturnValue(fixture.dataSource);
    createAdminClientMock.mockReturnValue(fakeSigningClient());

    const element = await TvPage();
    render(element);

    // aria-modal dialog, labeled with the TV mode name (Slideshow's pinned
    // contract); substring match because a photo with confirmed people
    // extends the label with a caption we don't control the content of here.
    expect(screen.getByRole("dialog", { name: /tv mode/i })).toBeDefined();
    expect(
      screen.getByText(new RegExp(`1 / ${fixture.approved.length}`)),
    ).toBeDefined();
  });

  it("renders nothing (Slideshow's own empty state) when the mocked pool has no approved photos", async () => {
    const fixture = buildGalleryFixture(0);
    createSupabaseGalleryDataSourceMock.mockReturnValue(fixture.dataSource);
    createAdminClientMock.mockReturnValue(fakeSigningClient());

    const element = await TvPage();
    render(element);

    expect(screen.getByText(/nothing in tv mode to show yet/i)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// TvClient: the client-rendered experience
// ---------------------------------------------------------------------------

describe("TvClient", () => {
  it("mounts Slideshow full-bleed with the given (mocked) photo pool", () => {
    const photos = [clientPhoto("a"), clientPhoto("b"), clientPhoto("c")];
    render(<TvClient photos={photos} />);
    expect(screen.getByRole("dialog", { name: /tv mode/i })).toBeDefined();
    expect(screen.getByText(/1 \/ 3/)).toBeDefined();
  });

  it("shows the first-frame Esc hint, then fades it out on its own", () => {
    vi.useFakeTimers();
    render(<TvClient photos={[clientPhoto("a"), clientPhoto("b")]} />);

    const hint = screen.getByText(/press esc to leave/i);
    expect(hint.className).toContain("opacity-100");

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(hint.className).toContain("opacity-0");
  });

  it("starts paused, with controls still visible, when the OS prefers reduced motion", () => {
    mockReducedMotion(true);
    render(<TvClient photos={[clientPhoto("a"), clientPhoto("b")]} />);

    expect(playPauseButton().textContent).toBe("Play");
    expect(playPauseButton().getAttribute("aria-pressed")).toBe("false");
    // Controls remain in the document under reduced motion -- TvClient must
    // not hide them, since a paused-by-default slideshow with no visible
    // transport would leave a reduced-motion guest with no way to advance.
    // Two matches each (the side-arrow button and the controls-bar button
    // share their accessible name), so assert presence via getAllByRole.
    expect(screen.getAllByRole("button", { name: "Previous photo" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Next photo" }).length).toBeGreaterThan(0);
  });

  it("autoplays by default when the OS does not prefer reduced motion", () => {
    mockReducedMotion(false);
    render(<TvClient photos={[clientPhoto("a"), clientPhoto("b")]} />);
    expect(playPauseButton().textContent).toBe("Pause");
  });

  it("navigates to /photos when Slideshow's Close button is clicked", () => {
    render(<TvClient photos={[clientPhoto("a"), clientPhoto("b")]} />);
    fireEvent.click(screen.getByRole("button", { name: /close slideshow/i }));
    expect(pushMock).toHaveBeenCalledWith("/photos");
  });

  it("navigates to /photos on Escape", () => {
    render(<TvClient photos={[clientPhoto("a"), clientPhoto("b")]} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(pushMock).toHaveBeenCalledWith("/photos");
  });

  describe("Screen Wake Lock", () => {
    it("does not throw and makes no call when the API is unavailable (feature-detected, silent fallback)", () => {
      expect("wakeLock" in navigator).toBe(false);
      let utils!: ReturnType<typeof render>;
      expect(() => {
        utils = render(<TvClient photos={[clientPhoto("a")]} />);
      }).not.toThrow();
      expect(() => utils.unmount()).not.toThrow();
    });

    it("acquires the lock on mount and releases it on unmount when the API is available", async () => {
      const { request, release } = mockWakeLock();
      let utils!: ReturnType<typeof render>;

      await act(async () => {
        utils = render(<TvClient photos={[clientPhoto("a")]} />);
      });
      expect(request).toHaveBeenCalledWith("screen");

      await act(async () => {
        utils.unmount();
      });
      expect(release).toHaveBeenCalledTimes(1);
    });

    it("releases the lock instead of leaking it when unmounted before the request resolves", async () => {
      let resolveRequest!: (sentinel: WakeLockSentinel) => void;
      const request = vi.fn(
        () =>
          new Promise<WakeLockSentinel>((resolve) => {
            resolveRequest = resolve;
          }),
      );
      Object.defineProperty(navigator, "wakeLock", {
        value: { request },
        configurable: true,
      });

      const utils = render(<TvClient photos={[clientPhoto("a")]} />);
      expect(request).toHaveBeenCalledWith("screen");
      expect(() => utils.unmount()).not.toThrow();

      // The request finally resolves after unmount; the late lock must be
      // released immediately rather than held forever with nothing left to
      // release it (see TvClient.tsx's useWakeLock: "release it immediately
      // instead of leaking a held wake lock nobody will ever let go of").
      const release = vi.fn().mockResolvedValue(undefined);
      await act(async () => {
        resolveRequest({ release } as unknown as WakeLockSentinel);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(release).toHaveBeenCalledTimes(1);
    });

    it("re-acquires the lock when the document becomes visible again", async () => {
      const { request } = mockWakeLock();
      await act(async () => {
        render(<TvClient photos={[clientPhoto("a")]} />);
      });
      expect(request).toHaveBeenCalledTimes(1);

      await act(async () => {
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(request).toHaveBeenCalledTimes(2);
    });
  });
});
