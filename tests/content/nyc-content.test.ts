import { describe, expect, it } from "vitest";

import {
  daysUntil,
  remainingLabel,
} from "@/components/nyc/DaysRemaining";
import {
  fundraiserProgressPercent,
  fundraiserRawPercent,
  fundraiserRemaining,
  hasInstagramPost,
  hasSupporters,
  instagramPost,
  nycFundraiser,
  nycFundraisingDeadline,
  nycRaceDay,
  nycSupporters,
  visibleSupporters,
} from "@/content/nyc";

describe("NYC fundraiser content", () => {
  it("keeps Rachel's verified NYRR story and canonical links", () => {
    expect(nycFundraiser.raceName).toBe("2026 TCS New York City Marathon");
    expect(nycFundraiser.charityName).toBe("Team for Kids");
    expect(nycFundraiser.story.join(" ")).toContain(
      "running has played a pivotal role in my life",
    );
    expect(nycFundraiser.story.join(" ")).toContain(
      "more kids running towards brighter futures",
    );
    expect(nycFundraiser.signoff).toBe("With love, Rach");
    expect(nycFundraiser.fundraiserUrl).toBe(
      "https://fundraisers.nyrr.org/rachel-casciano",
    );
    expect(nycFundraiser.donationUrl).toContain("donations.nyrr.org");
    expect(nycFundraiser.impactReportUrl).toBe("https://ceros.nyrr.org/1/p/1");
    expect(nycFundraiser.raceInfoUrl).toBe("https://www.nyrr.org/tcsnycmarathon");
  });

  it("stores outbound links without click or session tracking parameters", () => {
    const urls = [
      nycFundraiser.fundraiserUrl,
      nycFundraiser.donationUrl,
      nycFundraiser.impactReportUrl,
      nycFundraiser.raceInfoUrl,
    ];
    for (const url of urls) {
      expect(url, `${url} must not carry tracking params`).not.toMatch(
        /[?&](utm_[a-z]+|fbclid|gclid|mc_eid)=/i,
      );
    }
    // The fundraiser id is an identifier, not tracking: the donate link is
    // broken without it, so it must survive.
    expect(nycFundraiser.donationUrl).toContain("fundraiser=fa3fbedc687074f450f7");
  });

  it("presents the pull quote as an exact substring of her own story", () => {
    // Guards the difference between quoting Rachel and paraphrasing her: if
    // the quote is ever reworded without rewording the story, this fails.
    expect(nycFundraiser.story.join(" ")).toContain(nycFundraiser.pullQuote);
  });

  it("calculates a bounded progress percentage for the bar", () => {
    expect(fundraiserProgressPercent()).toBe(45);
    expect(fundraiserProgressPercent(11_000, 10_000)).toBe(100);
    expect(fundraiserProgressPercent(-20, 10_000)).toBe(0);
    expect(fundraiserProgressPercent(100, 0)).toBe(0);
  });

  it("lets the displayed percentage exceed the goal", () => {
    expect(fundraiserRawPercent()).toBe(45);
    expect(fundraiserRawPercent(12_700, 10_000)).toBe(127);
    expect(fundraiserRawPercent(-20, 10_000)).toBe(0);
    expect(fundraiserRawPercent(100, 0)).toBe(0);
  });

  it("never reports a negative amount remaining", () => {
    expect(fundraiserRemaining()).toBe(5454);
    expect(fundraiserRemaining(12_000, 10_000)).toBe(0);
    expect(fundraiserRemaining(10_000, 10_000)).toBe(0);
  });

  it("dates every hand-entered figure", () => {
    expect(nycFundraiser.progress.raised).toBe(4546);
    expect(nycFundraiser.progress.goal).toBe(10_000);
    expect(nycFundraiser.progress.supporters).toBe(47);
    expect(nycFundraiser.progress.asOfISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nycFundraiser.progress.asOf.length).toBeGreaterThan(0);
  });

  it("ships a local, descriptive fundraiser photo and share card", () => {
    expect(nycFundraiser.photo.src).toBe("/nyc/rachel-running.jpg");
    expect(nycFundraiser.photo.alt.trim().length).toBeGreaterThan(20);
    expect(nycFundraiser.shareImage.src).toBe("/nyc/nyc-share.jpg");
    expect(nycFundraiser.shareImage.width).toBe(1200);
    expect(nycFundraiser.shareImage.height).toBe(630);
  });

  it("keeps race day and the donation deadline as distinct absolute dates", () => {
    expect(nycRaceDay.iso).toBe("2026-11-01");
    expect(nycFundraisingDeadline.iso).toBe("2026-10-07");
    // The fundraising window closes before she runs. If this ever inverts,
    // the page's "before she runs" copy has become wrong.
    expect(
      new Date(nycFundraisingDeadline.iso).getTime(),
    ).toBeLessThan(new Date(nycRaceDay.iso).getTime());
  });
});

describe("Instagram post", () => {
  it("uses the real permalink and its matching shortcode", () => {
    expect(hasInstagramPost()).toBe(true);
    expect(instagramPost.postUrl).toBe(
      "https://www.instagram.com/p/Dal9ZrOyy4Z/",
    );
    expect(instagramPost.postUrl).toContain(instagramPost.shortcode as string);
  });

  it("treats a blank or non-https value as absent", () => {
    const base = { ...instagramPost };
    expect(hasInstagramPost({ ...base, postUrl: null })).toBe(false);
    expect(hasInstagramPost({ ...base, postUrl: "   " })).toBe(false);
    expect(hasInstagramPost({ ...base, postUrl: "TODO" })).toBe(false);
  });
});

describe("supporters wall", () => {
  it("is seeded but not approved, so it renders nothing yet", () => {
    // Rachel must read the list and flip this herself. Nobody else.
    expect(nycSupporters.approved).toBe(false);
    expect(hasSupporters()).toBe(false);
    expect(visibleSupporters()).toHaveLength(0);
  });

  it("carries the seeded draft ready for her review", () => {
    expect(nycSupporters.people.length).toBe(46);
    expect(nycSupporters.seededOn.length).toBeGreaterThan(0);
  });

  it("never stores a donation amount", () => {
    for (const person of nycSupporters.people) {
      expect(Object.keys(person).sort()).toEqual(["message", "name"]);
      expect(person.name).not.toMatch(/\$\s?\d/);
      expect(person.message ?? "").not.toMatch(/\$\s?\d/);
    }
  });

  it("excludes anonymous donors even if one is hand-pasted in later", () => {
    const withAnonymous = {
      ...nycSupporters,
      approved: true,
      people: [
        { name: "Anonymous", message: "Go Rach" },
        { name: "anonymous donor", message: null },
        { name: "   ", message: "blank" },
        { name: "Real Person", message: "Good luck!" },
      ],
    };
    const visible = visibleSupporters(withAnonymous);
    expect(visible.map((p) => p.name)).toEqual(["Real Person"]);
  });

  it("renders nothing when approved but empty", () => {
    const emptyApproved = { ...nycSupporters, approved: true, people: [] };
    expect(hasSupporters(emptyApproved)).toBe(false);
    expect(visibleSupporters(emptyApproved)).toHaveLength(0);
  });
});

describe("countdown", () => {
  const noon = (iso: string) => new Date(`${iso}T12:00:00`);

  it("counts whole calendar days to an absolute date", () => {
    expect(daysUntil("2026-10-07", noon("2026-07-27"))).toBe(72);
    expect(daysUntil("2026-11-01", noon("2026-07-27"))).toBe(97);
    expect(daysUntil("2026-10-07", noon("2026-10-06"))).toBe(1);
    expect(daysUntil("2026-10-07", noon("2026-10-07"))).toBe(0);
    expect(daysUntil("2026-10-07", noon("2026-10-09"))).toBe(-2);
  });

  it("rejects malformed and overflow dates rather than reporting NaN", () => {
    expect(daysUntil("not-a-date")).toBeNull();
    expect(daysUntil("2026-02-31")).toBeNull();
    expect(daysUntil("2026-13-01")).toBeNull();
  });

  it("spells out every terminal state", () => {
    expect(remainingLabel(72, "closed")).toBe("72 days left");
    expect(remainingLabel(2, "closed")).toBe("2 days left");
    expect(remainingLabel(1, "closed")).toBe("1 day left");
    expect(remainingLabel(0, "closed")).toBe("Last day");
    expect(remainingLabel(-1, "closed")).toBe("closed");
    expect(remainingLabel(-400, "closed")).toBe("closed");
    expect(remainingLabel(null, "closed")).toBeNull();
  });

  it("agrees with the NYRR figure the deadline was derived from", () => {
    // NYRR showed "72 days remaining" on 2026-07-27, which is where
    // nycFundraisingDeadline came from. This pins that derivation.
    expect(
      daysUntil(nycFundraisingDeadline.iso, noon(nycFundraiser.progress.asOfISO)),
    ).toBe(72);
  });
});
