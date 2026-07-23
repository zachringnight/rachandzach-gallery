/**
 * DownloadMyWeekendButton component tests (Round Two Features, "Download my
 * weekend" -- docs/0719_Round_Two_Features_v1.md, "Round-two proper").
 *
 * The button reuses DownloadSelectionButton and SavePhotosButton exactly as
 * FavoritesGallery pairs them (src/components/favorites/FavoritesGallery.tsx)
 * -- no forked ZIP/share-sheet logic here, so these tests exercise the real
 * child components (mocking only fetch and, where relevant, the Web Share
 * API, the same seams tests/downloads/save-photos-button.test.tsx already
 * uses) rather than stubbing them out. Covers exactly the scoped test list:
 * batching math end-to-end through rendered "Part N of M" controls
 * (including the exactly-50 and 51-photo boundaries), an empty person, and
 * that the control only renders once a person's photos are actually present
 * (never a bare/disabled control while nobody -- or nothing -- is selected).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DownloadMyWeekendButton } from "@/components/personalization/DownloadMyWeekendButton";
import { MAX_SELECTION_ITEMS } from "@/lib/downloads/contracts";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "canShare");
  Reflect.deleteProperty(navigator, "share");
  vi.restoreAllMocks();
});

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `photo-${i}`);
}

function mockCanShare(returns: boolean) {
  Object.defineProperty(navigator, "canShare", {
    value: vi.fn().mockReturnValue(returns),
    configurable: true,
  });
}

// --- Renders only once a person is selected (non-empty photo list) --------

describe("DownloadMyWeekendButton visibility", () => {
  it("renders nothing when photoIds is empty (no person selected yet, or still loading)", () => {
    const { container } = render(
      <DownloadMyWeekendButton personName="Rachel" personSlug="rachel" photoIds={[]} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the control once the person has at least one photo", () => {
    render(
      <DownloadMyWeekendButton personName="Rachel" personSlug="rachel" photoIds={ids(1)} />,
    );
    expect(screen.getByRole("button", { name: /download my weekend/i })).toBeDefined();
  });
});

// --- Empty person (batching-math edge case) --------------------------------

describe("DownloadMyWeekendButton empty person", () => {
  it("a person confirmed in zero photos renders exactly like nobody selected: nothing at all", () => {
    const { container } = render(
      <DownloadMyWeekendButton personName="Nobody Tagged" personSlug="nobody-tagged" photoIds={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// --- Batching math rendered as sequential, labeled parts -------------------

describe("DownloadMyWeekendButton batching", () => {
  it("under the cap renders a single 'Download my weekend' control, no part labeling", () => {
    render(
      <DownloadMyWeekendButton personName="Rachel" personSlug="rachel" photoIds={ids(12)} />,
    );
    expect(screen.getByRole("button", { name: /^download my weekend/i })).toBeDefined();
    expect(screen.queryByText(/part 1 of/i)).toBeNull();
  });

  it("at exactly MAX_SELECTION_ITEMS (boundary) still renders a single control, no split", () => {
    render(
      <DownloadMyWeekendButton
        personName="Rachel"
        personSlug="rachel"
        photoIds={ids(MAX_SELECTION_ITEMS)}
      />,
    );
    const downloadButtons = screen.getAllByRole("button", { name: /download/i });
    expect(downloadButtons).toHaveLength(1);
    expect(downloadButtons[0].textContent).toMatch(new RegExp(`\\(${MAX_SELECTION_ITEMS}\\)`));
    expect(screen.queryByText(/part 1 of/i)).toBeNull();
  });

  it("at MAX_SELECTION_ITEMS + 1 (boundary) splits into two labeled, sequential parts of 50 and 1", () => {
    render(
      <DownloadMyWeekendButton
        personName="Rachel"
        personSlug="rachel"
        photoIds={ids(MAX_SELECTION_ITEMS + 1)}
      />,
    );
    const part1 = screen.getByRole("button", { name: /download part 1 of 2/i });
    const part2 = screen.getByRole("button", { name: /download part 2 of 2/i });
    expect(part1.textContent).toMatch(new RegExp(`\\(${MAX_SELECTION_ITEMS}\\)`));
    expect(part2.textContent).toMatch(/\(1\)/);
    // No cap bypass: neither rendered batch ever exceeds MAX_SELECTION_ITEMS,
    // and nothing beyond a plain two-part split is implied for one-over.
    expect(screen.queryByRole("button", { name: /part 3/i })).toBeNull();
  });

  it("explains the split with clear progress copy naming the total part count", () => {
    render(
      <DownloadMyWeekendButton
        personName="Rachel"
        personSlug="rachel"
        photoIds={ids(MAX_SELECTION_ITEMS + 1)}
      />,
    );
    expect(screen.getByText(/comes in 2 parts/i)).toBeDefined();
  });

  it("a much larger person splits into three ordered parts of 50, 50, and the remainder", () => {
    const total = MAX_SELECTION_ITEMS * 2 + 17;
    render(
      <DownloadMyWeekendButton personName="Rachel" personSlug="rachel" photoIds={ids(total)} />,
    );
    const part1 = screen.getByRole("button", { name: /download part 1 of 3/i });
    const part2 = screen.getByRole("button", { name: /download part 2 of 3/i });
    const part3 = screen.getByRole("button", { name: /download part 3 of 3/i });
    expect(part1.textContent).toMatch(new RegExp(`\\(${MAX_SELECTION_ITEMS}\\)`));
    expect(part2.textContent).toMatch(new RegExp(`\\(${MAX_SELECTION_ITEMS}\\)`));
    expect(part3.textContent).toMatch(/\(17\)/);
  });
});

// --- Reuses the existing flow per batch (wired to the real child components) --

describe("DownloadMyWeekendButton flow reuse", () => {
  it("clicking a part's download control POSTs exactly that part's ids to the existing selection endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], maximumItems: MAX_SELECTION_ITEMS, estimatedBytes: 0 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const total = MAX_SELECTION_ITEMS + 1;
    render(
      <DownloadMyWeekendButton personName="Rachel" personSlug="rachel" photoIds={ids(total)} />,
    );

    const part2 = screen.getByRole("button", { name: /download part 2 of 2/i });
    part2.click();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/downloads/selection");
    const sentBody = JSON.parse((init as RequestInit).body as string) as { photoIds: string[] };
    // Exactly part 2's single remainder id -- never the full 51, never
    // bypassing the cap by sending everything in one call.
    expect(sentBody.photoIds).toEqual([`photo-${MAX_SELECTION_ITEMS}`]);
  });

  it("pairs a SavePhotosButton scoped to the same batch beside each download control, where the platform supports it", () => {
    mockCanShare(true);
    render(
      <DownloadMyWeekendButton
        personName="Rachel"
        personSlug="rachel"
        photoIds={ids(MAX_SELECTION_ITEMS + 1)}
      />,
    );
    expect(screen.getByRole("button", { name: /save part 1 of 2/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /save part 2 of 2/i })).toBeDefined();
  });

  it("renders no Save control at all on a platform without file-share support", () => {
    render(
      <DownloadMyWeekendButton personName="Rachel" personSlug="rachel" photoIds={ids(3)} />,
    );
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });
});
