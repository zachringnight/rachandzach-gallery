import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  // Vitest runs without globals, so testing-library's automatic
  // cleanup never registers; unmount between tests explicitly.
  cleanup();
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

  it("collapses overflow chips into a static +N indicator", () => {
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
        onChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    // Three chips collapse to the first plus "+2"; the indicator is
    // plain text, not a control.
    const overflow = screen.getByText("+2");
    expect(overflow.tagName).toBe("SPAN");
  });

  it("shows no +N indicator when a single filter is active", () => {
    render(
      <FilterBar
        facets={facets}
        filters={{ ...emptyFilters, event: "reception" }}
        total={96}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it("closes the filter panel after an event selection", () => {
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

    const toggle = screen.getByRole("button", { name: "Filters" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(
      screen.getByRole("button", { name: /The Reception/ }),
    );
    expect(onChange).toHaveBeenCalledWith({ event: "reception" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the filter panel after a person selection", () => {
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

    const toggle = screen.getByRole("button", { name: "Filters" });
    fireEvent.click(toggle);

    fireEvent.click(screen.getByRole("button", { name: "Rachel" }));
    expect(onChange).toHaveBeenCalledWith({ person: "rachel" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the panel open for orientation, source, and sort refinements", () => {
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

    const toggle = screen.getByRole("button", { name: "Filters" });
    fireEvent.click(toggle);

    fireEvent.click(screen.getByRole("button", { name: "Landscape" }));
    expect(onChange).toHaveBeenCalledWith({ orientation: "landscape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Guests" }));
    expect(onChange).toHaveBeenCalledWith({ source: "guest" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Newest" }));
    expect(onChange).toHaveBeenCalledWith({ sort: "newest" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
