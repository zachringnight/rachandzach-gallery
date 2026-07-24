import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyCurrentViewButton } from "@/components/ui/CopyCurrentViewButton";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

function installClipboard(writeText: (value: string) => Promise<void>) {
  const mock = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mock },
  });
  return mock;
}

function installExecCommand(result: boolean) {
  const mock = vi.fn().mockReturnValue(result);
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: mock,
  });
  return mock;
}

describe("CopyCurrentViewButton", () => {
  it("copies the full current filtered URL with the Clipboard API", async () => {
    window.history.replaceState(
      {},
      "",
      "/photos?q=first+dance&event=reception&sort=newest",
    );
    const writeText = installClipboard(async () => {});

    render(<CopyCurrentViewButton />);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy current view" }),
    );

    await screen.findByText("Copied");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(writeText.mock.calls[0][0]).toContain(
      "/photos?q=first+dance&event=reception&sort=newest",
    );
  });

  it("uses a temporary textarea fallback when the Clipboard API is unavailable", async () => {
    const execCommand = installExecCommand(true);
    window.history.replaceState({}, "", "/admin/catalog?event=ceremony");

    render(<CopyCurrentViewButton label="Copy admin view" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy admin view" }));

    await screen.findByText("Copied");
    expect(execCommand).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("shows a retry state when the Clipboard API rejects", async () => {
    installClipboard(async () => {
      throw new DOMException("Clipboard permission denied", "NotAllowedError");
    });

    render(<CopyCurrentViewButton />);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy current view" }),
    );

    await screen.findByText("Try again");
    expect(
      (
        screen.getByRole("button", {
          name: "Copy current view",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("shows a retry state when the legacy fallback cannot copy", async () => {
    const execCommand = installExecCommand(false);

    render(<CopyCurrentViewButton />);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy current view" }),
    );

    await waitFor(() => expect(screen.getByText("Try again")).toBeDefined());
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("disables overlapping copy attempts until the active write settles", async () => {
    let resolveCopy: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      resolveCopy = resolve;
    });
    const writeText = installClipboard(() => pending);

    render(<CopyCurrentViewButton />);
    const button = screen.getByRole("button", { name: "Copy current view" });
    fireEvent.click(button);

    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledTimes(1);

    resolveCopy?.();
    await screen.findByText("Copied");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
