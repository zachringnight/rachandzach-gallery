import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import GuestNotFound from "@/app/(guest)/not-found";

afterEach(cleanup);

/**
 * Person pages live at guessable /[name] URLs, so a mistyped name is the
 * expected way to hit notFound() inside the guest tree. This page must keep
 * the guest oriented: Find me first, the archive second, and none of the
 * public 404's dead-end framing.
 */
describe("guest not-found", () => {
  it("renders exactly one display heading", () => {
    const { container } = render(<GuestNotFound />);
    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0].className).toContain("font-display");
  });

  it("leads back to Find me as the primary action", () => {
    render(<GuestNotFound />);
    const findMe = screen.getByRole("link", { name: /^find my photos$/i });
    expect(findMe.getAttribute("href")).toBe("/my-weekend");
    // The filled ink treatment marks the primary action.
    expect(findMe.className).toContain("bg-ink");
  });

  it("offers all the photos as the secondary action", () => {
    render(<GuestNotFound />);
    const archive = screen.getByRole("link", { name: /browse all photos/i });
    expect(archive.getAttribute("href")).toBe("/photos");
    expect(archive.className).not.toContain("bg-ink");
  });

  it("keeps the copy quiet: no 404 jargon, forward-looking voice", () => {
    const { container } = render(<GuestNotFound />);
    expect(container.textContent).not.toMatch(/404|error|oops|sorry/i);
    expect(container.textContent).toContain("Your photos are still here");
  });
});
