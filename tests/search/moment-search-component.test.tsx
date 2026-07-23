import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MomentSearch } from "@/components/search/MomentSearch";
import type { ClientPhoto } from "@/lib/gallery/client-types";

vi.mock("@/components/gallery/PhotoCard", () => ({
  PhotoCard: ({ photo }: { photo: ClientPhoto }) => (
    <article data-testid={`result-${photo.id}`}>{photo.eventName}</article>
  ),
}));

vi.mock("@/components/gallery/Lightbox", () => ({
  Lightbox: () => null,
}));

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

const resultPhoto: ClientPhoto = {
  id: "sunset-result",
  eventSlug: "sunset",
  eventName: "Sunset",
  source: "photographer",
  orientation: "landscape",
  width: 1200,
  height: 800,
  aspectRatio: 1.5,
  capturedAt: null,
  people: [],
  keywords: ["sunset", "kiss"],
  previews: [],
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            photo: resultPhoto,
            similarity: 0.92,
            matchType: "keyword",
          },
        ],
      }),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MomentSearch", () => {
  it("renders result cards when the async grid mounts after the first layout effect", async () => {
    render(<MomentSearch events={[]} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Describe a moment" }), {
      target: { value: "sunset kiss" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(screen.getByTestId("result-sunset-result")).toBeTruthy();
    });
    expect(screen.getByText("Showing keyword matches while visual search is unavailable.")).toBeTruthy();
  });
});
