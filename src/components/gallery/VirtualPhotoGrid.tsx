"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  computeJustifiedLayout,
  type JustifiedItem,
} from "@/lib/gallery/layout";
import type { ClientPhoto } from "@/lib/gallery/client-types";
import { PhotoCard } from "@/components/gallery/PhotoCard";

export interface VirtualPhotoGridProps {
  photos: ClientPhoto[];
  hasMore: boolean;
  loading: boolean;
  onOpenPhoto: (photoId: string) => void;
  onLoadMore: () => void;
}

const TARGET_ROW_HEIGHT = 240;
const GAP = 12;

/** SSR-safe layout-effect: no-op on the server, real effect in the browser. */
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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

/**
 * Virtualized justified-row grid. Layout is computed deterministically for the
 * full photo list; only the visible rows mount (window virtualization by row).
 */
export function VirtualPhotoGrid({
  photos,
  hasMore,
  loading,
  onOpenPhoto,
  onLoadMore,
}: VirtualPhotoGridProps) {
  const [containerRef, containerWidth] = useContainerWidth();

  const items: JustifiedItem[] = useMemo(
    () =>
      photos.map((photo) => ({
        id: photo.id,
        aspectRatio: photo.aspectRatio,
      })),
    [photos],
  );

  const layout = useMemo(
    () =>
      computeJustifiedLayout(items, {
        containerWidth,
        targetRowHeight: TARGET_ROW_HEIGHT,
        gap: GAP,
      }),
    [items, containerWidth],
  );

  const photoById = useMemo(
    () => new Map(photos.map((p) => [p.id, p])),
    [photos],
  );
  const boxById = useMemo(
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

  return (
    <div ref={containerRef} className="w-full">
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
                  const photo = photos[itemIndex];
                  if (!photo) return null;
                  const box = boxById.get(photo.id);
                  if (!box) return null;
                  return (
                    <div
                      key={photo.id}
                      style={{
                        position: "absolute",
                        left: box.left,
                        top: 0,
                        width: box.width,
                        height: box.height,
                      }}
                    >
                      <PhotoCard
                        photo={photoById.get(photo.id) ?? photo}
                        width={box.width}
                        height={box.height}
                        onOpen={onOpenPhoto}
                      />
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
}
