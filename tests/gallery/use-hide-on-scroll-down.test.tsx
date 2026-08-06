// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHideOnScrollDown } from "@/components/gallery/useHideOnScrollDown";

function Probe() {
  const hidden = useHideOnScrollDown();
  return <output>{hidden ? "hidden" : "shown"}</output>;
}

function scrollTo(y: number) {
  act(() => {
    Object.defineProperty(window, "scrollY", { value: y, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    vi.runAllTimers();
  });
}

describe("useHideOnScrollDown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no rAF; the hook throttles through it.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      return window.setTimeout(() => cb(performance.now()), 0);
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      window.clearTimeout(id);
    });
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("stays shown near the top of the page", () => {
    render(<Probe />);
    scrollTo(120);
    expect(screen.getByRole("status", { hidden: true }).textContent ?? "").not.toBe(
      "hidden",
    );
  });

  it("hides on a downward scroll past the activation offset", () => {
    render(<Probe />);
    scrollTo(300);
    scrollTo(420);
    expect(screen.getByText("hidden")).toBeInTheDocument();
  });

  it("ignores a tiny upward wobble but returns on a real upward gesture", () => {
    render(<Probe />);
    scrollTo(300);
    scrollTo(500);
    expect(screen.getByText("hidden")).toBeInTheDocument();
    scrollTo(495);
    expect(screen.getByText("hidden")).toBeInTheDocument();
    scrollTo(440);
    expect(screen.getByText("shown")).toBeInTheDocument();
  });

  it("always shows again at the top regardless of history", () => {
    render(<Probe />);
    scrollTo(300);
    scrollTo(600);
    expect(screen.getByText("hidden")).toBeInTheDocument();
    scrollTo(80);
    expect(screen.getByText("shown")).toBeInTheDocument();
  });
});
