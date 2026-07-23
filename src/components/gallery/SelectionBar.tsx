"use client";

import { Download, Heart, Images, X } from "lucide-react";

export interface SelectionBarProps {
  count: number;
  onDownload?: () => void;
  onFavoriteAll: () => void;
  onClear: () => void;
  onSelectAllVisible?: () => void;
  /** Reuses the existing streamed-ZIP control without duplicating its logic. */
  downloadControl?: React.ReactNode;
}

export function SelectionBar({
  count,
  onDownload,
  onFavoriteAll,
  onClear,
  onSelectAllVisible,
  downloadControl,
}: SelectionBarProps) {
  return (
    <aside
      className="atlas-selection-bar"
      aria-label="Selected photos"
      data-empty={count === 0 ? "true" : "false"}
    >
      <p className="atlas-selection-count" aria-live="polite">
        <span>{count.toLocaleString()}</span>
        {count === 1 ? " photo selected" : " photos selected"}
      </p>

      <div className="atlas-selection-actions">
        {onSelectAllVisible ? (
          <button type="button" onClick={onSelectAllVisible}>
            <Images aria-hidden="true" size={15} strokeWidth={1.6} />
            Select loaded
          </button>
        ) : null}

        {downloadControl ?? (
          <button type="button" onClick={onDownload} disabled={count === 0}>
            <Download aria-hidden="true" size={15} strokeWidth={1.6} />
            Download
          </button>
        )}

        <button type="button" onClick={onFavoriteAll} disabled={count === 0}>
          <Heart aria-hidden="true" size={15} strokeWidth={1.6} />
          Favorite all
        </button>

        <button type="button" onClick={onClear}>
          <X aria-hidden="true" size={15} strokeWidth={1.6} />
          Clear
        </button>
      </div>
    </aside>
  );
}
