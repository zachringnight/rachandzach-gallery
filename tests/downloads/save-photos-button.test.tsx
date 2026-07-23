/**
 * SavePhotosButton component tests (Round Two Features, "Save photos" --
 * docs/0719_Round_Two_Features_v1.md, Zach approved iCloud-via-share-sheet
 * 2026-07-22). Mocks navigator.canShare/navigator.share directly (jsdom
 * does not implement the Web Share API) and fetch (both the
 * POST /api/downloads/selection call DownloadSelectionButton also uses, and
 * the per-photo signed-URL GETs). Covers exactly the scoped test list:
 * renders only when canShare passes the files probe; chunking math is wired
 * through to real sequential navigator.share() calls; an AbortError
 * mid-sequence stops cleanly (not an error state); an unsupported browser
 * renders nothing. A couple of small supporting assertions (aria-busy, and
 * that a genuine share() failure IS still a real error) round out the
 * behavior spec without expanding past that scope.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SavePhotosButton } from "@/components/downloads/SavePhotosButton";
import type { OriginalDownload } from "@/lib/downloads/contracts";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "canShare");
  Reflect.deleteProperty(navigator, "share");
  vi.restoreAllMocks();
});

// --- Test doubles ------------------------------------------------------------

function mockCanShare(returns: boolean) {
  const canShare = vi.fn().mockReturnValue(returns);
  Object.defineProperty(navigator, "canShare", {
    value: canShare,
    configurable: true,
  });
  return canShare;
}

function mockShare(impl: (data: { files: File[] }) => Promise<void>) {
  const share = vi.fn(impl);
  Object.defineProperty(navigator, "share", {
    value: share,
    configurable: true,
  });
  return share;
}

function fixtureItems(count: number): OriginalDownload[] {
  return Array.from({ length: count }, (_, i) => ({
    photoId: `photo-${i}`,
    filename: `IMG_${String(i).padStart(4, "0")}.JPG`,
    bytes: 1000,
    sha256: "a".repeat(64),
    signedUrl: `https://example.test/signed/photo-${i}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }));
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}

/** Serves POST /api/downloads/selection from `items`, and GETs of each
 *  item's signedUrl as a tiny ok blob response. */
function mockFetchFor(items: OriginalDownload[]) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.endsWith("/api/downloads/selection")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          items,
          maximumItems: 50,
          estimatedBytes: items.reduce((sum, item) => sum + item.bytes, 0),
        }),
      } as Response);
    }
    const item = items.find((candidate) => candidate.signedUrl === url);
    if (!item) return Promise.resolve({ ok: false } as Response);
    return Promise.resolve({
      ok: true,
      blob: async () => new Blob(["x"], { type: "image/jpeg" }),
    } as Response);
  }) as unknown as typeof fetch;
}

function saveButton() {
  return screen.getByRole("button", { name: "Save photos" });
}

// --- Feature detection ---------------------------------------------------

describe("SavePhotosButton feature detection", () => {
  it("renders nothing at all when navigator.canShare does not exist (unsupported browser)", () => {
    const { container } = render(<SavePhotosButton photoIds={["a"]} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing when canShare exists but rejects a files share", () => {
    mockCanShare(false);
    const { container } = render(<SavePhotosButton photoIds={["a"]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the Save photos button when canShare accepts a files share", () => {
    mockCanShare(true);
    render(<SavePhotosButton photoIds={["a"]} />);
    expect(saveButton()).toBeDefined();
  });

  it("passes a files probe to canShare, not an empty/text-only call", () => {
    const canShare = mockCanShare(true);
    render(<SavePhotosButton photoIds={["a"]} />);
    const arg = canShare.mock.calls[0][0] as { files?: File[] };
    expect(arg.files).toBeDefined();
    expect(arg.files).toHaveLength(1);
  });
});

// --- Chunked sharing (wiring for the counts/byte-cap math) --------------------

describe("SavePhotosButton chunked sharing", () => {
  it("shares a small selection in a single navigator.share() call and lands on Done", async () => {
    mockCanShare(true);
    const items = fixtureItems(3);
    mockFetchFor(items);
    const share = mockShare(async () => {});

    render(<SavePhotosButton photoIds={items.map((item) => item.photoId)} />);
    fireEvent.click(saveButton());

    // Synchronously busy the instant the click is handled, before any fetch
    // resolves (real button semantics + aria-busy during fetch).
    expect(saveButton().getAttribute("aria-busy")).toBe("true");

    await screen.findByText(/3 photos shared\./i);
    expect(share).toHaveBeenCalledTimes(1);
    const filesArg = share.mock.calls[0][0].files as File[];
    expect(filesArg).toHaveLength(3);
    expect(filesArg.every((file) => file.type === "image/jpeg")).toBe(true);
    expect(filesArg.map((file) => file.name)).toEqual(items.map((item) => item.filename));
  });

  it("splits a 15-photo selection into chunks of 10 then 5, sequentially, with a continue prompt between them", async () => {
    mockCanShare(true);
    const items = fixtureItems(15);
    mockFetchFor(items);
    const share = mockShare(async () => {});

    render(<SavePhotosButton photoIds={items.map((item) => item.photoId)} />);
    fireEvent.click(saveButton());

    await screen.findByText(/shared 10 of 15, continue\?/i);
    expect(share).toHaveBeenCalledTimes(1);
    expect((share.mock.calls[0][0].files as File[]).length).toBe(10);
    // Only asks to continue; does not auto-fire the next chunk on its own.
    expect(share).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByText(/15 photos shared\./i);
    expect(share).toHaveBeenCalledTimes(2);
    expect((share.mock.calls[1][0].files as File[]).length).toBe(5);
  });

  it("stops after the current chunk when the guest picks Stop for now instead of Continue", async () => {
    mockCanShare(true);
    const items = fixtureItems(12);
    mockFetchFor(items);
    const share = mockShare(async () => {});

    render(<SavePhotosButton photoIds={items.map((item) => item.photoId)} />);
    fireEvent.click(saveButton());

    await screen.findByText(/shared 10 of 12, continue\?/i);
    fireEvent.click(screen.getByRole("button", { name: "Stop for now" }));

    await screen.findByText(/10 photos shared\./i);
    expect(share).toHaveBeenCalledTimes(1);
  });
});

// --- Abort handling ("cancelled", never "error") ------------------------------

describe("SavePhotosButton abort handling", () => {
  it("treats the guest closing the native share sheet as a graceful cancel, not an error", async () => {
    mockCanShare(true);
    const items = fixtureItems(3);
    mockFetchFor(items);
    mockShare(async () => {
      throw new DOMException("The user aborted a request.", "AbortError");
    });

    render(<SavePhotosButton photoIds={items.map((item) => item.photoId)} />);
    fireEvent.click(saveButton());

    await screen.findByText(/^save cancelled\.$/i);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stops cleanly mid-sequence: an AbortError on chunk 2 does not touch chunk 3 and is not an error state", async () => {
    mockCanShare(true);
    // 25 items -> three chunks of 10, 10, 5.
    const items = fixtureItems(25);
    mockFetchFor(items);
    const share = vi
      .fn()
      .mockResolvedValueOnce(undefined) // chunk 1 (10 files): shares fine
      .mockRejectedValueOnce(new DOMException("closed", "AbortError")); // chunk 2: guest closes the sheet
    Object.defineProperty(navigator, "share", { value: share, configurable: true });

    render(<SavePhotosButton photoIds={items.map((item) => item.photoId)} />);
    fireEvent.click(saveButton());

    await screen.findByText(/shared 10 of 25, continue\?/i);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByText(/save cancelled\. 10 photos already shared\./i);

    // The abort on chunk 2 must stop the sequence -- chunk 3 (the remaining
    // 5 files) is never attempted, and this never becomes an "error".
    expect(share).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });
});

// --- Real failures still surface as errors (distinct from a graceful cancel) --

describe("SavePhotosButton genuine failures", () => {
  it("shows an error (not a cancel) when navigator.share fails for a reason other than AbortError", async () => {
    mockCanShare(true);
    const items = fixtureItems(2);
    mockFetchFor(items);
    mockShare(async () => {
      throw new Error("NotAllowedError");
    });

    render(<SavePhotosButton photoIds={items.map((item) => item.photoId)} />);
    fireEvent.click(saveButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not open the share sheet/i);
    // The main button is usable again to retry, not stuck disabled.
    expect(saveButton().hasAttribute("disabled")).toBe(false);
  });

  it("surfaces the selection endpoint's error message when the initial fetch fails", async () => {
    mockCanShare(true);
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Sign in to download photos." }),
    }) as unknown as typeof fetch;

    render(<SavePhotosButton photoIds={["a"]} />);
    fireEvent.click(saveButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/sign in to download photos/i);
  });
});
