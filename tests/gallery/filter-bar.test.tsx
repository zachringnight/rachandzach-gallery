import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
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

  it("renders a server-derived Moment Search deep link open before hydration", () => {
    const html = renderToString(
      <FilterBar
        facets={facets}
        filters={emptyFilters}
        total={1721}
        onChange={vi.fn()}
        onReset={vi.fn()}
        momentSearchQuery="sunset kiss"
        momentSearchSlot={<p>Moment results</p>}
      />,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-open="true"');
    expect(html).toContain("Moment results");
  });

  it("hydrates the server-open Moment panel without a recoverable mismatch", async () => {
    const element = (
      <FilterBar
        facets={facets}
        filters={emptyFilters}
        total={1721}
        onChange={vi.fn()}
        onReset={vi.fn()}
        momentSearchQuery="sunset kiss"
        momentSearchSlot={<p>Moment results</p>}
      />
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    const root = hydrateRoot(container, element, { onRecoverableError });

    await act(async () => {
      await Promise.resolve();
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(
      container.querySelector('[aria-label="Moment search"]')?.getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
    await act(async () => root.unmount());
    container.remove();
  });

  it("opens and closes Moment Search when a same-route query prop changes", () => {
    const props = {
      facets,
      filters: emptyFilters,
      total: 1721,
      onChange: vi.fn(),
      onReset: vi.fn(),
      momentSearchSlot: <p>Moment results</p>,
    };
    const view = render(<FilterBar {...props} momentSearchQuery="" />);
    const momentToggle = screen.getByRole("button", { name: "Moment search" });

    expect(momentToggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Moment results")).toBeNull();

    view.rerender(
      <FilterBar {...props} momentSearchQuery="sunset kiss" />,
    );
    expect(momentToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Moment results")).toBeTruthy();

    view.rerender(<FilterBar {...props} momentSearchQuery="" />);
    expect(momentToggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Moment results")).toBeNull();
  });

  it("does not restore a stale Filters panel across Moment query versions", () => {
    const props = {
      facets,
      filters: emptyFilters,
      total: 1721,
      onChange: vi.fn(),
      onReset: vi.fn(),
      momentSearchSlot: <p>Moment results</p>,
    };
    const view = render(<FilterBar {...props} momentSearchQuery="" />);
    const filterToggle = screen.getByRole("button", { name: "Filters" });
    const momentToggle = screen.getByRole("button", { name: "Moment search" });

    fireEvent.click(filterToggle);
    expect(filterToggle.getAttribute("aria-expanded")).toBe("true");

    view.rerender(
      <FilterBar {...props} momentSearchQuery="sunset kiss" />,
    );
    expect(filterToggle.getAttribute("aria-expanded")).toBe("false");
    expect(momentToggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(momentToggle);
    expect(momentToggle.getAttribute("aria-expanded")).toBe("false");
    expect(filterToggle.getAttribute("aria-expanded")).toBe("false");

    view.rerender(<FilterBar {...props} momentSearchQuery="" />);
    expect(filterToggle.getAttribute("aria-expanded")).toBe("false");
  });

});
