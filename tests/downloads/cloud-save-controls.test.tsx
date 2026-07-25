import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloudSaveControls } from "@/components/downloads/CloudSaveControls";
import type { OriginalDownload } from "@/lib/downloads/contracts";

const cloudMocks = vi.hoisted(() => ({
  loadDropboxSaverScript: vi.fn(),
  loadGoogleIdentityScript: vi.fn(),
  requestGoogleDriveToken: vi.fn(),
  uploadOriginalToGoogleDrive: vi.fn(),
}));

const selectionMocks = vi.hoisted(() => ({
  fetchSelectionDownloads: vi.fn(),
}));

vi.mock("@/lib/downloads/cloud-save", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/downloads/cloud-save")>();
  return {
    ...actual,
    ...cloudMocks,
  };
});

vi.mock("@/components/downloads/fetch-selection", () => ({
  fetchSelectionDownloads: selectionMocks.fetchSelectionDownloads,
  SelectionPreparationError: class SelectionPreparationError extends Error {},
}));

function item(
  photoId: string,
  expiresInMilliseconds = 30 * 60 * 1000,
): OriginalDownload {
  return {
    photoId,
    filename: `${photoId}.jpg`,
    bytes: 5,
    sha256: "a".repeat(64),
    signedUrl: `https://storage.example.test/${photoId}`,
    expiresAt: new Date(Date.now() + expiresInMilliseconds).toISOString(),
  };
}

function selection(items: OriginalDownload[]) {
  return {
    items,
    maximumItems: 50,
    estimatedBytes: items.reduce((total, current) => total + current.bytes, 0),
  };
}

function installDropbox(save: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, "Dropbox", {
    configurable: true,
    value: {
      isBrowserSupported: vi.fn().mockReturnValue(true),
      save,
    },
  });
}

beforeEach(() => {
  cloudMocks.loadDropboxSaverScript.mockResolvedValue(undefined);
  cloudMocks.loadGoogleIdentityScript.mockResolvedValue(undefined);
  cloudMocks.requestGoogleDriveToken.mockResolvedValue("drive-token");
  cloudMocks.uploadOriginalToGoogleDrive.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "Dropbox");
  vi.clearAllMocks();
});

describe("CloudSaveControls", () => {
  it("uses a lazy two-click Google Drive flow", async () => {
    const original = item("photo-1");
    selectionMocks.fetchSelectionDownloads.mockResolvedValue(
      selection([original]),
    );

    render(
      <CloudSaveControls
        photoIds={[original.photoId]}
        googleClientId="google-client-id"
      />,
    );

    const googleButton = screen.getByRole("button", { name: "Google Drive" });
    expect(
      googleButton.closest(".atlas-cloud-save-actions"),
    ).not.toBeNull();
    expect(
      googleButton.closest(".atlas-cloud-save-controls"),
    ).not.toBeNull();
    fireEvent.click(googleButton);

    expect(cloudMocks.loadGoogleIdentityScript).toHaveBeenCalledTimes(1);
    expect(cloudMocks.requestGoogleDriveToken).not.toHaveBeenCalled();
    expect(selectionMocks.fetchSelectionDownloads).not.toHaveBeenCalled();

    const continueButton = await screen.findByRole("button", {
      name: "Continue to Google Drive",
    });
    fireEvent.click(continueButton);

    expect(
      await screen.findByText("1 photo saved to Google Drive."),
    ).toBeTruthy();
    expect(cloudMocks.requestGoogleDriveToken).toHaveBeenCalledWith(
      "google-client-id",
    );
    expect(selectionMocks.fetchSelectionDownloads).toHaveBeenCalledWith(
      [original.photoId],
      "Could not get your photos ready for Google Drive.",
      { signal: expect.any(AbortSignal) },
    );
    expect(cloudMocks.uploadOriginalToGoogleDrive).toHaveBeenCalledWith(
      original,
      "drive-token",
      fetch,
      { signal: expect.any(AbortSignal) },
    );
  });

  it("surfaces a synchronous Dropbox Saver failure and leaves a retry action", async () => {
    const original = item("photo-1");
    const save = vi.fn(() => {
      throw new Error("Dropbox popup was blocked.");
    });
    installDropbox(save);
    selectionMocks.fetchSelectionDownloads.mockResolvedValue(
      selection([original]),
    );

    render(
      <CloudSaveControls
        photoIds={[original.photoId]}
        dropboxAppKey="dropbox-app-key"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dropbox" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue to Dropbox" }),
    );

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Dropbox popup was blocked.",
    );
    const retry = screen.getByRole("button", {
      name: "Try Dropbox again",
    });
    expect(retry.hasAttribute("disabled")).toBe(false);

    fireEvent.click(retry);
    await screen.findByRole("button", { name: "Continue to Dropbox" });
    expect(selectionMocks.fetchSelectionDownloads).toHaveBeenCalledTimes(2);
  });

  it("re-signs expiring Dropbox URLs instead of opening Saver", async () => {
    const expiring = item("photo-1", 60_000);
    const refreshed = item("photo-1", 30 * 60 * 1000);
    const save = vi.fn();
    installDropbox(save);
    selectionMocks.fetchSelectionDownloads
      .mockResolvedValueOnce(selection([expiring]))
      .mockResolvedValueOnce(selection([refreshed]));

    render(
      <CloudSaveControls
        photoIds={[expiring.photoId]}
        dropboxAppKey="dropbox-app-key"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dropbox" }));
    const firstContinue = await screen.findByRole("button", {
      name: "Continue to Dropbox",
    });
    fireEvent.click(firstContinue);

    await waitFor(() => {
      expect(selectionMocks.fetchSelectionDownloads).toHaveBeenCalledTimes(2);
    });
    expect(save).not.toHaveBeenCalled();
    await screen.findByRole("button", { name: "Continue to Dropbox" });

    fireEvent.click(
      screen.getByRole("button", { name: "Continue to Dropbox" }),
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          {
            url: refreshed.signedUrl,
            filename: refreshed.filename,
          },
        ],
      }),
    );
  });

  it("blocks Dropbox before preparing more than 100 photos and recovers after narrowing", async () => {
    const oversizedIds = Array.from(
      { length: 101 },
      (_, index) => `photo-${index + 1}`,
    );
    installDropbox(vi.fn());

    const { rerender } = render(
      <CloudSaveControls
        photoIds={oversizedIds}
        dropboxAppKey="dropbox-app-key"
      />,
    );

    const blockedButton = screen.getByRole("button", { name: "Dropbox" });
    expect(blockedButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status")).toHaveProperty(
      "textContent",
      "Dropbox can save up to 100 photos at once. Select 100 or fewer to continue.",
    );
    fireEvent.click(blockedButton);
    expect(cloudMocks.loadDropboxSaverScript).not.toHaveBeenCalled();
    expect(selectionMocks.fetchSelectionDownloads).not.toHaveBeenCalled();

    const allowedIds = oversizedIds.slice(0, 100);
    selectionMocks.fetchSelectionDownloads.mockResolvedValue(
      selection(allowedIds.map((photoId) => item(photoId))),
    );
    rerender(
      <CloudSaveControls
        photoIds={allowedIds}
        dropboxAppKey="dropbox-app-key"
      />,
    );

    const enabledButton = screen.getByRole("button", { name: "Dropbox" });
    expect(enabledButton.hasAttribute("disabled")).toBe(false);
    expect(
      screen.queryByText(/Dropbox can save up to 100 photos/i),
    ).toBeNull();
    fireEvent.click(enabledButton);
    await screen.findByRole("button", { name: "Continue to Dropbox" });
    expect(selectionMocks.fetchSelectionDownloads).toHaveBeenCalledTimes(1);
  });

  it("aborts and ignores preparation work from a previous selection", async () => {
    const oldItem = item("old-photo");
    const newItem = item("new-photo");
    let resolveOld:
      | ((value: ReturnType<typeof selection>) => void)
      | undefined;
    const oldSelection = new Promise<ReturnType<typeof selection>>((resolve) => {
      resolveOld = resolve;
    });
    let oldSignal: AbortSignal | undefined;
    selectionMocks.fetchSelectionDownloads.mockImplementation(
      (
        ids: string[],
        _message: string,
        options?: { signal?: AbortSignal },
      ) => {
        if (ids[0] === oldItem.photoId) {
          oldSignal = options?.signal;
          return oldSelection;
        }
        return Promise.resolve(selection([newItem]));
      },
    );
    installDropbox(vi.fn());

    const { rerender } = render(
      <CloudSaveControls
        photoIds={[oldItem.photoId]}
        dropboxAppKey="dropbox-app-key"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dropbox" }));

    await waitFor(() => expect(oldSignal).toBeDefined());
    rerender(
      <CloudSaveControls
        photoIds={[newItem.photoId]}
        dropboxAppKey="dropbox-app-key"
      />,
    );
    await waitFor(() => expect(oldSignal?.aborted).toBe(true));

    resolveOld?.(selection([oldItem]));
    await Promise.resolve();
    expect(
      screen.queryByRole("button", { name: "Continue to Dropbox" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dropbox" }));
    await screen.findByRole("button", { name: "Continue to Dropbox" });
    expect(selectionMocks.fetchSelectionDownloads).toHaveBeenLastCalledWith(
      [newItem.photoId],
      "Could not get your photos ready for Dropbox.",
      { signal: expect.any(AbortSignal) },
    );
  });
});
