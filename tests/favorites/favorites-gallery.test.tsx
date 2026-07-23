/**
 * FavoritesGallery regression tests for the 2026-07-22 hook-rule restructure
 * (packet 09 polish sweep, docs/plans/2026-07-22-0719-digital-wedding-home).
 *
 * The favoriteIds.length === 0 case used to reset photos/error to their
 * empty defaults from inside a useEffect (a react-hooks/set-state-in-effect
 * error); it is now derived straight from favoriteIds during render. The
 * fetch effect's leading `setError(null)` had the same problem once the
 * first fix landed, so it moved to the same during-render adjustment,
 * keyed off the favoriteIds content string. These tests target exactly
 * those two seams; the ordinary loading -> success and loading -> error
 * paths for a nonempty favorites list must still behave exactly as before.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FavoritesGallery } from "@/components/favorites/FavoritesGallery";
import { favoriteStore } from "@/lib/favorites/store";
import type { ClientPhoto } from "@/lib/gallery/client-types";

afterEach(() => {
  cleanup();
  act(() => {
    favoriteStore.clear();
  });
});

function fixturePhoto(id: string): ClientPhoto {
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
    people: [{ slug: "rach", displayName: "Rach" }],
    keywords: [],
    previews: [
      { url: "https://example.test/photo.jpg", width: 400, height: 267, format: "jpeg" },
    ],
  };
}

function mockFetchOk(photos: ClientPhoto[]) {
  global.fetch = (async () => ({
    ok: true,
    json: async () => ({ photos }),
  })) as unknown as typeof fetch;
}

function mockFetchFailing() {
  global.fetch = (async () => ({ ok: false })) as unknown as typeof fetch;
}

describe("FavoritesGallery empty state (derived during render)", () => {
  it("renders the empty message immediately, with no loading flash, when there are no favorites", () => {
    render(<FavoritesGallery />);
    expect(screen.getByText(/you have not favorited any photos yet/i)).toBeDefined();
    expect(screen.queryByText(/loading your favorites/i)).toBeNull();
  });

  it("returns to the empty message when the last favorite is removed", async () => {
    act(() => {
      favoriteStore.toggle("photo-1");
    });
    mockFetchOk([fixturePhoto("photo-1")]);
    render(<FavoritesGallery />);
    await screen.findByText(/play slideshow/i);

    act(() => {
      favoriteStore.toggle("photo-1"); // removes the only favorite
    });

    expect(await screen.findByText(/you have not favorited any photos yet/i)).toBeDefined();
  });
});

describe("FavoritesGallery loading/error lifecycle for a nonempty favorites list", () => {
  it("shows Loading, then the gallery, once the fetch resolves", async () => {
    act(() => {
      favoriteStore.toggle("photo-1");
    });
    mockFetchOk([fixturePhoto("photo-1")]);
    render(<FavoritesGallery />);

    expect(screen.getByText(/loading your favorites/i)).toBeDefined();

    await screen.findByText(/play slideshow/i);
    expect(screen.queryByText(/loading your favorites/i)).toBeNull();
  });

  it("shows an error message when the fetch fails", async () => {
    act(() => {
      favoriteStore.toggle("photo-1");
    });
    mockFetchFailing();
    render(<FavoritesGallery />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not load your favorites/i);
  });

  it("clears a previous error as soon as a different favorites list starts loading", async () => {
    act(() => {
      favoriteStore.toggle("photo-1");
    });
    mockFetchFailing();
    render(<FavoritesGallery />);
    await screen.findByRole("alert");

    mockFetchOk([fixturePhoto("photo-2")]);
    act(() => {
      favoriteStore.toggle("photo-2"); // favorites become [photo-1, photo-2]
    });

    // The stale error must be gone the instant the new list is known, not
    // only after the new fetch resolves.
    expect(screen.queryByRole("alert")).toBeNull();
    await screen.findByText(/play slideshow/i);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
