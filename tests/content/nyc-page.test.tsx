import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import NycPage, { metadata as nycMetadata } from "@/app/(public)/nyc/page";
import {
  instagramPost,
  nycFundraiser,
  nycFundraisingDeadline,
  nycRaceDay,
  nycSupporters,
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
    expect(text).toContain("$4,546");
    expect(text).toContain("$10,000");
    expect(text).toContain(nycFundraiser.progress.asOf);
    expect(text).toMatch(/entered by hand/i);
    expect(text).toContain("47 people have already chipped in");
  });

  it("clamps the progress bar fill and keeps aria within range", () => {
    const { container } = render(<NycPage />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    const now = Number(bar?.getAttribute("aria-valuenow"));
    const max = Number(bar?.getAttribute("aria-valuemax"));
    expect(now).toBeLessThanOrEqual(max);
    const fill = bar?.querySelector("span") as HTMLElement;
    expect(fill.style.getPropertyValue("--atlas-progress")).toBe("45%");
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
  it("is seeded but unapproved, so no donor name reaches the page", () => {
    expect(nycSupporters.approved).toBe(false);
    expect(nycSupporters.people.length).toBeGreaterThan(0);

    const { container } = render(<NycPage />);
    const html = container.innerHTML;
    for (const person of nycSupporters.people) {
      expect(html, `${person.name} must not appear while unapproved`).not.toContain(
        person.name,
      );
      if (person.message) {
        expect(html).not.toContain(person.message);
      }
    }
    expect(container.querySelector(".atlas-nyc-supporters")).toBeNull();
  });

  it("shows the aggregate count instead, which identifies nobody", () => {
    const { container } = render(<NycPage />);
    expect(container.textContent).toContain(
      String(nycFundraiser.progress.supporters),
    );
  });

  it("stays indexable while the wall is off", () => {
    // The two are coupled deliberately: approving the wall flips this to
    // noindex so donor names never become searchable under this domain.
    expect(nycMetadata.robots).toEqual({ index: true, follow: true });
  });

  it("declares a share card so the link preview carries the ask", () => {
    const images = nycMetadata.openGraph?.images;
    expect(Array.isArray(images) ? images.length : 0).toBeGreaterThan(0);
  });
});
