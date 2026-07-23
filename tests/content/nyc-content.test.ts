import { describe, expect, it } from "vitest";

import {
  fundraiserProgressPercent,
  nycFundraiser,
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
    expect(nycFundraiser.impactReportUrl).toBe("https://ceros.nyrr.org/p/p/1");
  });

  it("calculates a bounded progress percentage", () => {
    expect(fundraiserProgressPercent()).toBe(40);
    expect(fundraiserProgressPercent(11_000, 10_000)).toBe(100);
    expect(fundraiserProgressPercent(-20, 10_000)).toBe(0);
    expect(fundraiserProgressPercent(100, 0)).toBe(0);
  });

  it("ships a local, descriptive fundraiser photo", () => {
    expect(nycFundraiser.photo.src).toBe("/nyc/rachel-running.jpg");
    expect(nycFundraiser.photo.alt.trim().length).toBeGreaterThan(20);
  });
});
