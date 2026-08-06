import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonPicker } from "@/components/gallery/PersonPicker";
import type { ClientGalleryFacets } from "@/lib/gallery/client-types";

const people: ClientGalleryFacets["people"] = [
  { slug: "rach", displayName: "Rach", count: 12 },
  { slug: "zach", displayName: "Zach", count: 9 },
];

// No global test setup runs testing-library's auto-cleanup, and both tests
// query the same roles, so unmount between tests or the first render leaks
// into the second's queries.
afterEach(cleanup);

describe("PersonPicker", () => {
  it("announces the chip variant as the gallery's person filter", () => {
    render(<PersonPicker people={people} selected={null} onSelect={vi.fn()} />);

    const section = screen.getByRole("region", { name: "Filter by person" });
    expect(section.querySelector("h2")?.textContent).toBe("People");
  });

  it("announces the faces variant as choosing your own name, not filtering", () => {
    // The faces variant is the Find me surface (MyWeekendSetup): a guest is
    // locating themselves, so "Filter by person" misstates the page's job.
    render(
      <PersonPicker
        people={people}
        selected={null}
        onSelect={vi.fn()}
        variant="faces"
      />,
    );

    const section = screen.getByRole("region", { name: "Choose your name" });
    expect(section.querySelector("h2")?.textContent).toBe("Find your name");
    expect(
      screen.queryByRole("region", { name: "Filter by person" }),
    ).toBeNull();
  });
});
