import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Lightbox, setAvifSupportForTests } from "@/components/gallery/Lightbox";
import { PhotoCard } from "@/components/gallery/PhotoCard";
import type { ClientPhoto } from "@/lib/gallery/client-types";

vi.mock("@/components/downloads/DownloadOriginalButton", () => ({
  DownloadOriginalButton: ({
    children,
    ariaLabel,
    title,
    className,
  }: {
    children?: ReactNode;
    ariaLabel?: string;
    title?: string;
    className?: string;
  }) => (
    <a
      href="https://example.test/download"
      aria-label={ariaLabel}
      title={title}
      className={className}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/components/favorites/FavoriteButton", () => ({
  FavoriteButton: ({ label }: { label?: string }) => (
    <button type="button" aria-label={`Favorite ${label ?? "photo"}`} />
  ),
}));

// Replace only the component: the Lightbox's adjacent-photo preloader calls
// the real pickTarget/pickFallback from this module, so those must survive.
vi.mock("@/components/gallery/PhotoImage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/gallery/PhotoImage")>();
  return {
    ...actual,
    PhotoImage: ({ alt }: { alt: string }) => {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src="/preview.jpg" alt={alt} />;
    },
  };
});

vi.mock("@/components/gallery/SharePhotoButton", () => ({
  SharePhotoButton: () => <button type="button">Share</button>,
}));

vi.mock("@/components/memories/PhotoMemories", () => ({
  PhotoMemories: () => <div>Memories</div>,
}));

function photo(id: string): ClientPhoto {
  return {
    id,
    eventSlug: "ceremony",
    eventName: "The Ceremony",
    source: "photographer",
    orientation: "landscape",
    width: 1600,
    height: 1067,
    aspectRatio: 1.5,
    capturedAt: null,
    people: [{ slug: "rach", displayName: "Rach" }],
    keywords: [],
    previews: [
      {
        url: `https://example.test/${id}.jpg`,
        width: 1200,
        height: 800,
        format: "jpeg",
      },
    ],
  };
}

afterEach(() => {
  document.body.style.overflow = "";
});

describe("photo surfaces", () => {
  it("keeps grid metadata accessible without rendering labels over the photo", () => {
    const { container } = render(
      <PhotoCard
        photo={photo("one")}
        width={320}
        height={220}
        onOpen={vi.fn()}
      />,
    );

    expect(container.querySelector(".atlas-photo-caption")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Open photo from The Ceremony with Rach",
      }),
    ).toBeTruthy();
    const download = screen.getByRole("link", { name: "Download Rach" });
    expect(download.textContent).toBe("");
    expect(download.getAttribute("title")).toBe("Download original");
  });

  it("moves focus to Close and keeps position metadata outside the photo stage", () => {
    const { container } = render(
      <Lightbox
        photo={photo("two")}
        onClose={vi.fn()}
        position={2}
        total={17}
      />,
    );

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close" }),
    );
    expect(screen.getByText("2 of 17")).toBeTruthy();
    expect(container.querySelector(".atlas-lightbox-caption")).toBeNull();
  });

  it("renders an approved uploader caption in the below-image notes area", () => {
    const captionedPhoto: ClientPhoto = {
      ...photo("captioned"),
      approvedCaption: {
        text: "We caught this from the back row.",
        byline: "Jamie",
      },
    };
    const { container } = render(
      <Lightbox photo={captionedPhoto} onClose={vi.fn()} />,
    );

    const stage = container.querySelector(".atlas-lightbox-stage");
    const notes = container.querySelector(".atlas-lightbox-notes");
    const approvedCaption = container.querySelector(
      ".atlas-lightbox-uploader-caption",
    );

    expect(stage).not.toBeNull();
    expect(notes).not.toBeNull();
    expect(approvedCaption).not.toBeNull();
    expect(notes!.contains(approvedCaption)).toBe(true);
    expect(stage!.contains(approvedCaption)).toBe(false);
    expect(screen.getByText("We caught this from the back row.")).toBeTruthy();
    expect(screen.getByText("Shared by Jamie")).toBeTruthy();
  });

  it("does not render uploader-caption markup without an approved caption", () => {
    const { container } = render(
      <Lightbox photo={{ ...photo("private-note"), approvedCaption: null }} onClose={vi.fn()} />,
    );

    expect(
      container.querySelector(".atlas-lightbox-uploader-caption"),
    ).toBeNull();
  });

  it("deep-links keyword chips to the archive's Moment Search, not /my-weekend", () => {
    // /photos reads plain "q" as the Moment Search seed and runs it on load;
    // /my-weekend renders its search panel below the guest's whole gallery
    // with no scroll-to, so a chip pointed there appeared to do nothing.
    render(
      <Lightbox
        photo={{ ...photo("keyworded"), keywords: ["sunset kiss"] }}
        onClose={vi.fn()}
      />,
    );

    const chip = screen.getByRole("link", { name: "sunset kiss" });
    expect(chip.getAttribute("href")).toBe(
      `/photos?q=${encodeURIComponent("sunset kiss")}`,
    );
  });

  it("pages on a horizontal touch swipe and ignores vertical or mouse drags", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const { container } = render(
      <Lightbox
        photo={photo("three")}
        onClose={vi.fn()}
        onPrev={onPrev}
        onNext={onNext}
      />,
    );
    const stage = container.querySelector<HTMLElement>(".atlas-lightbox-stage");
    if (!stage) throw new Error("Lightbox stage not rendered");

    fireEvent.pointerDown(stage, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerUp(stage, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 130,
      clientY: 330,
    });
    expect(onPrev).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();

    fireEvent.pointerDown(stage, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerUp(stage, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 100,
      clientY: 205,
    });
    expect(onNext).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(stage, {
      pointerId: 3,
      pointerType: "mouse",
      clientX: 100,
      clientY: 200,
    });
    fireEvent.pointerUp(stage, {
      pointerId: 3,
      pointerType: "mouse",
      clientX: 220,
      clientY: 200,
    });
    expect(onPrev).not.toHaveBeenCalled();
  });
});

describe("adjacent photo preloading", () => {
  // Every URL a preload Image was pointed at. jsdom never fetches or decodes,
  // so the seam is window.Image itself: a recorder standing in for it, with
  // the decoder answer pinned through setAvifSupportForTests because the real
  // 1x1 data-URI probe would hang forever in jsdom.
  let preloadedUrls: string[] = [];

  class RecordingImage {
    decoding = "";
    private value = "";
    set src(url: string) {
      this.value = url;
      // The unmount cleanup blanks src to cancel in-flight fetches; only
      // real assignments are preloads.
      if (url) preloadedUrls.push(url);
    }
    get src() {
      return this.value;
    }
  }

  beforeEach(() => {
    preloadedUrls = [];
    vi.stubGlobal("Image", RecordingImage);
  });

  afterEach(() => {
    setAvifSupportForTests(null);
    vi.unstubAllGlobals();
  });

  const avifUrl = "https://example.test/next-2400.avif";
  const jpegUrl = "https://example.test/next-2400.jpg";

  function neighbourWithAvif(): ClientPhoto {
    return {
      ...photo("next"),
      previews: [
        { url: avifUrl, width: 2400, height: 1600, format: "avif" },
        { url: jpegUrl, width: 2400, height: 1600, format: "jpeg" },
        {
          url: "https://example.test/next-320.avif",
          width: 320,
          height: 213,
          format: "avif",
        },
      ],
    };
  }

  it("preloads the AVIF target when the browser decodes AVIF", async () => {
    setAvifSupportForTests(true);
    render(
      <Lightbox
        photo={photo("current")}
        onClose={vi.fn()}
        onNext={vi.fn()}
        nextPhoto={neighbourWithAvif()}
      />,
    );

    await waitFor(() => expect(preloadedUrls).toContain(avifUrl));
    // Never both: warming the unused format downloads bytes nothing renders.
    expect(preloadedUrls).toEqual([avifUrl]);
  });

  it("preloads the fallback URL when the browser cannot decode AVIF", async () => {
    setAvifSupportForTests(false);
    render(
      <Lightbox
        photo={photo("current")}
        onClose={vi.fn()}
        onNext={vi.fn()}
        nextPhoto={neighbourWithAvif()}
      />,
    );

    await waitFor(() => expect(preloadedUrls).toContain(jpegUrl));
    expect(preloadedUrls).toEqual([jpegUrl]);
  });

  it("preloads a photo with no AVIF preview directly, without consulting the probe", () => {
    // Detection deliberately unpinned: a probe in jsdom never resolves, so
    // this passing synchronously proves the non-AVIF path does not wait.
    const jpegOnly = photo("next");
    render(
      <Lightbox
        photo={photo("current")}
        onClose={vi.fn()}
        onNext={vi.fn()}
        nextPhoto={jpegOnly}
      />,
    );

    expect(preloadedUrls).toEqual([jpegOnly.previews[0].url]);
  });

  it("preloads an AVIF-only photo unchanged, since every browser is served the AVIF", () => {
    const avifOnly: ClientPhoto = {
      ...photo("next"),
      previews: [{ url: avifUrl, width: 2400, height: 1600, format: "avif" }],
    };
    render(
      <Lightbox
        photo={photo("current")}
        onClose={vi.fn()}
        onNext={vi.fn()}
        nextPhoto={avifOnly}
      />,
    );

    expect(preloadedUrls).toEqual([avifUrl]);
  });
});
