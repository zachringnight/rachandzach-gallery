import { describe, expect, it } from "vitest";

import { featureFlags, resolveFeatureFlags } from "@/content/features";
import { siteConfig } from "@/content/site";
import type { NavigationItem, WeekendEventContent } from "@/content/site";

/**
 * Placeholder detection. An enabled route must never ship one of these, and a
 * disabled module must never expose one as its link either.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^\s*$/,
  /^#/,
  /\bTODO\b/i,
  /\bTBD\b/i,
  /\bFIXME\b/i,
  /lorem/i,
  /ipsum/i,
  /placeholder/i,
  /example\.com/i,
  /your-?(name|text|link|url)/i,
];

const INTERNAL_ROUTE = /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/;

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, out);
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectStrings(entry, out);
  }
  return out;
}

// photographer carries the two Zach-confirmed external credit links
// (alibeck.co and her Instagram); every OTHER string must stay URL-free,
// so the no-invented-URLs sweep runs against the config minus that block.
const { photographer: _photographerCredit, ...siteConfigWithoutPhotographer } = siteConfig;
void _photographerCredit;
const allCopy = collectStrings(siteConfigWithoutPhotographer);
const allCopyJoined = allCopy.join("\n");

describe("site identity", () => {
  it("leads with Rachel and Zach", () => {
    expect(siteConfig.names.primary).toBe("Rachel");
    expect(siteConfig.names.secondary).toBe("Zach");
    expect(siteConfig.voice.heroTitle).toContain("Rachel");
    expect(siteConfig.voice.heroTitle).toContain("Zach");
  });

  it("anchors on July 19, 2025 in Santa Barbara", () => {
    expect(siteConfig.date).toBe("2025-07-19");
    expect(siteConfig.location).toBe("Santa Barbara, CA");
    const anchor = `${siteConfig.voice.eyebrow} ${siteConfig.voice.heroBody}`;
    expect(anchor).toContain("July 19, 2025");
    expect(anchor).toContain("Santa Barbara");
  });
});

describe("required phrases", () => {
  it('keeps "all of our favorite people"', () => {
    expect(allCopyJoined.toLowerCase()).toContain("all of our favorite people");
  });

  it('keeps "from the coast to the dance floor"', () => {
    expect(allCopyJoined.toLowerCase()).toContain("from the coast to the dance floor");
  });

  it('keeps "one last laugh, hug, and kiss" inside the weekend story', () => {
    const weekendCopy = collectStrings(siteConfig.weekend).join("\n").toLowerCase();
    expect(weekendCopy).toContain("one last laugh, hug, and kiss");
  });

  it('keeps "yes, even you" as a single playful accent, not a gimmick', () => {
    const matches = allCopyJoined.toLowerCase().match(/yes, even you/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe("navigation", () => {
  it("has at least one enabled item", () => {
    expect(siteConfig.navigation.some((item) => item.enabled)).toBe(true);
  });

  it("gives every enabled navigation item a real internal route", () => {
    for (const item of siteConfig.navigation.filter((entry) => entry.enabled)) {
      expect(item.href, `enabled item "${item.label}" must have a route`).toBeTruthy();
      expect(item.href, `enabled item "${item.label}" must be an internal route`).toMatch(
        INTERNAL_ROUTE,
      );
      expect(
        isPlaceholder(item.href),
        `enabled item "${item.label}" must not use a placeholder URL: ${item.href}`,
      ).toBe(false);
    }
  });

  it("never lets a disabled content module expose a placeholder link", () => {
    for (const item of siteConfig.navigation.filter((entry) => !entry.enabled)) {
      expect(
        isPlaceholder(item.href),
        `disabled item "${item.label}" must not carry a placeholder link: ${item.href}`,
      ).toBe(false);
      expect(item.href, `disabled item "${item.label}" must reserve a real route`).toMatch(
        INTERNAL_ROUTE,
      );
    }
  });

  it("ties every disabled item to a feature flag that is off outside development", () => {
    const productionFlags = resolveFeatureFlags("production");
    for (const item of siteConfig.navigation.filter((entry) => !entry.enabled)) {
      expect(item.flag, `disabled item "${item.label}" must reference its flag`).toBeDefined();
      expect(productionFlags[item.flag as keyof typeof productionFlags]).toBe(false);
    }
  });

  it("has no duplicate routes or empty labels", () => {
    const hrefs = siteConfig.navigation.map((item: NavigationItem) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const item of siteConfig.navigation) {
      expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("weekend story content", () => {
  it("covers the full July 18-20 weekend", () => {
    expect(siteConfig.weekend.length).toBeGreaterThanOrEqual(4);
    for (const event of siteConfig.weekend) {
      expect(event.dateISO).toMatch(/^2025-07-(18|19|20)$/);
    }
    const weddingDay = siteConfig.weekend.filter(
      (event: WeekendEventContent) => event.dateISO === siteConfig.date,
    );
    expect(weddingDay.length).toBeGreaterThanOrEqual(1);
  });

  it("ships complete copy for every event", () => {
    for (const event of siteConfig.weekend) {
      for (const field of [event.id, event.title, event.dateLabel, event.venue, event.description]) {
        expect(field.trim().length, `event "${event.id}" has missing copy`).toBeGreaterThan(0);
        expect(isPlaceholder(field), `event "${event.id}" contains placeholder copy`).toBe(false);
      }
    }
  });

  it("invents no URLs anywhere in the content", () => {
    for (const value of allCopy) {
      expect(value, "content must not contain invented URLs").not.toMatch(/https?:\/\//i);
      expect(value, "content must not contain invented URLs").not.toMatch(/www\./i);
    }
  });
});

describe("voice copy", () => {
  it("ships every voice field without placeholders", () => {
    const { eyebrow, heroTitle, heroBody, galleryIntro, uploadIntro } = siteConfig.voice;
    for (const value of [eyebrow, heroTitle, heroBody, galleryIntro, uploadIntro]) {
      expect(value.trim().length).toBeGreaterThan(0);
      expect(isPlaceholder(value)).toBe(false);
    }
  });
});

describe("feature flags", () => {
  it("keeps unreleased modules off everywhere", () => {
    for (const env of ["development", "production", "test", undefined]) {
      const flags = resolveFeatureFlags(env);
      expect(flags.playlists).toBe(false);
      expect(flags.marathon).toBe(false);
      expect(flags.anniversaryCapsule).toBe(false);
      expect(flags.memoryNotes).toBe(false);
    }
  });

  it("enables momentSearch only in development", () => {
    expect(resolveFeatureFlags("development").momentSearch).toBe(true);
    expect(resolveFeatureFlags("production").momentSearch).toBe(false);
    expect(resolveFeatureFlags("test").momentSearch).toBe(false);
    expect(resolveFeatureFlags(undefined).momentSearch).toBe(false);
  });

  it("resolves the ambient flags from the current environment", () => {
    // Vitest runs with NODE_ENV=test, so the ambient snapshot must match.
    expect(featureFlags).toEqual(resolveFeatureFlags(process.env.NODE_ENV));
    expect(featureFlags.momentSearch).toBe(false);
  });
});
