import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Lightbox } from "@/components/gallery/Lightbox";
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

vi.mock("@/components/gallery/PhotoImage", () => ({
  PhotoImage: ({ alt }: { alt: string }) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/preview.jpg" alt={alt} />;
  },
}));

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
