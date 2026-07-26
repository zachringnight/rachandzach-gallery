import { describe, expect, it } from "vitest";

import {
  parseAddPersonBody,
  parseFacePutBody,
  parsePersonPatchBody,
  slugifyPersonName,
} from "@/lib/admin/people";

describe("slugifyPersonName", () => {
  it("lowercases, strips diacritics, and hyphenates", () => {
    expect(slugifyPersonName("Aunt  Zélda O'Brien")).toBe("aunt-zelda-o-brien");
  });

  it("trims stray hyphens and rejects-nothing gracefully", () => {
    expect(slugifyPersonName("  --  ")).toBe("");
    expect(slugifyPersonName("!!!")).toBe("");
  });
});

describe("parseAddPersonBody", () => {
  it("derives the slug from the name when omitted", () => {
    expect(parseAddPersonBody({ displayName: "  Aunt   Carol " })).toEqual({
      displayName: "Aunt Carol",
      slug: "aunt-carol",
    });
  });

  it("accepts an explicit valid slug and rejects an invalid one", () => {
    expect(
      parseAddPersonBody({ displayName: "Aunt Carol", slug: "carol-b" }),
    ).toEqual({ displayName: "Aunt Carol", slug: "carol-b" });
    expect(
      parseAddPersonBody({ displayName: "Aunt Carol", slug: "-bad-" }),
    ).toBeNull();
  });

  it("rejects empty and oversized names", () => {
    expect(parseAddPersonBody({ displayName: "   " })).toBeNull();
    expect(parseAddPersonBody({ displayName: "x".repeat(121) })).toBeNull();
    expect(parseAddPersonBody(null)).toBeNull();
  });
});

describe("parsePersonPatchBody", () => {
  it("distinguishes clearing a rename from setting one", () => {
    expect(parsePersonPatchBody({ displayName: null })).toEqual({
      displayName: null,
    });
    expect(parsePersonPatchBody({ displayName: " New  Name " })).toEqual({
      displayName: "New Name",
    });
  });

  it("accepts hidden booleans only", () => {
    expect(parsePersonPatchBody({ hidden: true })).toEqual({ hidden: true });
    expect(parsePersonPatchBody({ hidden: "yes" })).toBeNull();
  });

  it("rejects an empty patch", () => {
    expect(parsePersonPatchBody({})).toBeNull();
  });
});

describe("parseFacePutBody", () => {
  it("accepts a structurally valid crop", () => {
    expect(
      parseFacePutBody({
        photoId: "abc",
        crop: { x: 0.1, y: 0.2, size: 0.5 },
      }),
    ).toEqual({ photoId: "abc", crop: { x: 0.1, y: 0.2, size: 0.5 } });
  });

  it("rejects missing pieces and non-finite numbers", () => {
    expect(parseFacePutBody({ crop: { x: 0, y: 0, size: 1 } })).toBeNull();
    expect(parseFacePutBody({ photoId: "abc" })).toBeNull();
    expect(
      parseFacePutBody({ photoId: "abc", crop: { x: Number.NaN, y: 0, size: 1 } }),
    ).toBeNull();
  });
});
