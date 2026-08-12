import { StrictMode, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GalleryShell } from "@/components/gallery/GalleryShell";
import type {
  ClientGalleryPage,
  ClientPhoto,
  GalleryFilterState,
} from "@/lib/gallery/client-types";

let loadMoreFromGrid: (() => void) | undefined;

vi.mock("@/components/gallery/FilterBar", () => ({
  FilterBar: ({
    onChange,
    momentSearchQuery,
    momentSearchSlot,
  }: {
    onChange: (patch: Partial<GalleryFilterState>) => void;
    momentSearchQuery?: string;
    momentSearchSlot?: ReactNode;
  }) => (
    <>
      <button type="button" onClick={() => onChange({ q: "flowers" })}>
        Apply search
      </button>
      <button
        type="button"
        onClick={() => {
          onChange({ q: "flowers" });
          loadMoreFromGrid?.();
        }}
      >
        Apply search while the grid intersects
      </button>
      {momentSearchQuery ? (
        <section data-testid="moment-panel">{momentSearchSlot}</section>
      ) : null}
    </>
  ),
}));

vi.mock("@/components/gallery/VirtualPhotoGrid", () => ({
  VirtualPhotoGrid: ({ onLoadMore }: { onLoadMore: () => void }) => {
    loadMoreFromGrid = onLoadMore;
    return <div>Photo grid</div>;
  },
}));

vi.mock("@/components/gallery/useSelection", () => ({
  useSelection: () => ({
    selecting: false,
    selected: new Set<string>(),
    start: vi.fn(),
    toggle: vi.fn(),
    clear: vi.fn(),
    selectAllVisible: vi.fn(),
  }),
}));

vi.mock("@/content/features", () => ({
  featureFlags: { momentSearch: true },
}));

const initialPage: ClientGalleryPage = {
  photos: [],
  nextCursor: null,
  total: 0,
  signedUrlExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
};

const initialFilters: GalleryFilterState = {
  q: "",
  person: null,
  event: null,
  orientation: null,
  source: null,
  sort: "weekend",
};

const photo: ClientPhoto = {
  id: "photo-1",
  eventSlug: "ceremony",
  eventName: "Ceremony",
  source: "photographer",
  orientation: "landscape",
  width: 1600,
  height: 1067,
  aspectRatio: 1.5,
  capturedAt: null,
  people: [],
  keywords: [],
  previews: [],
};

afterEach(() => {
  cleanup();
  loadMoreFromGrid = undefined;
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("GalleryShell filter commits", () => {
  it("issues one request per filter change in React Strict Mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(initialPage), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StrictMode>
        <GalleryShell
          initialPage={initialPage}
          facets={{ events: [], people: [] }}
          initialFilters={initialFilters}
          initialPhotoId={null}
        />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply search" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gallery?q=flowers&sort=weekend&limit=60",
      { cache: "no-store" },
    );
    expect(window.location.pathname).toBe("/photos");
    expect(window.location.search).toBe("?gallery_q=flowers");
  });

  it("does not append an old page while a replacement query starts", async () => {
    const replacementPage = {
      ...initialPage,
      photos: [photo],
      total: 1,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(replacementPage), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GalleryShell
        initialPage={{
          ...initialPage,
          photos: [photo],
          nextCursor: "old-filter-cursor",
          total: 2,
        }}
        facets={{ events: [], people: [] }}
        initialFilters={initialFilters}
        initialPhotoId={null}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Apply search while the grid intersects",
      }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gallery?q=flowers&sort=weekend&limit=60",
      { cache: "no-store" },
    );
  });

  it("mounts and runs a new same-route Moment Search query, then closes when removed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <GalleryShell
        initialPage={initialPage}
        facets={{ events: [], people: [] }}
        initialFilters={initialFilters}
        initialPhotoId={null}
        initialMomentQuery=""
      />,
    );

    expect(screen.queryByTestId("moment-panel")).toBeNull();

    view.rerender(
      <GalleryShell
        initialPage={initialPage}
        facets={{ events: [], people: [] }}
        initialFilters={initialFilters}
        initialPhotoId={null}
        initialMomentQuery="sunset kiss"
      />,
    );

    expect(screen.getByTestId("moment-panel")).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/search?q=sunset+kiss");
    });

    view.rerender(
      <GalleryShell
        initialPage={initialPage}
        facets={{ events: [], people: [] }}
        initialFilters={initialFilters}
        initialPhotoId={null}
        initialMomentQuery=""
      />,
    );
    expect(screen.queryByTestId("moment-panel")).toBeNull();
  });
});
