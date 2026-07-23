/**
 * Slideshow regression tests for the 2026-07-22 hook-rule restructure
 * (packet 09 polish sweep, docs/plans/2026-07-22-0719-digital-wedding-home).
 * Slideshow has no tests/slideshow/ home of its own, so per that sweep's
 * scope (tests/favorites/ or tests/downloads/ only) this lives here; it
 * directly exercises the Slideshow component.
 *
 * Three seams changed, all react-hooks/set-state-in-effect fixes:
 *  - usePrefersReducedMotion moved from useState+useEffect to
 *    useSyncExternalStore (mirrors useIsFavorite in FavoriteButton.tsx).
 *  - The index-clamp-on-shrink effect became a value derived during render
 *    (clampedIndex), instead of a corrective setIndex() after the fact.
 *  - The reducedMotion -> setPlaying(false) sync moved to the "adjust state
 *    while rendering" pattern (comparing against a stored previous value),
 *    instead of a useEffect keyed on [reducedMotion].
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Slideshow, type SlideshowPhoto } from "@/components/slideshow/Slideshow";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

function photo(id: string): SlideshowPhoto {
  return {
    id,
    eventSlug: "wedding",
    eventName: "The Wedding",
    source: "photographer",
    orientation: "landscape",
    width: 1200,
    height: 800,
    aspectRatio: 1.5,
    capturedAt: null,
    people: [],
    previews: [
      { url: `https://example.test/${id}.jpg`, width: 1200, height: 800, format: "jpeg" },
    ],
  };
}

type MatchMediaListener = (event: { matches: boolean }) => void;

/**
 * Fakes window.matchMedia("(prefers-reduced-motion: reduce)"). Returns the
 * same object from every call, like a real (mutable) MediaQueryList, so the
 * hook's subscribe() and getSnapshot() calls -- and this helper's fire() --
 * all agree on the current value.
 */
function mockReducedMotion(initialMatches: boolean) {
  let listener: MatchMediaListener | null = null;
  const mql = {
    matches: initialMatches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn((_type: string, cb: MatchMediaListener) => {
      listener = cb;
    }),
    removeEventListener: vi.fn(() => {
      listener = null;
    }),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    fire(matches: boolean) {
      mql.matches = matches;
      act(() => {
        listener?.({ matches });
      });
    },
  };
}

function playPauseButton() {
  return screen.getByRole("button", { name: /^(play|pause)$/i });
}

describe("Slideshow index clamping (derived during render, not an effect)", () => {
  it("keeps showing a valid, correctly-numbered photo the instant the list shrinks", () => {
    mockReducedMotion(false);
    const photos = [photo("a"), photo("b"), photo("c"), photo("d"), photo("e")];
    const { rerender } = render(<Slideshow photos={photos} modeLabel="Favorites" startIndex={4} />);
    expect(screen.getByText(/5 \/ 5/)).toBeDefined();

    // Shrinks to 2 photos; clampIndex(4, 2) wraps to 0 -- the same result
    // the deleted effect used to converge on, just without a stale/blank
    // render in between.
    rerender(<Slideshow photos={[photo("a"), photo("b")]} modeLabel="Favorites" startIndex={4} />);
    expect(screen.getByText(/1 \/ 2/)).toBeDefined();
    expect(screen.queryByText(/unavailable/i)).toBeNull();
  });
});

describe("Slideshow reduced-motion sync (useSyncExternalStore, no setState-in-effect)", () => {
  it("defaults to Play (no autoplay) when the OS already prefers reduced motion at mount", () => {
    mockReducedMotion(true);
    render(<Slideshow photos={[photo("a"), photo("b")]} modeLabel="Favorites" />);
    expect(playPauseButton().textContent).toBe("Play");
    expect(playPauseButton().getAttribute("aria-pressed")).toBe("false");
  });

  it("autoplays by default when the OS does not prefer reduced motion", () => {
    mockReducedMotion(false);
    render(<Slideshow photos={[photo("a"), photo("b")]} modeLabel="Favorites" />);
    expect(playPauseButton().textContent).toBe("Pause");
  });

  it("falls back to no-reduced-motion safely when matchMedia is unavailable", () => {
    Reflect.deleteProperty(window, "matchMedia");
    render(<Slideshow photos={[photo("a"), photo("b")]} modeLabel="Favorites" />);
    expect(playPauseButton().textContent).toBe("Pause");
  });

  it("stops autoplay the moment the OS turns reduced motion on mid-session", () => {
    const motion = mockReducedMotion(false);
    render(<Slideshow photos={[photo("a"), photo("b")]} modeLabel="Favorites" />);
    expect(playPauseButton().textContent).toBe("Pause");

    motion.fire(true);
    expect(playPauseButton().textContent).toBe("Play");
  });

  it("does not fight a manual Play press after reduced motion has already toggled on", () => {
    const motion = mockReducedMotion(false);
    render(<Slideshow photos={[photo("a"), photo("b")]} modeLabel="Favorites" />);
    motion.fire(true);
    expect(playPauseButton().textContent).toBe("Play");

    fireEvent.click(playPauseButton());
    expect(playPauseButton().textContent).toBe("Pause");
  });

  it("does not auto-resume when reduced motion later toggles back off", () => {
    const motion = mockReducedMotion(false);
    render(<Slideshow photos={[photo("a"), photo("b")]} modeLabel="Favorites" />);
    motion.fire(true);
    expect(playPauseButton().textContent).toBe("Play");

    motion.fire(false);
    expect(playPauseButton().textContent).toBe("Play");
  });
});
