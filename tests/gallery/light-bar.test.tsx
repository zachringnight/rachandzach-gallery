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
