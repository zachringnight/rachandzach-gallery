/**
 * Geometry regression test for the /admin/faces crop stage
 * (src/components/admin/GuestFaceManager.tsx, stageBoxStyle).
 *
 * The invariant under test: the stage box must always have EXACTLY the
 * photo's aspect ratio while fitting inside both the container width and
 * the 52vh viewport cap. Every pointer handler, the crop overlay, the dim
 * cutout, and the normalized crop that gets saved to Find me all compute
 * fractions of the stage box, so "stage box aspect ratio === photo aspect
 * ratio" is precisely the condition under which the box and the
 * object-contain painted image are the same rect and pointer math is
 * correct by construction.
 *
 * The old style -- a block-level box with `aspect-ratio` plus
 * `max-height: 52vh` -- violated this whenever the height clamp bit
 * (portrait photos, short viewports): block layout keeps the width
 * stretched to the container while only the height shrinks, so the photo
 * letterboxed inside a wider box and the saved crop was offset from the
 * face the admin framed. The legacy model below reproduces that failure
 * numerically so this file fails loudly if anyone reintroduces the clamp.
 */
import { describe, expect, it } from "vitest";

import {
  STAGE_MAX_VIEWPORT_HEIGHT_FRACTION,
  stageBoxStyle,
} from "@/components/admin/GuestFaceManager";

/**
 * Resolves the CSS the component actually emits against a concrete layout
 * context, using the CSS specs' own rules:
 *   - `min(100%, <K>vh * <a>)` -> min(containerWidth, K/100 * viewportH * a)
 *   - `aspect-ratio: a` with a definite width -> height = width / a
 * Parsing the emitted string (rather than re-deriving the formula) keeps
 * the test pinned to the real style object.
 */
function resolveStageBox(
  aspectRatio: number,
  containerWidth: number,
  viewportHeight: number,
): { width: number; height: number } {
  const style = stageBoxStyle(aspectRatio);
  const match = /^min\(100%, ([\d.]+)vh \* ([\d.eE+-]+)\)$/.exec(
    String(style.width),
  );
  expect(match, `width must be a min(100%, …vh * a) expression: ${style.width}`)
    .not.toBeNull();
  const capFraction = Number(match![1]) / 100;
  const a = Number(match![2]);
  expect(capFraction).toBeCloseTo(STAGE_MAX_VIEWPORT_HEIGHT_FRACTION, 10);
  const width = Math.min(containerWidth, capFraction * viewportHeight * a);
  const boxRatio = Number(style.aspectRatio);
  expect(boxRatio).toBeGreaterThan(0);
  return { width, height: width / boxRatio };
}

/**
 * The pre-fix stage: block width stretched to the container, height derived
 * from aspect-ratio then clamped by max-height alone.
 */
function legacyStageBox(
  aspectRatio: number,
  containerWidth: number,
  viewportHeight: number,
): { width: number; height: number } {
  return {
    width: containerWidth,
    height: Math.min(
      containerWidth / aspectRatio,
      STAGE_MAX_VIEWPORT_HEIGHT_FRACTION * viewportHeight,
    ),
  };
}

/** Rect an object-contain image paints inside a box, per CSS. */
function paintedImage(
  box: { width: number; height: number },
  aspectRatio: number,
): { width: number; height: number } {
  const scale = Math.min(box.width / aspectRatio, box.height / 1);
  return { width: scale * aspectRatio, height: scale };
}

/** containerWidth: the editor dialog is max-w-4xl (896px) with p-7. */
const CONTAINER = 840;

describe("stageBoxStyle", () => {
  const cases: {
    label: string;
    aspectRatio: number;
    viewportHeight: number;
  }[] = [
    { label: "portrait 2:3, tall viewport", aspectRatio: 2 / 3, viewportHeight: 1000 },
    { label: "portrait 2:3, short viewport", aspectRatio: 2 / 3, viewportHeight: 700 },
    { label: "portrait 3:4, short viewport", aspectRatio: 3 / 4, viewportHeight: 700 },
    { label: "landscape 3:2, tall viewport", aspectRatio: 3 / 2, viewportHeight: 1000 },
    { label: "landscape 3:2, short viewport", aspectRatio: 3 / 2, viewportHeight: 700 },
    { label: "square, short viewport", aspectRatio: 1, viewportHeight: 700 },
    { label: "phone-narrow container", aspectRatio: 2 / 3, viewportHeight: 844 },
  ];

  it.each(cases)(
    "box === painted image and both caps hold: $label",
    ({ aspectRatio, viewportHeight, label }) => {
      const container = label.startsWith("phone") ? 342 : CONTAINER;
      const box = resolveStageBox(aspectRatio, container, viewportHeight);

      // The whole point: the box has the photo's aspect ratio exactly, so
      // the object-contain image is the box.
      expect(box.width / box.height).toBeCloseTo(aspectRatio, 10);
      const painted = paintedImage(box, aspectRatio);
      expect(painted.width).toBeCloseTo(box.width, 8);
      expect(painted.height).toBeCloseTo(box.height, 8);

      // And it still respects both constraints the old style enforced.
      expect(box.width).toBeLessThanOrEqual(container + 1e-9);
      expect(box.height).toBeLessThanOrEqual(
        STAGE_MAX_VIEWPORT_HEIGHT_FRACTION * viewportHeight + 1e-9,
      );
    },
  );

  it("reproduces the legacy letterbox bug it guards against (portrait, 700px viewport)", () => {
    const a = 2 / 3;
    const legacy = legacyStageBox(a, CONTAINER, 700);
    const legacyPainted = paintedImage(legacy, a);
    // Height clamped to 364px, width still stretched to 840px: the painted
    // photo was only ~243px wide, leaving ~597px of letterbox that pointer
    // math silently treated as photo.
    expect(legacy.height).toBeCloseTo(364, 6);
    expect(legacy.width).toBe(CONTAINER);
    expect(legacyPainted.width).toBeLessThan(legacy.width - 500);
    expect(legacy.width / legacy.height).not.toBeCloseTo(a, 1);

    // A press in the visual centre of the painted photo, expressed as a
    // fraction of the legacy stage, did NOT read as the photo's centre.
    const pressX = (legacy.width - legacyPainted.width) / 2 + legacyPainted.width / 2;
    const legacyFraction = pressX / legacy.width;
    expect(legacyFraction).toBeCloseTo(0.5, 10); // centred press...
    // ...but the same press measured against the painted image vs the fixed
    // stage: with the fix the two frames coincide, so the fraction IS the
    // photo fraction.
    const fixed = resolveStageBox(a, CONTAINER, 700);
    const fixedPainted = paintedImage(fixed, a);
    expect(fixedPainted.width).toBeCloseTo(fixed.width, 8);
    // The legacy horizontal error, translated to the photo's own axis: a
    // press at photo-centre mapped to crop x wildly off once the stage
    // fraction was applied to the photo grid. Quantify it: fraction of the
    // painted image the press actually sat at, per frame.
    const paintedFraction =
      (pressX - (legacy.width - legacyPainted.width) / 2) / legacyPainted.width;
    expect(paintedFraction).toBeCloseTo(0.5, 10);
    // Under the legacy stage, reading 0.5 of the STAGE as 0.5 of the PHOTO
    // was only correct at dead centre; anywhere else the scales differ by
    // the letterbox ratio. One step (10% of the stage) off centre:
    const stepStage = 0.1; // fraction of stage width
    const stepPhoto = (stepStage * legacy.width) / legacyPainted.width;
    expect(stepPhoto).toBeGreaterThan(0.3); // 10% of stage ~ 35% of photo
  });

  it("matches the legacy box wherever the clamp never bit (landscape, tall viewport)", () => {
    const a = 3 / 2;
    const viewport = 1000;
    // Legacy: width 840, height 560 <= 520? No: 560 > 520, clamp bites even
    // here. Use a wider ratio where it does not: height 840/2 = 420 <= 520.
    const wide = 2;
    const legacy = legacyStageBox(wide, CONTAINER, viewport);
    const fixed = resolveStageBox(wide, CONTAINER, viewport);
    expect(fixed.width).toBeCloseTo(legacy.width, 8);
    expect(fixed.height).toBeCloseTo(legacy.height, 8);
    // And for 3:2 at this viewport the fixed box respects the cap while the
    // legacy box distorted instead:
    const fixed32 = resolveStageBox(a, CONTAINER, viewport);
    expect(fixed32.width / fixed32.height).toBeCloseTo(a, 10);
  });
});
