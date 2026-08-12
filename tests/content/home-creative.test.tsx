import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Hero } from "@/components/site/Hero";
import { PhotoMarquee } from "@/components/site/PhotoMarquee";
import { storyPhotos } from "@/content/story-photos";

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

beforeEach(() => mockReducedMotion(false));

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
  vi.restoreAllMocks();
});

describe("homepage photo shortcuts", () => {
  it("keeps all five real jobs in one labeled shortcut nav", () => {
    render(<Hero />);

    const index = screen.getByRole("navigation", { name: "Photo shortcuts" });
    const links = Array.from(index.querySelectorAll("a"));

    expect(links).toHaveLength(5);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/my-weekend",
      "/photos",
      "/favorites",
      "/photos",
      "/add-yours",
    ]);
    expect(screen.queryByRole("navigation", { name: "Archive index" })).toBeNull();
  });
});

describe("homepage photo drift", () => {
  const photos = [storyPhotos.chapters.coast, storyPhotos.chapters.dancing];

  it("duplicates only the decorative track and lets a guest pause or resume it", async () => {
    const user = userEvent.setup();
    render(<PhotoMarquee photos={photos} />);

    const region = screen.getByRole("region", { name: "A few from the weekend" });
    const button = screen.getByRole("button", { name: "Pause" });
    const images = region.querySelectorAll("img");

    expect(images).toHaveLength(photos.length * 2);
    expect(Array.from(images).every((image) => image.alt === "")).toBe(true);
    expect(region.getAttribute("data-paused")).toBe("false");

    await user.click(button);
    expect(screen.getByRole("button", { name: "Play" })).toBe(button);
    expect(region.getAttribute("data-paused")).toBe("true");
    // The changing name is the state. aria-pressed on top of it would
    // announce "Play, pressed" while playback is stopped.
    expect(button.hasAttribute("aria-pressed")).toBe(false);

    await user.click(button);
    expect(screen.getByRole("button", { name: "Pause" })).toBe(button);
    expect(region.getAttribute("data-paused")).toBe("false");
  });

  it("reports motion as off when the OS reduced-motion preference is active", async () => {
    mockReducedMotion(true);
    render(<PhotoMarquee photos={photos} />);

    const region = screen.getByRole("region", { name: "A few from the weekend" });
    const button = await screen.findByRole("button", { name: "Paused by your settings" });

    await waitFor(() => expect(region.getAttribute("data-paused")).toBe("true"));
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("Motion is off in your device settings");
  });
});
