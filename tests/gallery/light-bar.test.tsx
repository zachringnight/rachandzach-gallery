// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LightBar } from "@/components/gallery/LightBar";
import type { ClientTimeline } from "@/lib/gallery/client-types";

afterEach(cleanup);

const timeline: ClientTimeline = {
  total: 100,
  segments: [
    {
      slug: "getting-ready",
      name: "Getting Ready",
      start: 0,
      count: 40,
      stops: [
        { at: 0.25, tint: "#8899aa", lum: 0.45 },
        { at: 0.75, tint: "#99a0aa", lum: 0.5 },
      ],
    },
    {
      slug: "ceremony",
      name: "Ceremony",
      start: 40,
      count: 35,
      stops: [{ at: 0.5, tint: "#d8c2a4", lum: 0.66 }],
    },
    {
      slug: "reception",
      name: "Reception",
      start: 75,
      count: 25,
      stops: [{ at: 0.5, tint: "#40342a", lum: 0.2 }],
    },
  ],
};

/**
 * The rail's hit area is the invisible range input stretched over the
 * segments, so segment clicks are judged by the rail's own pointer handlers
 * (see LightBar's pointer-routing comment). These helpers stand in for real
 * pointer gestures; jsdom has no layout, so the rail's rect is stubbed.
 */
function railOf(container: HTMLElement): HTMLElement {
  const rail = container.querySelector<HTMLElement>(".atlas-light-bar-rail");
  if (!rail) throw new Error("rail not rendered");
  // Vertical desktop rail: 20px wide, 200px tall, at the origin.
  rail.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 20,
      bottom: 200,
      width: 20,
      height: 200,
      toJSON: () => ({}),
    }) as DOMRect;
  return rail;
}

function firePointer(
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  at: { x: number; y: number },
) {
  const Ctor = window.PointerEvent ?? MouseEvent;
  const event = new Ctor(type, {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
  });
  if (!("pointerId" in event) || event.pointerId === undefined) {
    Object.defineProperty(event, "pointerId", { value: 1 });
  }
  element.dispatchEvent(event);
}

describe("LightBar", () => {
  it("renders one pointer target per segment and jumps to its start", () => {
    const onJump = vi.fn();
    render(
      <LightBar
        timeline={timeline}
        photos={[]}
        currentIndex={0}
        onJump={onJump}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Jump to Reception" }));
    expect(onJump).toHaveBeenCalledWith(75);
  });

  it("tints segments only from the timeline's sampled stops", () => {
    render(
      <LightBar
        timeline={timeline}
        photos={[]}
        currentIndex={0}
        onJump={vi.fn()}
      />,
    );
    const segment = screen.getByRole("button", { name: "Jump to Ceremony" });
    expect(segment.style.getPropertyValue("--rz-light-stops")).toContain(
      "#d8c2a4",
    );
  });

  it("mirrors the rail with a labelled range and an event select", () => {
    const onJump = vi.fn();
    render(
      <LightBar
        timeline={timeline}
        photos={[]}
        currentIndex={50}
        onJump={onJump}
      />,
    );
    const slider = screen.getByRole("slider", {
      name: "Scrub through the day",
    });
    expect(slider.getAttribute("aria-valuetext")).toContain("Ceremony");

    const select = screen.getByRole("combobox", { name: "Jump to event" });
    fireEvent.change(select, { target: { value: "getting-ready-0" } });
    expect(onJump).toHaveBeenCalledWith(0);
  });

  it("commits a debounced scrub from the range input", () => {
    vi.useFakeTimers();
    try {
      const onJump = vi.fn();
      render(
        <LightBar
          timeline={timeline}
          photos={[]}
          currentIndex={0}
          onJump={onJump}
        />,
      );
      const slider = screen.getByRole("slider", {
        name: "Scrub through the day",
      });
      fireEvent.change(slider, { target: { value: "90" } });
      expect(onJump).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(onJump).toHaveBeenCalledWith(90);
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes a stationary press on the rail to the segment under it", () => {
    // Regression: the range input sits on top of the segment buttons, so a
    // mouse click lands on the range, not the button, and used to scrub to
    // an approximate coordinate. A clean click must jump to the START of
    // the named segment under the pointer.
    vi.useFakeTimers();
    try {
      const onJump = vi.fn();
      const { container } = render(
        <LightBar
          timeline={timeline}
          photos={[]}
          currentIndex={0}
          onJump={onJump}
        />,
      );
      const rail = railOf(container);
      // y=170 of 200 -> fraction 0.85 -> photo 85, inside Reception (75-99).
      firePointer(rail, "pointerdown", { x: 10, y: 170 });
      firePointer(rail, "pointerup", { x: 10, y: 170 });
      expect(onJump).toHaveBeenCalledTimes(1);
      expect(onJump).toHaveBeenCalledWith(75);
      // The click cancels any queued approximate scrub commit.
      vi.advanceTimersByTime(400);
      expect(onJump).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a drag on the rail to the range's scrubbing", () => {
    vi.useFakeTimers();
    try {
      const onJump = vi.fn();
      const { container } = render(
        <LightBar
          timeline={timeline}
          photos={[]}
          currentIndex={0}
          onJump={onJump}
        />,
      );
      const rail = railOf(container);
      firePointer(rail, "pointerdown", { x: 10, y: 40 });
      firePointer(rail, "pointermove", { x: 10, y: 120 });
      firePointer(rail, "pointerup", { x: 10, y: 160 });
      // No segment-click jump; the native range drag (change events, tested
      // above) is the only thing that commits a scrub.
      vi.advanceTimersByTime(400);
      expect(onJump).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the active segment from the current scroll position", () => {
    render(
      <LightBar
        timeline={timeline}
        photos={[]}
        currentIndex={80}
        onJump={vi.fn()}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Jump to Reception" })
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Jump to Ceremony" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("renders nothing without at least two segments", () => {
    const { container } = render(
      <LightBar
        timeline={{ total: 10, segments: [timeline.segments[0]] }}
        photos={[]}
        currentIndex={0}
        onJump={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
