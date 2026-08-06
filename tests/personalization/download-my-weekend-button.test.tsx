/**
 * DownloadMyWeekendButton component tests (Round Two Features, "Download my
 * weekend" -- docs/0719_Round_Two_Features_v1.md, "Round-two proper"; button
 * wall collapse from docs/BACKLOG.md, "The download button wall").
 *
 * The button reuses DownloadSelectionButton and SavePhotosButton exactly as
 * FavoritesGallery pairs them (src/components/favorites/FavoritesGallery.tsx)
 * -- no forked ZIP/share-sheet logic here, so these tests exercise the real
 * child components, mocking only fetch, the Web Share API where relevant
 * (the same seams tests/downloads/save-photos-button.test.tsx already uses),
 * and the on-demand ZIP engine module. Covers: a guest tagged in ANY number
 * of photos sees exactly ONE Download control and ONE Save control (never
 * the old per-50 button wall), one click prepares everything through
 * sequential bounded POSTs that never exceed the server cap, the share path
 * still works with the same collapse, and an empty person renders nothing.
 * The deeper batching seam (sequencing, cross-batch progress, mid-batch
 * failure) is specified against DownloadSelectionButton itself in
 * tests/downloads/download-selection-button.test.tsx.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DownloadMyWeekendButton } from "@/components/personalization/DownloadMyWeekendButton";
import { MAX_SELECTION_ITEMS, type OriginalDownload } from "@/lib/downloads/contracts";

const streamSelectionZip = vi.hoisted(() => vi.fn());
vi.mock("@/lib/downloads/stream-zip", () => ({ streamSelectionZip }));

afterEach(() => {
  cleanup();
  streamSelectionZip.mockReset();
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

function mockShare(impl: (data: { files: File[] }) => Promise<void>) {
  const share = vi.fn(impl);
  Object.defineProperty(navigator, "share", {
    value: share,
    configurable: true,
  });
  return share;
}

function itemFor(photoId: string): OriginalDownload {
  return {
    photoId,
    filename: `${photoId}.JPG`,
    bytes: 1000,
    sha256: "a".repeat(64),
    signedUrl: `https://example.test/signed/${photoId}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}

/** Answers each POST /api/downloads/selection with signed items for exactly
 *  the ids it asked for (recording every request's id list in order), and
 *  GETs of any signed URL with a tiny ok blob. */
function mockSelectionFetch() {
  const requestedBatches: string[][] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (urlOf(input).endsWith("/api/downloads/selection")) {
      const body = JSON.parse((init as RequestInit).body as string) as { photoIds: string[] };
      requestedBatches.push(body.photoIds);
      return {
        ok: true,
        json: async () => ({
          items: body.photoIds.map(itemFor),
          maximumItems: MAX_SELECTION_ITEMS,
          estimatedBytes: body.photoIds.length * 1000,
        }),
      } as Response;
    }
    return {
      ok: true,
      blob: async () => new Blob(["x"], { type: "image/jpeg" }),
    } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, requestedBatches };
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

  it("a person confirmed in zero photos renders exactly like nobody selected: nothing at all", () => {
    const { container } = render(
      <DownloadMyWeekendButton personName="Nobody Tagged" personSlug="nobody-tagged" photoIds={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the control once the person has at least one photo", () => {
    render(
      <DownloadMyWeekendButton personName="Rachel" personSlug="rachel" photoIds={ids(1)} />,
    );
    expect(screen.getByRole("button", { name: /download rachel's photos/i })).toBeDefined();
  });
});

// --- One control each, at any size (the button wall stays collapsed) ---------

describe("DownloadMyWeekendButton single-control collapse", () => {
  it("under the cap renders a single download control naming the person and count", () => {
    render(
      <DownloadMyWeekendButton personName="Rachel" personSlug="rachel" photoIds={ids(12)} />,
    );
    const download = screen.getByRole("button", { name: /download rachel's photos/i });
    expect(download.textContent).toMatch(/\(12\)/);
  });

  it("far over the cap (180 photos) STILL renders exactly one Download and one Save control, no part wall", () => {
    mockCanShare(true);
    const total = MAX_SELECTION_ITEMS * 3 + 30; // 180
    render(
      <DownloadMyWeekendButton personName="Rachel" personSlug="rachel" photoIds={ids(total)} />,
    );

    const downloadButtons = screen.getAllByRole("button", { name: /download/i });
    expect(downloadButtons).toHaveLength(1);
    expect(downloadButtons[0].textContent).toMatch(/\(180\)/);
    expect(screen.getAllByRole("button", { name: /save photos/i })).toHaveLength(1);

    // The old per-batch wall never comes back in any wording.
    expect(screen.queryByText(/part \d+ of \d+/i)).toBeNull();
    expect(screen.queryByText(/comes in \d+ parts/i)).toBeNull();
  });

  it("renders no Save control at all on a platform without file-share support", () => {
    render(
      <DownloadMyWeekendButton personName="Rachel" personSlug="rachel" photoIds={ids(3)} />,
    );
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });
});

// --- One click prepares everything, still within the server's cap ------------

describe("DownloadMyWeekendButton flow reuse", () => {
  it("one click on Download prepares ALL of the person's ids through sequential bounded POSTs", async () => {
    const { requestedBatches } = mockSelectionFetch();
    streamSelectionZip.mockImplementation(
      async ({ items }: { items: OriginalDownload[] }) => ({
        succeeded: items,
        failed: [],
        cancelled: false,
        usedFileSystemAccess: false,
      }),
    );

    const total = MAX_SELECTION_ITEMS * 3 + 30; // 180
    render(
      <DownloadMyWeekendButton personName="Rachel" personSlug="rachel" photoIds={ids(total)} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /download rachel's photos/i }));

    await screen.findByText(/180 photos downloaded\./i);

    // Every id went through, in order, and no single POST bypassed the cap.
    expect(requestedBatches.map((batch) => batch.length)).toEqual([50, 50, 50, 30]);
    expect(requestedBatches.flat()).toEqual(ids(total));

    // One combined ZIP stream, named for the person.
    expect(streamSelectionZip).toHaveBeenCalledTimes(1);
    const call = streamSelectionZip.mock.calls[0][0] as {
      items: OriginalDownload[];
      zipFilename: string;
    };
    expect(call.items).toHaveLength(total);
    expect(call.zipFilename).toBe("rachel-photos.zip");
  });

  it("the share path still works unchanged behind its single control (chunked, with the continue prompt)", async () => {
    mockCanShare(true);
    const share = mockShare(async () => {});
    mockSelectionFetch();

    render(
      <DownloadMyWeekendButton personName="Rachel" personSlug="rachel" photoIds={ids(12)} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save photos/i }));

    // SavePhotosButton's own chunking (10 per share) is untouched: first
    // chunk shares, then the existing continue prompt takes over.
    await screen.findByText(/shared 10 of 12, continue\?/i);
    expect(share).toHaveBeenCalledTimes(1);
    expect((share.mock.calls[0][0].files as File[]).length).toBe(10);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/12 photos shared\./i);
    expect(share).toHaveBeenCalledTimes(2);
  });
});
