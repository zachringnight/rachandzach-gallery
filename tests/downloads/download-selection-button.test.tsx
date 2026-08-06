/**
 * DownloadSelectionButton component tests, focused on the batching seam that
 * lets one control accept a selection of ANY size (docs/BACKLOG.md, "The
 * download button wall"): all ids go in with one click, the signing POSTs
 * stay bounded to MAX_SELECTION_ITEMS and run strictly sequentially through
 * fetchSelectionDownloads, progress across those batches reads as one
 * operation on the existing button label ("Preparing 2 of 4..."), and a
 * failure mid-run surfaces the existing error/failed states instead of
 * pretending the rest succeeded. The ZIP engine itself
 * (@/lib/downloads/stream-zip, loaded on demand inside the click handler) is
 * mocked at the module seam -- it needs a real browser and is covered by
 * e2e -- so these tests observe exactly what the component hands it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DownloadSelectionButton } from "@/components/downloads/DownloadSelectionButton";
import { MAX_SELECTION_ITEMS, type OriginalDownload } from "@/lib/downloads/contracts";

const streamSelectionZip = vi.hoisted(() => vi.fn());
vi.mock("@/lib/downloads/stream-zip", () => ({ streamSelectionZip }));

afterEach(() => {
  cleanup();
  streamSelectionZip.mockReset();
  vi.restoreAllMocks();
});

// --- Test doubles ------------------------------------------------------------

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `photo-${i}`);
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

function selectionResponse(photoIds: string[]) {
  return {
    ok: true,
    json: async () => ({
      items: photoIds.map(itemFor),
      maximumItems: MAX_SELECTION_ITEMS,
      estimatedBytes: photoIds.length * 1000,
    }),
  } as Response;
}

/** Answers each POST /api/downloads/selection with signed items for exactly
 *  the ids it asked for, recording every request body's id list in order. */
function mockSelectionFetch() {
  const requestedBatches: string[][] = [];
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse((init as RequestInit).body as string) as { photoIds: string[] };
    requestedBatches.push(body.photoIds);
    return selectionResponse(body.photoIds);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, requestedBatches };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function completedStream(items: OriginalDownload[]) {
  return {
    succeeded: items,
    failed: [] as { item: OriginalDownload; message: string }[],
    cancelled: false,
    usedFileSystemAccess: false,
  };
}

function downloadButton() {
  return screen.getByRole("button", { name: /download all/i });
}

// --- All ids behind one click, POSTs bounded and complete --------------------

describe("DownloadSelectionButton large selections in one control", () => {
  it("takes all ids in one click and prepares them in sequential bounded POSTs covering every id in order", async () => {
    const { fetchMock, requestedBatches } = mockSelectionFetch();
    streamSelectionZip.mockImplementation(
      async ({ items }: { items: OriginalDownload[] }) => completedStream(items),
    );

    const total = MAX_SELECTION_ITEMS * 3 + 30; // 180
    render(<DownloadSelectionButton photoIds={ids(total)} />);
    fireEvent.click(downloadButton());

    await screen.findByText(/180 photos downloaded\./i);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(requestedBatches.map((batch) => batch.length)).toEqual([50, 50, 50, 30]);
    // Nothing dropped, duplicated, or reordered across the batch boundary.
    expect(requestedBatches.flat()).toEqual(ids(total));
    // Every POST respects the server's per-request cap.
    expect(requestedBatches.every((batch) => batch.length <= MAX_SELECTION_ITEMS)).toBe(true);
  });

  it("hands the combined selection to a single ZIP stream, so the download runs as one operation", async () => {
    mockSelectionFetch();
    streamSelectionZip.mockImplementation(
      async ({ items }: { items: OriginalDownload[] }) => completedStream(items),
    );

    const total = MAX_SELECTION_ITEMS + 10;
    render(<DownloadSelectionButton photoIds={ids(total)} zipFilename="rachel-photos.zip" />);
    fireEvent.click(downloadButton());

    await screen.findByText(/60 photos downloaded\./i);

    expect(streamSelectionZip).toHaveBeenCalledTimes(1);
    const call = streamSelectionZip.mock.calls[0][0] as {
      items: OriginalDownload[];
      zipFilename: string;
    };
    expect(call.items.map((item) => item.photoId)).toEqual(ids(total));
    // One combined stream keeps the caller's filename, no "-1-of-N" suffix.
    expect(call.zipFilename).toBe("rachel-photos.zip");
  });

  it("does not start signing batch N+1 until batch N has resolved", async () => {
    const requestedBatches: string[][] = [];
    const gates: { promise: Promise<void>; resolve: (value: void) => void }[] = [];
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse((init as RequestInit).body as string) as { photoIds: string[] };
      requestedBatches.push(body.photoIds);
      const gate = deferred<void>();
      gates.push(gate);
      await gate.promise;
      return selectionResponse(body.photoIds);
    }) as unknown as typeof fetch;
    streamSelectionZip.mockImplementation(
      async ({ items }: { items: OriginalDownload[] }) => completedStream(items),
    );

    render(<DownloadSelectionButton photoIds={ids(MAX_SELECTION_ITEMS * 2 + 1)} />);
    fireEvent.click(downloadButton());

    // Batch 1 is in flight; batches 2 and 3 must not have been issued.
    await vi.waitFor(() => expect(requestedBatches).toHaveLength(1));
    expect(requestedBatches).toHaveLength(1);

    gates[0].resolve();
    await vi.waitFor(() => expect(requestedBatches).toHaveLength(2));
    expect(requestedBatches).toHaveLength(2);

    gates[1].resolve();
    await vi.waitFor(() => expect(requestedBatches).toHaveLength(3));
    gates[2].resolve();

    await screen.findByText(/101 photos downloaded\./i);
  });
});

// --- Progress across batches reads as one operation --------------------------

describe("DownloadSelectionButton preparation progress", () => {
  it("shows 'Preparing N of M...' on the existing button while a multi-batch selection is signed", async () => {
    const gates: { promise: Promise<void>; resolve: (value: void) => void }[] = [];
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse((init as RequestInit).body as string) as { photoIds: string[] };
      const gate = deferred<void>();
      gates.push(gate);
      await gate.promise;
      return selectionResponse(body.photoIds);
    }) as unknown as typeof fetch;
    streamSelectionZip.mockImplementation(
      async ({ items }: { items: OriginalDownload[] }) => completedStream(items),
    );

    render(<DownloadSelectionButton photoIds={ids(MAX_SELECTION_ITEMS * 3 + 30)} />);
    fireEvent.click(downloadButton());

    await screen.findByRole("button", { name: /preparing 1 of 4/i });
    gates[0].resolve();
    await screen.findByRole("button", { name: /preparing 2 of 4/i });
    gates[1].resolve();
    await screen.findByRole("button", { name: /preparing 3 of 4/i });
    gates[2].resolve();
    await screen.findByRole("button", { name: /preparing 4 of 4/i });
    gates[3].resolve();

    await screen.findByText(/180 photos downloaded\./i);
  });

  it("keeps the plain 'Preparing...' label for a single-batch selection (no '1 of 1' noise)", async () => {
    const gate = deferred<void>();
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse((init as RequestInit).body as string) as { photoIds: string[] };
      await gate.promise;
      return selectionResponse(body.photoIds);
    }) as unknown as typeof fetch;
    streamSelectionZip.mockImplementation(
      async ({ items }: { items: OriginalDownload[] }) => completedStream(items),
    );

    render(<DownloadSelectionButton photoIds={ids(3)} />);
    fireEvent.click(downloadButton());

    await screen.findByRole("button", { name: /preparing\.\.\./i });
    expect(screen.queryByRole("button", { name: /preparing 1 of/i })).toBeNull();
    gate.resolve();

    await screen.findByText(/3 photos downloaded\./i);
  });
});

// --- Failures mid-run surface, nothing pretends to have succeeded ------------

describe("DownloadSelectionButton mid-run failure", () => {
  it("a signing POST failing mid-sequence stops the run and surfaces the server's error, issuing no further batches", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse((init as RequestInit).body as string) as { photoIds: string[] };
      callCount += 1;
      if (callCount === 3) {
        return {
          ok: false,
          json: async () => ({ error: "Sign in to download photos." }),
        } as Response;
      }
      return selectionResponse(body.photoIds);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<DownloadSelectionButton photoIds={ids(MAX_SELECTION_ITEMS * 3 + 30)} />);
    fireEvent.click(downloadButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/sign in to download photos/i);
    // Batch 3 of 4 failed: batch 4 is never requested, and nothing streams.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(streamSelectionZip).not.toHaveBeenCalled();
  });

  it("items that fail inside the ZIP stream keep the existing done-with-failures state and its retry", async () => {
    mockSelectionFetch();
    streamSelectionZip.mockImplementation(
      async ({ items }: { items: OriginalDownload[] }) => ({
        succeeded: items.slice(2),
        failed: items
          .slice(0, 2)
          .map((item) => ({ item, message: "Download failed." })),
        cancelled: false,
        usedFileSystemAccess: false,
      }),
    );

    const total = MAX_SELECTION_ITEMS + 10;
    render(<DownloadSelectionButton photoIds={ids(total)} />);
    fireEvent.click(downloadButton());

    // 58 succeeded, 2 failed -- the failures are surfaced, not absorbed.
    await screen.findByText(/58 photos downloaded, 2 failed\./i);
    const retry = screen.getByRole("button", { name: /retry 2 failed photos/i });

    streamSelectionZip.mockImplementation(
      async ({ items }: { items: OriginalDownload[] }) => completedStream(items),
    );
    fireEvent.click(retry);

    await screen.findByText(/2 photos downloaded\./i);
    // The retry streams exactly the two failed items, nothing else.
    const retryCall = streamSelectionZip.mock.calls.at(-1)?.[0] as { items: OriginalDownload[] };
    expect(retryCall.items.map((item) => item.photoId)).toEqual(["photo-0", "photo-1"]);
  });
});
