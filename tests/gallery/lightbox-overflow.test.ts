import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the lightbox horizontal-offset defect
 * (docs/DESIGN_REVIEW_2026-08-10.md section 1.1).
 *
 * At 1280x800 and 1440x900 the whole lightbox rendered 154px to the left,
 * putting the "Previous photo" button at left: -49px where no guest on a
 * laptop could reach it, and clipping the caption. The cause was that
 * `.atlas-lightbox` was `overflow: hidden`: the closed Notes panel is parked
 * at `translateX(100%)`, a transformed box still contributes to its
 * ancestor's scrollable overflow, and an `overflow: hidden` box is still
 * PROGRAMMATICALLY scrollable -- so when focus moved to the Close button on
 * open, the browser scrolled it into view and dragged everything with it.
 * `overflow: clip` produces a box that cannot scroll at all.
 *
 * WHY THIS IS A CSS-TEXT TEST AND NOT A BROWSER TEST
 * The real assertion is `.atlas-lightbox`'s scrollLeft staying 0 at those
 * widths, and it was verified that way by hand. It cannot run in CI: the
 * lightbox only opens over a populated grid, and the e2e suite runs against
 * a synthetic Supabase with no photographs, which is exactly why
 * "lightbox open over the gallery grid" already sits in visual.spec.ts's
 * "known gaps requiring a live database" block.
 *
 * What CAN be pinned without a database is the declaration itself, and that
 * is the thing at risk: the fix is one property on one rule, in a 9,000-line
 * stylesheet where a later `overflow: hidden` on the same selector would
 * silently restore the bug. That is not hypothetical here -- the touch-target
 * work in the same pass found 44px rules that a later block had already been
 * quietly overriding for months.
 */

const CSS = readFileSync(
  path.join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

/** Every `.atlas-lightbox { ... }` block body, in source order. */
function lightboxRuleBodies(): string[] {
  const bodies: string[] = [];
  // The base rule only; `.atlas-lightbox-header`, `.atlas-lightbox[data-...]`
  // and descendant rules are different boxes and are not the containing
  // block for the arrows.
  const pattern = /(^|\n)\s*\.atlas-lightbox\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(CSS)) !== null) bodies.push(match[2]);
  return bodies;
}

describe("the lightbox cannot become a scroll container", () => {
  it("declares a base .atlas-lightbox rule", () => {
    expect(lightboxRuleBodies().length).toBeGreaterThan(0);
  });

  it("resolves overflow to clip, not hidden", () => {
    for (const body of lightboxRuleBodies()) {
      const overflows = [...body.matchAll(/(?:^|;|\n)\s*overflow\s*:\s*([^;]+)/g)]
        .map((m) => m[1].trim());
      if (overflows.length === 0) continue;
      // `hidden` may appear FIRST as the fallback for engines without
      // `clip`; what matters is that the last one to win is `clip`.
      expect(overflows.at(-1)).toBe("clip");
    }
  });

  it("never re-declares .atlas-lightbox overflow as hidden after the base rule", () => {
    const bodies = lightboxRuleBodies();
    // A second base-rule block that set overflow back to hidden would
    // reintroduce the defect exactly as it was.
    const laterHidden = bodies
      .slice(1)
      .some((body) => /overflow\s*:\s*hidden\s*(?:;|$)/.test(body.trim()));
    expect(laterHidden).toBe(false);
  });
});
