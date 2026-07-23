/**
 * Deterministic justified-row layout math (packet 06).
 *
 * Pure geometry, no DOM, no randomness: the same inputs always yield the same
 * boxes. The gallery grid virtualizes by ROW (see VirtualPhotoGrid), so this
 * module returns both per-item boxes and per-row metrics.
 *
 * Aspect ratio is preserved exactly per item (each row shares one height, and
 * width = round(aspectRatio * rowHeight)); integer rounding remainder is
 * absorbed by the last box in a row so every full row's boxes span the
 * container edge-to-edge with no cumulative drift and no layout shift.
 */

export interface JustifiedItem {
  id: string;
  /** width / height. Square = 1. Must be finite and > 0. */
  aspectRatio: number;
}

export interface LayoutBox {
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
  rowIndex: number;
}

export interface LayoutRow {
  index: number;
  top: number;
  height: number;
  /** Indices into the input array for the items on this row. */
  itemIndexes: number[];
}

export interface JustifiedLayout {
  boxes: LayoutBox[];
  rows: LayoutRow[];
  containerHeight: number;
  containerWidth: number;
}

export interface JustifiedLayoutOptions {
  containerWidth: number;
  /** Ideal row height before justification stretches/shrinks it. */
  targetRowHeight?: number;
  /** Gap between items and between rows, in px. */
  gap?: number;
  /**
   * Cap for a row's justified height. Protects a sparse final row (or a single
   * very wide item) from ballooning far past the target.
   */
  maxRowHeight?: number;
}

const DEFAULT_TARGET_ROW_HEIGHT = 240;
const DEFAULT_GAP = 12;

function sanitizeAspect(aspectRatio: number): number {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return 1;
  // Clamp pathological panoramas / slivers so one item cannot dominate.
  return Math.min(Math.max(aspectRatio, 0.2), 5);
}

/**
 * Lay out items into justified rows that fill `containerWidth`.
 *
 * A row is closed once its items, scaled to the target height, would overflow
 * the container. The row height is then solved so the row fills the container
 * exactly. The final (unfilled) row keeps the target height, capped by
 * maxRowHeight, and is left-aligned (never stretched across a mostly-empty
 * row).
 */
export function computeJustifiedLayout(
  items: JustifiedItem[],
  options: JustifiedLayoutOptions,
): JustifiedLayout {
  const gap = options.gap ?? DEFAULT_GAP;
  const targetRowHeight = options.targetRowHeight ?? DEFAULT_TARGET_ROW_HEIGHT;
  const maxRowHeight = options.maxRowHeight ?? Math.round(targetRowHeight * 1.5);
  const containerWidth = Math.max(0, Math.floor(options.containerWidth));

  const boxes: LayoutBox[] = [];
  const rows: LayoutRow[] = [];

  if (items.length === 0 || containerWidth <= 0) {
    return { boxes, rows, containerHeight: 0, containerWidth };
  }

  const aspects = items.map((item) => sanitizeAspect(item.aspectRatio));

  let rowStart = 0;
  let top = 0;
  let rowIndex = 0;

  const flushRow = (endExclusive: number, isLastRow: boolean): void => {
    const count = endExclusive - rowStart;
    if (count <= 0) return;
    const rowAspects = aspects.slice(rowStart, endExclusive);
    const sumAspect = rowAspects.reduce((sum, a) => sum + a, 0);
    const totalGap = gap * (count - 1);
    const available = containerWidth - totalGap;

    // Solve the row height that makes scaled widths fill `available`.
    let rowHeight = sumAspect > 0 ? available / sumAspect : targetRowHeight;
    if (isLastRow) {
      // Do not stretch a partial trailing row; keep it near target.
      rowHeight = Math.min(rowHeight, targetRowHeight);
    }
    rowHeight = Math.min(rowHeight, maxRowHeight);
    rowHeight = Math.max(1, Math.round(rowHeight));

    const itemIndexes: number[] = [];
    let left = 0;
    for (let i = 0; i < count; i++) {
      const globalIndex = rowStart + i;
      const isLastInRow = i === count - 1;
      let width = Math.round(rowAspects[i] * rowHeight);
      if (width < 1) width = 1;
      if (isLastInRow && !isLastRow) {
        // Absorb rounding remainder so the row meets the container edge exactly.
        width = containerWidth - left;
        if (width < 1) width = 1;
      }
      boxes.push({
        id: items[globalIndex].id,
        top,
        left,
        width,
        height: rowHeight,
        rowIndex,
      });
      itemIndexes.push(globalIndex);
      left += width + gap;
    }

    rows.push({ index: rowIndex, top, height: rowHeight, itemIndexes });
    top += rowHeight + gap;
    rowIndex += 1;
    rowStart = endExclusive;
  };

  // Accumulate items until, at the target height, they would overflow.
  let widthAtTarget = 0;
  for (let i = 0; i < items.length; i++) {
    const itemWidth = aspects[i] * targetRowHeight;
    const countInRow = i - rowStart; // before adding this one
    const gapSoFar = countInRow * gap;
    if (
      countInRow > 0 &&
      widthAtTarget + gapSoFar + itemWidth > containerWidth
    ) {
      flushRow(i, false);
      widthAtTarget = 0;
    }
    widthAtTarget += itemWidth;
  }
  // Trailing row.
  flushRow(items.length, true);

  const containerHeight = rows.length > 0 ? top - gap : 0;
  return { boxes, rows, containerHeight, containerWidth };
}
