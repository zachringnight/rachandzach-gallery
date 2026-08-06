import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PhotoImage } from "@/components/gallery/PhotoImage";
import type { ClientPhoto } from "@/lib/gallery/client-types";

afterEach(cleanup);

function photo(id: string, suffix = ""): ClientPhoto {
  return {
    id,
    eventSlug: "ceremony",
    eventName: "Ceremony",
    source: "photographer",
    orientation: "landscape",
    width: 2400,
    height: 1600,
    aspectRatio: 1.5,
    capturedAt: null,
    people: [],
    keywords: [],
    previews: [
      {
        url: `https://images.test/${id}-480${suffix}.webp`,
        width: 480,
        height: 320,
        format: "webp",
      },
      {
        url: `https://images.test/${id}-960${suffix}.webp`,
        width: 960,
        height: 640,
        format: "webp",
      },
      {
        url: `https://images.test/${id}-1600${suffix}.webp`,
        width: 1600,
        height: 1067,
        format: "webp",
      },
    ],
  };
}

describe("PhotoImage", () => {
  it("uses the smallest sufficient card preview and crossfades after load", () => {
    const onLoad = vi.fn();
    const { container } = render(
      <PhotoImage
        photo={photo("a")}
        alt="A photo"
        tier="card"
        targetWidth={900}
        onLoad={onLoad}
      />,
    );

    const wrapper = container.querySelector(".atlas-photo-image");
    const target = screen.getByAltText("A photo");
    const placeholder = container.querySelector(".atlas-photo-image-placeholder");
    expect(target.getAttribute("src")).toContain("a-960");
    expect(placeholder?.getAttribute("src")).toContain("a-480");
    expect(wrapper?.getAttribute("data-loaded")).toBe("false");

    fireEvent.load(target);
    expect(wrapper?.getAttribute("data-loaded")).toBe("true");
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it("uses the largest preview for lightbox and resets state for a new URL", () => {
    const { container, rerender } = render(
      <PhotoImage photo={photo("a")} alt="A photo" tier="lightbox" />,
    );
    fireEvent.load(screen.getByAltText("A photo"));
    expect(
      container
        .querySelector(".atlas-photo-image")
        ?.getAttribute("data-loaded"),
    ).toBe("true");
    expect(screen.getByAltText("A photo").getAttribute("src")).toContain("a-1600");

    rerender(<PhotoImage photo={photo("b")} alt="B photo" tier="lightbox" />);
    expect(screen.getByAltText("B photo").getAttribute("src")).toContain("b-1600");
    expect(
      container
        .querySelector(".atlas-photo-image")
        ?.getAttribute("data-loaded"),
    ).toBe("false");
  });

  it("renders <picture> with an AVIF source and the same-width WebP as the img src", () => {
    const dual = photo("d");
    dual.previews = [
      { url: "https://images.test/d-480.webp", width: 480, height: 320, format: "webp" },
      { url: "https://images.test/d-480.avif", width: 480, height: 320, format: "avif" },
      { url: "https://images.test/d-960.webp", width: 960, height: 640, format: "webp" },
      { url: "https://images.test/d-960.avif", width: 960, height: 640, format: "avif" },
    ];
    const { container } = render(
      <PhotoImage photo={dual} alt="D photo" tier="card" targetWidth={900} />,
    );

    const target = screen.getByAltText("D photo");
    // The browser negotiates: AVIF rides the <source>, WebP is the <img src>.
    expect(target.getAttribute("src")).toBe("https://images.test/d-960.webp");
    const targetSource = target.closest("picture")?.querySelector("source");
    expect(targetSource?.getAttribute("type")).toBe("image/avif");
    expect(targetSource?.getAttribute("srcset")).toBe(
      "https://images.test/d-960.avif",
    );

    // The blurred placeholder gets the same treatment at the smallest width.
    const placeholder = container.querySelector(
      ".atlas-photo-image-placeholder",
    );
    expect(placeholder?.getAttribute("src")).toBe(
      "https://images.test/d-480.webp",
    );
    const placeholderSource = placeholder
      ?.closest("picture")
      ?.querySelector("source");
    expect(placeholderSource?.getAttribute("srcset")).toBe(
      "https://images.test/d-480.avif",
    );

    // Crossfade state still keys off the load event on the img.
    const wrapper = container.querySelector(".atlas-photo-image");
    expect(wrapper?.getAttribute("data-loaded")).toBe("false");
    fireEvent.load(target);
    expect(wrapper?.getAttribute("data-loaded")).toBe("true");
  });

  it("falls back to the nearest WebP width when no exact-width WebP exists", () => {
    const wide = photo("w");
    wide.previews = [
      { url: "https://images.test/w-480.webp", width: 480, height: 320, format: "webp" },
      { url: "https://images.test/w-1600.webp", width: 1600, height: 1067, format: "webp" },
      { url: "https://images.test/w-2400.avif", width: 2400, height: 1600, format: "avif" },
    ];
    render(<PhotoImage photo={wide} alt="W photo" tier="lightbox" />);

    const target = screen.getByAltText("W photo");
    expect(target.getAttribute("src")).toBe("https://images.test/w-1600.webp");
    expect(
      target.closest("picture")?.querySelector("source")?.getAttribute("srcset"),
    ).toBe("https://images.test/w-2400.avif");
  });

  it("renders an AVIF-only photo bare, with no <source>, exactly as before", () => {
    const avifOnly = photo("o");
    avifOnly.previews = [
      { url: "https://images.test/o-480.avif", width: 480, height: 320, format: "avif" },
      { url: "https://images.test/o-960.avif", width: 960, height: 640, format: "avif" },
    ];
    const { container } = render(
      <PhotoImage photo={avifOnly} alt="O photo" tier="card" targetWidth={900} />,
    );

    const target = screen.getByAltText("O photo");
    expect(target.getAttribute("src")).toBe("https://images.test/o-960.avif");
    expect(container.querySelector("source")).toBeNull();
  });

  it("adds no <source> when the target format already decodes everywhere", () => {
    const { container } = render(
      <PhotoImage photo={photo("a")} alt="A photo" tier="card" targetWidth={900} />,
    );
    expect(container.querySelector("source")).toBeNull();
  });

  it("shows an accessible fallback after a target preview fails", () => {
    const onError = vi.fn();
    render(
      <PhotoImage
        photo={photo("a")}
        alt="A photo"
        tier="thumbnail"
        onError={onError}
      />,
    );

    fireEvent.error(screen.getByAltText("A photo"));
    expect(screen.getByText("Preview unavailable")).toBeDefined();
    expect(onError).toHaveBeenCalledOnce();
  });
});
