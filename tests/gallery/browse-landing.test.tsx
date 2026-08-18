import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";

import { BrowseLanding } from "@/components/gallery/BrowseLanding";
import { MOMENT_SEARCH_MAX_QUERY_LENGTH } from "@/lib/search/contracts";

afterEach(() => {
  cleanup();
});

describe("browse landing search", () => {
  it("submits Moment Search q, not catalog gallery_q", () => {
    render(
      <BrowseLanding
        totalPhotos={1721}
        events={[]}
        faces={[]}
        taggedPeople={0}
        momentSearch
      />,
    );

    expect(screen.getByLabelText("Describe a moment")).toHaveAttribute("name", "q");
    expect(screen.getByLabelText("Describe a moment")).toHaveAttribute(
      "maxLength",
      String(MOMENT_SEARCH_MAX_QUERY_LENGTH),
    );
    expect(screen.getByRole("search")).toHaveAttribute("action", "/photos");
    expect(screen.getByRole("link", { name: "sunset kiss" })).toHaveAttribute(
      "href",
      "/photos?q=sunset%20kiss",
    );
  });
});
