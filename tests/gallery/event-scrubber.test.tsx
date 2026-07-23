import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  computeEventBoundaries,
  EventScrubber,
} from "@/components/gallery/EventScrubber";
import type { ClientPhoto } from "@/lib/gallery/client-types";

afterEach(cleanup);

function photo(id: string, eventSlug: string, eventName: string): ClientPhoto {
  return {
    id,
    eventSlug,
    eventName,
    source: "photographer",
    orientation: "landscape",
    width: 1200,
    height: 800,
    aspectRatio: 1.5,
    capturedAt: null,
    people: [],
    keywords: [],
    previews: [],
  };
}

const boundaries = [
  { slug: "welcome", name: "Welcome Night", photoIndex: 0 },
  { slug: "ceremony", name: "Ceremony", photoIndex: 18 },
  { slug: "dancing", name: "Dancing", photoIndex: 44 },
];

describe("computeEventBoundaries", () => {
  it("keeps the first loaded index for each event", () => {
    expect(
      computeEventBoundaries([
        photo("1", "welcome", "Welcome Night"),
        photo("2", "welcome", "Welcome Night"),
        photo("3", "ceremony", "Ceremony"),
        photo("4", "welcome", "Welcome Night"),
        photo("5", "dancing", "Dancing"),
      ]),
    ).toEqual([
      { slug: "welcome", name: "Welcome Night", photoIndex: 0 },
      { slug: "ceremony", name: "Ceremony", photoIndex: 2 },
      { slug: "dancing", name: "Dancing", photoIndex: 4 },
    ]);
  });
});

describe("EventScrubber", () => {
  it("jumps with marker, range, and select controls", () => {
    const onJump = vi.fn();
    render(<EventScrubber boundaries={boundaries} onJump={onJump} />);

    fireEvent.click(screen.getByRole("button", { name: "Jump to Ceremony" }));
    expect(onJump).toHaveBeenLastCalledWith(18);
    expect(screen.getAllByText("Ceremony")).toHaveLength(2);

    fireEvent.change(screen.getByRole("slider", { name: "Scrub by event" }), {
      target: { value: "2" },
    });
    expect(onJump).toHaveBeenLastCalledWith(44);

    fireEvent.change(screen.getByRole("combobox", { name: "Jump to event" }), {
      target: { value: "welcome" },
    });
    expect(onJump).toHaveBeenLastCalledWith(0);
  });

  it("stays out of the way when only one event is loaded", () => {
    const { container } = render(
      <EventScrubber boundaries={[boundaries[0]]} onJump={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
