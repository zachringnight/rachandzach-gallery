"use client";

import { useCallback, useEffect, useState } from "react";

export interface GallerySelection {
  selecting: boolean;
  selected: ReadonlySet<string>;
  start(): void;
  toggle(id: string): void;
  selectAllVisible(ids: string[]): void;
  clear(): void;
}

/** Local, scroll-stable photo selection keyed by immutable photo ids. */
export function useSelection(): GallerySelection {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const start = useCallback(() => setSelecting(true), []);

  const toggle = useCallback((id: string) => {
    if (!id) return;
    setSelecting(true);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback((ids: string[]) => {
    setSelecting(true);
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (id) next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set<string>());
    setSelecting(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selecting) clear();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clear, selecting]);

  return { selecting, selected, start, toggle, selectAllVisible, clear };
}
