import { describe, expect, it } from "vitest";

import { compactPersonSlug, personHref } from "@/lib/people/person-href";

/**
 * These URLs exist to be typed from memory, read aloud, or pasted out of a
 * text message, so the tolerant cases below are the point of the feature
 * rather than edge cases.
 */
describe("compactPersonSlug", () => {
  it("drops hyphens from a catalog slug", () => {
    expect(compactPersonSlug("phil-campbell")).toBe("philcampbell");
    expect(compactPersonSlug("trelawny-vermont-davis")).toBe(
      "trelawnyvermontdavis",
    );
  });

  it("is idempotent, so an already-compact URL still resolves", () => {
    expect(compactPersonSlug("philcampbell")).toBe("philcampbell");
  });

  /*
   * Regression: the original stripped every non-[a-z0-9] character WITHOUT
   * folding case first, so capitals were deleted rather than lowered and
   * "/PhilCampbell" compacted to "hilampbell" -- a 404 on a spelling any
   * guest might reasonably type.
   */
  it("folds case instead of deleting capital letters", () => {
    expect(compactPersonSlug("PhilCampbell")).toBe("philcampbell");
    expect(compactPersonSlug("Phil-Campbell")).toBe("philcampbell");
    expect(compactPersonSlug("PHILCAMPBELL")).toBe("philcampbell");
  });

  it("collapses to empty when nothing usable is left", () => {
    expect(compactPersonSlug("---")).toBe("");
    expect(compactPersonSlug("")).toBe("");
  });
});

describe("personHref", () => {
  it("builds the canonical hyphen-free path", () => {
    expect(personHref("phil-campbell")).toBe("/philcampbell");
    expect(personHref("alex-muecke")).toBe("/alexmuecke");
  });

  it("agrees with compactPersonSlug, which the route redirects against", () => {
    for (const slug of ["phil-campbell", "PhilCampbell", "zach-soskin"]) {
      expect(personHref(slug)).toBe(`/${compactPersonSlug(slug)}`);
    }
  });
});
