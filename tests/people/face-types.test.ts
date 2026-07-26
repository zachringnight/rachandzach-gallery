import { describe, expect, it } from "vitest";

import { faceCropCss, normalizeFaceCrop } from "@/lib/people/face-types";

/**
 * The crop contract: x = left/width, y = top/height, size =
 * side/min(width, height). faceCropCss must place the photo inside a square
 * container so exactly that square fills it.
 */
describe("faceCropCss", () => {
  it("scales a landscape photo so the crop square fills the tile", () => {
    // 2:1 photo, crop = the full height (size 1) starting at the left edge.
    const css = faceCropCss({ x: 0, y: 0, size: 1 }, 2);
    expect(css.width).toBe("200%"); // W = 2 * side
    expect(css.height).toBe("100%");
    expect(css.left).toBe("0%");
    expect(css.top).toBe("0%");
  });

  it("offsets by the crop origin in container units", () => {
    // 2:1 photo, half-height crop starting at x=0.25, y=0.5.
    const css = faceCropCss({ x: 0.25, y: 0.5, size: 0.5 }, 2);
    // side = 0.5 * H; image renders W/side = 4x the container wide.
    expect(css.width).toBe("400%");
    expect(css.height).toBe("200%");
    // left offset = x * W / side = 0.25 * 4 = 1 container.
    expect(css.left).toBe("-100%");
    expect(css.top).toBe("-100%");
  });

  it("handles portrait photos symmetrically", () => {
    const css = faceCropCss({ x: 0, y: 0, size: 0.5 }, 0.5); // 1:2 photo
    expect(css.width).toBe("200%");
    expect(css.height).toBe("400%");
  });
});

describe("normalizeFaceCrop", () => {
  it("clamps the origin so the square stays inside the image", () => {
    const crop = normalizeFaceCrop({ x: 0.99, y: 0.99, size: 0.5 }, 2);
    expect(crop).not.toBeNull();
    // 2:1 image: side = 0.5*H = 0.25*W -> x max 0.75; side = 0.5*H -> y max 0.5.
    expect(crop!.x).toBeCloseTo(0.75, 5);
    expect(crop!.y).toBeCloseTo(0.5, 5);
    expect(crop!.size).toBe(0.5);
  });

  it("caps size at the shorter axis", () => {
    const crop = normalizeFaceCrop({ x: 0, y: 0, size: 3 }, 1.5);
    expect(crop!.size).toBe(1);
  });

  it("rejects non-finite and non-positive values", () => {
    expect(normalizeFaceCrop({ x: Number.NaN, y: 0, size: 0.5 }, 1)).toBeNull();
    expect(normalizeFaceCrop({ x: 0, y: 0, size: 0 }, 1)).toBeNull();
    expect(
      normalizeFaceCrop({ x: 0, y: 0, size: Number.POSITIVE_INFINITY }, 1),
    ).toBeNull();
  });
});
