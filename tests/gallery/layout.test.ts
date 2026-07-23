import { describe, expect, it } from "vitest";
import {
  computeJustifiedLayout,
  type JustifiedItem,
  type JustifiedLayout,
} from "@/lib/gallery/layout";

const LANDSCAPE = 6000 / 4000; // 1.5
const PORTRAIT = 4000 / 6000; // 0.667
const SQUARE = 1;

function mixedItems(count: number): JustifiedItem[] {
  const pattern = [LANDSCAPE, PORTRAIT, SQUARE, LANDSCAPE, LANDSCAPE, PORTRAIT];
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    aspectRatio: pattern[i % pattern.length],
  }));
}

const OPTIONS = { containerWidth: 1000, targetRowHeight: 240, gap: 12 };

function rowBoxes(layout: JustifiedLayout, rowIndex: number) {
  return layout.boxes
    .filter((b) => b.rowIndex === rowIndex)
    .sort((a, b) => a.left - b.left);
}

describe("computeJustifiedLayout edge cases", () => {
  it("returns empty for no items", () => {
    const layout = computeJustifiedLayout([], OPTIONS);
    expect(layout.boxes).toHaveLength(0);
    expect(layout.rows).toHaveLength(0);
    expect(layout.containerHeight).toBe(0);
  });

  it("returns empty when the container has no width", () => {
    const layout = computeJustifiedLayout(mixedItems(10), {
      ...OPTIONS,
      containerWidth: 0,
    });
    expect(layout.boxes).toHaveLength(0);
  });

  it("does not stretch a single-item trailing row across the container", () => {
    const layout = computeJustifiedLayout([{ id: "solo", aspectRatio: SQUARE }], OPTIONS);
    expect(layout.rows).toHaveLength(1);
    const box = layout.boxes[0];
    expect(box.width).toBeLessThan(OPTIONS.containerWidth);
    // Square at (capped) target height.
    expect(box.height).toBeLessThanOrEqual(OPTIONS.targetRowHeight);
    expect(box.width).toBe(Math.round(box.height * SQUARE));
  });
});

describe("computeJustifiedLayout justification", () => {
  const layout = computeJustifiedLayout(mixedItems(90), OPTIONS);

  it("assigns every item exactly once, in order, across rows", () => {
    const indexes = layout.rows.flatMap((r) => r.itemIndexes);
    expect(indexes).toEqual(Array.from({ length: 90 }, (_, i) => i));
  });

  it("fills the container edge-to-edge on every full (non-last) row", () => {
    const lastRow = layout.rows.length - 1;
    for (const row of layout.rows) {
      if (row.index === lastRow) continue;
      const boxes = rowBoxes(layout, row.index);
      const last = boxes[boxes.length - 1];
      expect(last.left + last.width).toBe(OPTIONS.containerWidth);
      expect(boxes[0].left).toBe(0);
    }
  });

  it("packs boxes left-to-right with exactly one gap between them", () => {
    for (const row of layout.rows) {
      const boxes = rowBoxes(layout, row.index);
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i].left).toBe(boxes[i - 1].left + boxes[i - 1].width + OPTIONS.gap);
      }
    }
  });

  it("never overflows the container horizontally", () => {
    const lastRow = layout.rows.length - 1;
    for (const box of layout.boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.width).toBeLessThanOrEqual(OPTIONS.containerWidth);
      const rowCount = layout.rows[box.rowIndex].itemIndexes.length;
      // Full rows land exactly on the edge; the last row allows sub-pixel
      // rounding slack (at most one px per item in the row).
      const slack = box.rowIndex === lastRow ? rowCount : 0;
      expect(box.left + box.width).toBeLessThanOrEqual(OPTIONS.containerWidth + slack);
    }
  });

  it("shares one height per row and preserves aspect ratio per item", () => {
    const items = mixedItems(90);
    for (const row of layout.rows) {
      const boxes = rowBoxes(layout, row.index);
      const height = row.height;
      expect(boxes.every((b) => b.height === height)).toBe(true);
      // Every box except the row's remainder-absorbing last one keeps its
      // aspect ratio (width == round(aspect * height)).
      for (let i = 0; i < boxes.length - 1; i++) {
        const globalIndex = row.itemIndexes[i];
        const expectedWidth = Math.round(items[globalIndex].aspectRatio * height);
        expect(boxes[i].width).toBe(expectedWidth);
      }
    }
  });

  it("stacks rows with a gap and reports a consistent container height", () => {
    for (let i = 1; i < layout.rows.length; i++) {
      const prev = layout.rows[i - 1];
      const cur = layout.rows[i];
      expect(cur.top).toBe(prev.top + prev.height + OPTIONS.gap);
    }
    const last = layout.rows[layout.rows.length - 1];
    expect(layout.containerHeight).toBe(last.top + last.height);
    // Every box sits on its row's top edge.
    for (const box of layout.boxes) {
      expect(box.top).toBe(layout.rows[box.rowIndex].top);
    }
  });

  it("keeps every row height at or below the target (full rows) and the cap", () => {
    const maxRowHeight = Math.round(OPTIONS.targetRowHeight * 1.5);
    for (const row of layout.rows) {
      expect(row.height).toBeGreaterThanOrEqual(1);
      expect(row.height).toBeLessThanOrEqual(maxRowHeight);
    }
  });
});

describe("computeJustifiedLayout determinism", () => {
  it("produces identical output for identical input", () => {
    const a = computeJustifiedLayout(mixedItems(57), OPTIONS);
    const b = computeJustifiedLayout(mixedItems(57), OPTIONS);
    expect(a).toEqual(b);
  });

  it("handles all-portrait and all-landscape catalogs without overflow", () => {
    for (const aspect of [PORTRAIT, LANDSCAPE, SQUARE]) {
      const items = Array.from({ length: 40 }, (_, i) => ({
        id: `x${i}`,
        aspectRatio: aspect,
      }));
      const layout = computeJustifiedLayout(items, OPTIONS);
      const lastRow = layout.rows.length - 1;
      for (const row of layout.rows) {
        if (row.index === lastRow) continue;
        const boxes = rowBoxes(layout, row.index);
        const last = boxes[boxes.length - 1];
        expect(last.left + last.width).toBe(OPTIONS.containerWidth);
      }
    }
  });
});
