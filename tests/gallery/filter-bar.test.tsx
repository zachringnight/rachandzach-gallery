import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilterBar } from "@/components/gallery/FilterBar";
import type {
  ClientGalleryFacets,
  GalleryFilterState,
} from "@/lib/gallery/client-types";

const facets: ClientGalleryFacets = {
  events: [{ slug: "reception", name: "The Reception", count: 96 }],
  people: [{ slug: "rachel", displayName: "Rachel", count: 34 }],
};

const emptyFilters: GalleryFilterState = {
  q: "",
  person: null,
  event: null,
  orientation: null,
  source: null,
  sort: "weekend",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("gallery discovery controls", () => {
  it("debounces metadata search into the shared URL filter state", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <FilterBar
        facets={facets}
        filters={emptyFilters}
        total={1721}
        onChange={onChange}
        onReset={vi.fn()}
      />,
    );

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search photos" }),
      { target: { value: "  Rachel   cake  " } },
    );
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onChange).toHaveBeenCalledWith({ q: "Rachel cake" });
  });

  it("shows removable chips and an active-filter count", () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        facets={facets}
        filters={{
          ...emptyFilters,
          q: "cake",
          event: "reception",
          person: "rachel",
        }}
        total={12}
        onChange={onChange}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("3 active filters").textContent).toBe("3");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove filter: The Reception" }),
    );
    expect(onChange).toHaveBeenCalledWith({ event: null });

    fireEvent.click(
      screen.getByRole("button", { name: "Remove filter: Search: cake" }),
    );
    expect(onChange).toHaveBeenCalledWith({ q: "" });
  });
});
