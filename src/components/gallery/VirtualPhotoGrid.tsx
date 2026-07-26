"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Layers } from "lucide-react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  computeJustifiedLayout,
  type JustifiedItem,
} from "@/lib/gallery/layout";
import type { ClientPhoto } from "@/lib/gallery/client-types";
import {
  buildDisplayList,
  displayIndexForPhotoIndex,
  displayItemPhotoIds,
  type DisplayItem,
} from "@/lib/gallery/grouping";
import { ContactStackCard } from "@/components/gallery/ContactStackCard";
import { PhotoCard } from "@/components/gallery/PhotoCard";

export interface VirtualPhotoGridProps {
  photos: ClientPhoto[];
  hasMore: boolean;
  loading: boolean;
  onOpenPhoto: (photoId: string) => void;
  onLoadMore: () => void;
  selecting?: boolean;
  selected?: ReadonlySet<string>;
  onToggleSelection?: (photoId: string) => void;
  onStartSelection?: (photoId: string) => void;
  /** Contact-sheet stacks currently fanned out inline (P4). */
  expandedBursts?: ReadonlySet<string>;
  onToggleBurst?: (burstId: string) => void;
  /** Toggle selection for every loaded frame of a burst at once. */
  onToggleBurstSelection?: (photoIds: string[]) => void;
  /**
   * Reports the index (into `photos`) of the first photograph on screen as
   * the guest scrolls; drives the Light Bar and chapter label (P3).
   */
  onFirstVisiblePhotoChange?: (photoIndex: number) => void;
}

export interface VirtualPhotoGridHandle {
  scrollToIndex(index: number): void;
}

const TARGET_ROW_HEIGHT = 240;
const GAP = 12;

/**
 * Row height and gutter scale with the viewport (P6). A justified grid packs
 * a row until it fills the width, so a fixed 240px target put exactly one
 * landscape frame on a 390px phone: the archive read as a single-file column
 * and a guest scrolled 1,721 times to see it. Shorter rows on narrow screens
 * put two frames side by side, which is what makes a phone feel like a
 * contact sheet instead of a feed.
 *
 * Desktop is unchanged: at >=900px this returns the original 240/12.
 */
function gridMetricsFor(containerWidth: number): {
  targetRowHeight: number;
  gap: number;
} {
  if (containerWidth <= 0) return { targetRowHeight: TARGET_ROW_HEIGHT, gap: GAP };
  if (containerWidth < 480) return { targetRowHeight: 132, gap: 6 };
  if (containerWidth < 700) return { targetRowHeight: 168, gap: 8 };
  if (containerWidth < 900) return { targetRowHeight: 200, gap: 10 };
  return { targetRowHeight: TARGET_ROW_HEIGHT, gap: GAP };
}
/** Sticky chrome (header + control bar + chapter strip) above the grid. */
const VISIBLE_TOP_OFFSET = 170;

/** SSR-safe layout-effect: no-op on the server, real effect in the browser. */
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * True only for the first moment after mount.
 *
 * The entrance stagger has to be scoped in time, not just in selector: rows
 * are virtualized, so cards mount continuously as a guest scrolls, and a
 * purely CSS rule would re-run the animation on every row that scrolls into
 * view. Dropping the class once the opening rows have played means later rows
 * appear instantly, which is what you want while scrolling anyway.
 */
function useFirstPaint(durationMs = 700): boolean {
  const [firstPaint, setFirstPaint] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setFirstPaint(false), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs]);
  return firstPaint;
}

function useContainerWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useIsoLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function itemAspect(item: DisplayItem): number {
  const photo = item.kind === "stack" ? item.photos[0] : item.photo;
  return photo.aspectRatio;
}

/**
 * Virtualized justified-row grid. Layout is computed deterministically for
 * the full display list (photos plus collapsed contact-sheet stacks); only
 * the visible rows mount (window virtualization by row).
 */
export const VirtualPhotoGrid = forwardRef<
  VirtualPhotoGridHandle,
  VirtualPhotoGridProps
>(function VirtualPhotoGrid(
  {
    photos,
    hasMore,
    loading,
    onOpenPhoto,
    onLoadMore,
    selecting = false,
    selected = new Set<string>(),
    onToggleSelection,
    onStartSelection,
    expandedBursts = new Set<string>(),
    onToggleBurst,
    onToggleBurstSelection,
    onFirstVisiblePhotoChange,
  },
  forwardedRef,
) {
  const [containerRef, containerWidth] = useContainerWidth();
  const firstPaint = useFirstPaint();

  const displayItems = useMemo(
    () => buildDisplayList(photos, expandedBursts),
    [photos, expandedBursts],
  );

  const items: JustifiedItem[] = useMemo(
    () =>
      displayItems.map((item) => ({
        id: item.key,
        aspectRatio: itemAspect(item),
      })),
    [displayItems],
  );

  const layout = useMemo(
    () =>
      computeJustifiedLayout(items, {
        containerWidth,
        ...gridMetricsFor(containerWidth),
      }),
    [items, containerWidth],
  );

  const boxByKey = useMemo(
    () => new Map(layout.boxes.map((b) => [b.id, b])),
    [layout],
  );

  const [scrollMargin, setScrollMargin] = useState(0);
  useIsoLayoutEffect(() => {
    if (containerRef.current) {
      setScrollMargin(
        containerRef.current.getBoundingClientRect().top + window.scrollY,
      );
    }
  }, [containerRef, containerWidth, layout.rows.length]);

  const virtualizer = useWindowVirtualizer({
    count: layout.rows.length,
    estimateSize: (index) => layout.rows[index].height + GAP,
    overscan: 6,
    scrollMargin,
  });

  const scrollToPhotoIndex = useCallback(
    (photoIndex: number) => {
      const bounded = Math.max(0, Math.min(photoIndex, photos.length - 1));
      const displayIndex = displayIndexForPhotoIndex(displayItems, bounded);
      if (displayIndex < 0) return;
      const box = boxByKey.get(displayItems[displayIndex].key);
      if (!box) return;
      virtualizer.scrollToIndex(box.rowIndex, { align: "start" });
      // Pull the row out from under the sticky chrome (header + control
      // bar + chapter strip), keeping a small breath above it.
      window.scrollBy(0, -(VISIBLE_TOP_OFFSET - 12));
    },
    [boxByKey, displayItems, photos.length, virtualizer],
  );

  useImperativeHandle(
    forwardedRef,
    () => ({ scrollToIndex: scrollToPhotoIndex }),
    [scrollToPhotoIndex],
  );

  // Load more when the last virtualized row is within reach of the tail.
  const virtualRows = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualRows[virtualRows.length - 1]?.index ?? -1;
  useEffect(() => {
    if (
      hasMore &&
      !loading &&
      lastVirtualIndex >= 0 &&
      lastVirtualIndex >= layout.rows.length - 3
    ) {
      onLoadMore();
    }
  }, [hasMore, loading, lastVirtualIndex, layout.rows.length, onLoadMore]);

  // Report the first photograph on screen (below the sticky chrome) so the
  // Light Bar and chapter label track scroll in both directions.
  const lastReportedIndex = useRef(-1);
  const scrollOffset = virtualizer.scrollOffset ?? 0;
  useEffect(() => {
    if (!onFirstVisiblePhotoChange || layout.rows.length === 0) return;
    const threshold = scrollOffset + VISIBLE_TOP_OFFSET;
    let firstRow = layout.rows[0];
    for (const row of layout.rows) {
      if (row.top + scrollMargin + row.height > threshold) {
        firstRow = row;
        break;
      }
    }
    const item = displayItems[firstRow.itemIndexes[0]];
    if (!item) return;
    if (item.photoIndex !== lastReportedIndex.current) {
      lastReportedIndex.current = item.photoIndex;
      onFirstVisiblePhotoChange(item.photoIndex);
    }
  }, [
    displayItems,
    layout.rows,
    onFirstVisiblePhotoChange,
    scrollMargin,
    scrollOffset,
  ]);

  return (
    <div
      ref={containerRef}
      className={
        firstPaint ? "w-full atlas-photo-grid-first-paint" : "w-full"
      }
    >
      {containerWidth > 0 && layout.rows.length > 0 ? (
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualRows.map((virtualRow) => {
            const row = layout.rows[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: row.height,
                  transform: `translateY(${
                    virtualRow.start - virtualizer.options.scrollMargin
                  }px)`,
                }}
              >
                {row.itemIndexes.map((itemIndex) => {
                  const item = displayItems[itemIndex];
                  if (!item) return null;
                  const box = boxByKey.get(item.key);
                  if (!box) return null;

                  if (item.kind === "stack") {
                    const ids = displayItemPhotoIds(item);
                    const selectedCount = ids.filter((id) =>
                      selected.has(id),
                    ).length;
                    return (
                      <div
                        key={item.key}
                        style={{
                          position: "absolute",
                          left: box.left,
                          top: 0,
                          width: box.width,
                          height: box.height,
                        }}
                      >
                        <ContactStackCard
                          photos={item.photos}
                          size={item.size}
                          width={box.width}
                          height={box.height}
                          onExpand={() => onToggleBurst?.(item.burstId)}
                          selecting={selecting}
                          selected={
                            ids.length > 0 && selectedCount === ids.length
                          }
                          partiallySelected={
                            selectedCount > 0 && selectedCount < ids.length
                          }
                          onToggleSelection={
                            onToggleBurstSelection
                              ? () => onToggleBurstSelection(ids)
                              : undefined
                          }
                        />
                      </div>
                    );
                  }

                  const photo = item.photo;
                  const isBurstFrame = item.kind === "burst-frame";
                  return (
                    <div
                      key={item.key}
                      style={{
                        position: "absolute",
                        left: box.left,
                        top: 0,
                        width: box.width,
                        height: box.height,
                      }}
                      data-burst-frame={isBurstFrame ? "true" : undefined}
                      className={isBurstFrame ? "atlas-burst-frame" : undefined}
                    >
                      <PhotoCard
                        photo={photo}
                        width={box.width}
                        height={box.height}
                        onOpen={onOpenPhoto}
                        selecting={selecting}
                        selected={selected.has(photo.id)}
                        onToggleSelection={onToggleSelection}
                        onStartSelection={onStartSelection}
                      />
                      {isBurstFrame && item.leader && onToggleBurst ? (
                        <button
                          type="button"
                          className="atlas-stack-collapse"
                          aria-label={`Collapse these ${
                            photo.burst?.size ?? 0
                          } frames back into one stack`}
                          title="Collapse stack"
                          onClick={() => onToggleBurst(item.burstId)}
                        >
                          <Layers aria-hidden="true" size={14} strokeWidth={1.8} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : null}

      {loading ? (
        <p className="py-8 text-center text-sm text-muted">Loading photos…</p>
      ) : null}
    </div>
  );
});

VirtualPhotoGrid.displayName = "VirtualPhotoGrid";
