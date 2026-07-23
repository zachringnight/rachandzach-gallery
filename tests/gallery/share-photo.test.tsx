import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SharePhotoButton } from "@/components/gallery/SharePhotoButton";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

function installClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("SharePhotoButton", () => {
  it("uses the private permalink with the native share sheet", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });

    render(<SharePhotoButton photoId="photo one" />);
    fireEvent.click(screen.getByRole("button", { name: "Share photo link" }));

    await waitFor(() => {
      expect(share).toHaveBeenCalledWith({
        url: `${window.location.origin}/photos/photo%20one`,
      });
    });
  });

  it("copies the permalink when native sharing is unavailable", async () => {
    const writeText = installClipboard();

    render(<SharePhotoButton photoId="abc/123" label="Send" />);
    fireEvent.click(screen.getByRole("button", { name: "Send photo link" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/photos/abc%2F123`,
      );
      expect(
        within(screen.getByRole("button", { name: "Send photo link" })).getByText(
          "Link copied",
        ),
      ).toBeDefined();
    });
  });

  it("treats a cancelled native share as a quiet no-op", async () => {
    const share = vi
      .fn()
      .mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    const writeText = installClipboard();

    render(<SharePhotoButton photoId="photo-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Share photo link" }));

    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByText("Link copied")).toBeNull();
  });
});
