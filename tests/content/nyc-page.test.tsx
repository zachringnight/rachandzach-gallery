import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import NycPage, { metadata as nycMetadata } from "@/app/(public)/nyc/page";
import {
  fundraiserProgressPercent,
  hasSupporters,
  instagramPost,
  nycFundraiser,
  nycFundraisingDeadline,
  nycRaceDay,
  nycSupporters,
  visibleSupporters,
} from "@/content/nyc";

afterEach(cleanup);

describe("/nyc page", () => {
  it("renders exactly one h1", () => {
    const { container } = render(<NycPage />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("leads with the donate action pointed at the direct donation form", () => {
    render(<NycPage />);
    const donate = screen.getByRole("link", { name: /donate to her run/i });
    expect(donate.getAttribute("href")).toBe(nycFundraiser.donationUrl);
    expect(donate.getAttribute("rel")).toContain("noopener");
    expect(donate.getAttribute("target")).toBe("_blank");
    expect(donate.className).toContain("atlas-primary-link");
  });

  it("names the cause prominently and links the impact report as a secondary CTA", () => {
    const { container } = render(<NycPage />);
    expect(container.textContent).toContain("NYRR Team for Kids");
    expect(container.textContent).toContain(nycFundraiser.charityBlurb);
    const report = screen.getByRole("link", { name: /impact report/i });
    expect(report.getAttribute("href")).toBe(nycFundraiser.impactReportUrl);
    expect(report.className).not.toContain("atlas-primary-link");
  });

  it("uses the full official race name and links it to NYRR", () => {
    render(<NycPage />);
    // The full name appears in the facts band and again as a follow channel;
    // both must resolve to the official race page, and neither may be styled
    // as the primary action.
    const races = screen.getAllByRole("link", {
      name: new RegExp(nycFundraiser.raceName, "i"),
    });
    expect(races.length).toBeGreaterThan(0);
    for (const race of races) {
      expect(race.getAttribute("href")).toBe(nycFundraiser.raceInfoUrl);
      expect(race.getAttribute("rel")).toContain("noopener");
      expect(race.className).not.toContain("atlas-primary-link");
    }
  });

  it("labels race day and the donation deadline as separate dates", () => {
    const { container } = render(<NycPage />);
    const text = container.textContent ?? "";
    expect(text).toContain(nycRaceDay.label);
    expect(text).toContain(nycFundraisingDeadline.label);
    expect(text).toMatch(/race day/i);
    expect(text).toMatch(/donations close/i);
    // The deadline must be presented as landing before the race, not as it.
    expect(text).toMatch(/before she runs/i);
  });

  it("frames the run as upcoming rather than as a recap", () => {
    const { container } = render(<NycPage />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/is running/i);
    expect(text).not.toMatch(/\bshe ran the\b|\blook what she did\b|\bfinished in\b/i);
  });

  it("shows a dated, hand-entered total rather than implying a live one", () => {
    const { container } = render(<NycPage />);
    const text = container.textContent ?? "";
    expect(text).toContain("$8,770.50");
    expect(text).toContain("$1,229.50 to go.");
    expect(text).toContain("$10,000");
    expect(text).toContain(nycFundraiser.progress.asOf);
    expect(text).toMatch(/entered by hand/i);
    expect(text).toContain(
      `${nycFundraiser.progress.donations} donations so far`,
    );
    expect(text).not.toMatch(/\d+ people have already chipped in/);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe(
      "$8,770.50 raised of $10,000",
    );
  });

  it("clamps the progress bar fill and keeps aria within range", () => {
    const { container } = render(<NycPage />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    const now = Number(bar?.getAttribute("aria-valuenow"));
    const max = Number(bar?.getAttribute("aria-valuemax"));
    expect(now).toBeLessThanOrEqual(max);
    const fill = bar?.querySelector("span") as HTMLElement;
    expect(fill.style.getPropertyValue("--atlas-progress")).toBe(
      `${fundraiserProgressPercent()}%`,
    );
  });
});

describe("/nyc Instagram post", () => {
  it("links out to the real permalink", () => {
    render(<NycPage />);
    const post = screen.getByRole("link", {
      name: /marathon post on instagram/i,
    });
    expect(post.getAttribute("href")).toBe(instagramPost.postUrl);
    expect(post.getAttribute("rel")).toContain("noreferrer");
  });

  it("never emits a third-party embed the CSP would block", () => {
    const { container } = render(<NycPage />);
    const html = container.innerHTML;
    // script-src is 'self' and frame-src is 'none' (security-headers.ts), so
    // an embed.js tag or an instagram iframe would render as a blank hole in
    // production. Neither may ever appear here.
    expect(html).not.toContain("instagram.com/embed.js");
    expect(html).not.toContain("/embed");
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(html).not.toContain("blockquote class=\"instagram-media\"");
  });
});

describe("/nyc supporters privacy", () => {
  it("renders the approved supporters, and never an amount", () => {
    expect(nycSupporters.approved).toBe(true);

    const { container } = render(<NycPage />);
    const wall = container.querySelector(".atlas-nyc-supporters");
    expect(wall).not.toBeNull();

    const text = wall?.textContent ?? "";
    for (const person of visibleSupporters()) {
      expect(text, `${person.name} should appear on the wall`).toContain(
        person.name,
      );
    }
    // The Supporter type has no amount field; this guards the rendered
    // output too, since a donation figure is the one thing that would turn
    // a wall of thanks into a ranking.
    expect(text).not.toMatch(/\$\s?\d/);
  });

  it("keeps anonymous donors off the wall entirely", () => {
    const { container } = render(<NycPage />);
    const text = container.querySelector(".atlas-nyc-supporters")?.textContent ?? "";
    expect(text.toLowerCase()).not.toContain("anonymous");
  });

  /*
   * The gate is now the only lever that takes the wall back down, so prove it
   * still holds for any list. Invented names, so this never depends on who
   * happens to be in the real seed.
   */
  it("withholds a populated list until it is explicitly approved", () => {
    const pending = {
      ...nycSupporters,
      approved: false,
      // Invented names on purpose. Using two of Rachel's actual donors here
      // would put real identities back into committed source through the
      // side door, which is the very thing the empty array above avoids.
      people: [
        { name: "Test Donor One", message: "You got this!" },
        { name: "Test Donor Two", message: null },
        { name: "Anonymous", message: "excluded at the source" },
      ],
    };
    expect(hasSupporters(pending)).toBe(false);
    expect(visibleSupporters(pending)).toHaveLength(0);

    // ...and releases it, minus anonymous entries, only once approved.
    const approved = { ...pending, approved: true };
    expect(hasSupporters(approved)).toBe(true);
    expect(visibleSupporters(approved).map((p) => p.name)).toEqual([
      "Test Donor One",
      "Test Donor Two",
    ]);
  });

  it("dates the supporter wall separately from the latest donation total", () => {
    const { container } = render(<NycPage />);
    expect(container.textContent).toContain(
      `Supporter wall as of ${nycSupporters.seededOn}`,
    );
  });

  /*
   * Indexable unconditionally. The noindex-when-approved coupling was dropped
   * on 2026-07-27: this is a fundraiser with a deadline, and a page search
   * engines are told to skip raises nothing. Donor names are marked
   * data-nosnippet at the section instead (a snippet hint, not a privacy
   * control -- see the page's comment).
   */
  it("stays indexable so the fundraiser can be found", () => {
    expect(nycMetadata.robots).toEqual({ index: true, follow: true });
  });

  it("marks the supporters section data-nosnippet", () => {
    const { container } = render(<NycPage />);
    const wall = container.querySelector(".atlas-nyc-supporters");
    expect(wall).not.toBeNull();
    expect(wall?.hasAttribute("data-nosnippet")).toBe(true);
  });

  it("declares a share card so the link preview carries the ask", () => {
    const images = nycMetadata.openGraph?.images;
    expect(Array.isArray(images) ? images.length : 0).toBeGreaterThan(0);
  });
});
