import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import HomePage, { metadata as homeMetadata } from "@/app/page";
import NotFound from "@/app/(public)/not-found";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { FeaturePortal } from "@/components/site/FeaturePortal";
import { legacyRedirects } from "@/lib/redirects";
import { focalObjectPosition, storyPhotos, STORY_PHOTO_APPROVAL } from "@/content/story-photos";

afterEach(cleanup);

/** Routes that require the guest session and must never be advertised to crawlers. */
const PROTECTED_ROUTES = ["/photos", "/my-weekend", "/favorites", "/add-yours", "/admin"];

describe("public route titles", () => {
  it("gives the home page a Rachel and Zach Santa Barbara title", () => {
    const title = String(homeMetadata.title);
    expect(title).toContain("Rach");
    expect(title).toContain("Zach");
    expect(title).toContain("Santa Barbara");
  });

  it("renders exactly one h1 on the public home", () => {
    const home = render(<HomePage />);
    expect(home.container.querySelectorAll("h1")).toHaveLength(1);
  });
});

describe("home page", () => {
  it("leads with the private archive promise and both primary actions", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /the photo gallery/i }),
    ).toBeDefined();
    const findPhotos = screen.getByRole("link", { name: /^find my photos$/i });
    expect(findPhotos.getAttribute("href")).toBe("/my-weekend");
    const openArchive = screen.getByRole("link", { name: /open the archive/i });
    expect(openArchive.getAttribute("href")).toBe("/photos");
  });

  it("replaces the recap with archive utilities", () => {
    const { container } = render(<HomePage />);
    expect(screen.getByRole("heading", { name: /a private archive that works for you/i }))
      .toBeDefined();
    expect(screen.getByRole("heading", { name: /take the originals with you/i }))
      .toBeDefined();
    expect(container.querySelector("#coast")).toBeNull();
    expect(container.textContent).not.toMatch(/weekend as we remember it/i);
  });
});

describe("legacy redirects data", () => {
  it("maps every old route to its new home", () => {
    const map = new Map(legacyRedirects.map((r) => [r.source, r.destination]));
    expect(map.get("/weekend")).toBe("/photos");
    expect(map.get("/overview")).toBe("/");
    expect(map.get("/schedule-1")).toBe("/photos");
    expect(map.get("/gallery")).toBe("/photos");
    expect(map.get("/faq-1")).toBe("/");
    expect(map.get("/travel")).toBe("/");
    expect(legacyRedirects).toHaveLength(6);
  });

  it("marks every legacy redirect permanent", () => {
    for (const redirect of legacyRedirects) {
      expect(redirect.permanent, `${redirect.source} should be permanent`).toBe(true);
    }
  });
});

describe("disabled modules stay hidden", () => {
  it("renders nothing for a feature portal whose flag is off", () => {
    // NODE_ENV=test resolves every unreleased flag to false.
    const { container } = render(
      <FeaturePortal
        flag="playlists"
        href="/playlists"
        title="Playlists"
        body="The weekend soundtrack."
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("keeps playlists and marathon out of the public pages", () => {
    const home = render(<HomePage />);
    expect(within(home.container).queryByText(/playlist/i)).toBeNull();
    expect(within(home.container).queryByText(/marathon/i)).toBeNull();
  });
});

describe("image accessibility", () => {
  function checkAltDiscipline(container: HTMLElement) {
    const images = Array.from(container.querySelectorAll("img"));
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) {
      expect(img.hasAttribute("alt"), `img ${img.getAttribute("src")} is missing alt`).toBe(true);
      const alt = img.getAttribute("alt") ?? "";
      if (alt === "") {
        expect(
          img.closest('[aria-hidden="true"]'),
          `decorative img ${img.getAttribute("src")} must sit inside aria-hidden`,
        ).not.toBeNull();
      } else {
        expect(alt.trim().length).toBeGreaterThan(0);
      }
    }
  }

  it("uses empty alt only for decorative images on the home page", () => {
    const { container } = render(<HomePage />);
    checkAltDiscipline(container);
    const study = container.querySelector('.archive-photo-study-grid[aria-hidden="true"]');
    expect(study).not.toBeNull();
  });
});

describe("protected content stays out of public HTML", () => {
  it("never references gallery assets, generated data, or API routes", () => {
    const { container } = render(<HomePage />);
    const html = container.innerHTML;
    expect(html).not.toContain("gallery-assets");
    expect(html).not.toContain("/api/");
    expect(html).not.toMatch(/supabase/i);
  });
});

describe("robots and sitemap", () => {
  /**
   * Resolves a path against the robots rules the way a crawler does: the
   * longest matching pattern wins, and Allow beats Disallow on a tie. Checked
   * semantically rather than by asserting the literal arrays, because since
   * the whole-site gate the rule is a blanket Disallow "/" plus two Allow
   * lines, and an enumeration test would have to be rewritten every time a
   * route is added -- exactly the staleness the blanket rule exists to avoid.
   */
  function isCrawlable(path: string): boolean {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const collect = (value: string | string[] | undefined): string[] =>
      value === undefined ? [] : Array.isArray(value) ? value : [value];

    let verdict = true;
    let bestLength = -1;
    for (const rule of rules) {
      for (const [patterns, allowed] of [
        [collect(rule?.allow), true],
        [collect(rule?.disallow), false],
      ] as const) {
        for (const pattern of patterns) {
          if (!path.startsWith(pattern)) continue;
          // Longest match wins; Allow wins a tie.
          if (pattern.length > bestLength || (pattern.length === bestLength && allowed)) {
            bestLength = pattern.length;
            verdict = allowed;
          }
        }
      }
    }
    return verdict;
  }

  it("keeps every protected route out of the index", () => {
    for (const route of PROTECTED_ROUTES) {
      expect(isCrawlable(route), `robots must disallow ${route}`).toBe(false);
    }
  });

  it("closes the archive home and the retired public pages too", () => {
    // These were crawlable until the site went fully private on 2026-07-30.
    for (const route of ["/", "/weekend", "/playlists", "/api", "/enter"]) {
      expect(isCrawlable(route), `robots must disallow ${route}`).toBe(false);
    }
  });

  it("still lets crawlers reach the fundraiser and its assets", () => {
    for (const route of ["/nyc", "/marathon", "/nyc/nyc-share.jpg"]) {
      expect(isCrawlable(route), `robots must allow ${route}`).toBe(true);
    }
  });

  it("lists only public routes in the sitemap", () => {
    const entries = sitemap();
    const paths = entries.map((entry) => new URL(entry.url).pathname);
    // The archive home was dropped when it went behind the password gate: a
    // sitemap entry a crawler is redirected away from is a broken promise.
    expect(paths).not.toContain("/");
    expect(paths).toContain("/nyc");
    expect(paths).not.toContain("/weekend");
    for (const path of paths) {
      expect(isCrawlable(path), `sitemap lists uncrawlable ${path}`).toBe(true);
      for (const route of PROTECTED_ROUTES) {
        expect(path === route || path.startsWith(`${route}/`)).toBe(false);
      }
    }
  });
});

describe("not-found page", () => {
  it("routes back to the working archive", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: /out of frame/i })).toBeDefined();
    const home = screen.getByRole("link", { name: /archive home/i });
    expect(home.getAttribute("href")).toBe("/");
  });
});

describe("story photo provenance", () => {
  it("records the read-only source path and approval state for every pick", () => {
    const all = [storyPhotos.hero, ...Object.values(storyPhotos.chapters)];
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const photo of all) {
      expect(photo.sourcePath).toMatch(/^\d{2} [\w &]+\/[\w-]+\.jpg$/);
      expect(photo.imageDataHash).toMatch(/^[0-9a-f]{8}$/);
      expect(photo.src.startsWith("/story/")).toBe(true);
      expect(photo.src).toContain(photo.imageDataHash);
      expect(photo.approval).toBe(STORY_PHOTO_APPROVAL);
    }
  });

  it("gives every photo an in-range focal point", () => {
    const all = [storyPhotos.hero, ...Object.values(storyPhotos.chapters)];
    for (const photo of all) {
      expect(photo.focal.x, `${photo.id} focal.x`).toBeGreaterThanOrEqual(0);
      expect(photo.focal.x, `${photo.id} focal.x`).toBeLessThanOrEqual(1);
      expect(photo.focal.y, `${photo.id} focal.y`).toBeGreaterThanOrEqual(0);
      expect(photo.focal.y, `${photo.id} focal.y`).toBeLessThanOrEqual(1);
    }
    // The hero focal must sit on the couple's faces in the upper portion of
    // the frame so wide object-cover crops never behead them.
    expect(storyPhotos.hero.focal.y).toBeLessThan(0.5);
  });

  it("formats a focal point as a CSS object-position value", () => {
    expect(focalObjectPosition({ focal: { x: 0.5, y: 0.32 } })).toBe("50% 32%");
  });
});
