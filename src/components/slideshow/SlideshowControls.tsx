"use client";

import {
  Captions,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Pause,
  Play,
} from "lucide-react";

export interface SlideshowControlsProps {
  playing: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  /** True when there is nothing to page through (0 or 1 photo). */
  disablePrevNext?: boolean;
  showCaptions: boolean;
  onToggleCaptions: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  intervalMs: number;
  onIntervalChange: (ms: number) => void;
  minIntervalMs: number;
  maxIntervalMs: number;
  className?: string;
}

const BUTTON_CLASS =
  "atlas-slideshow-button";

/**
 * The transport bar under a Slideshow: play/pause, previous/next, caption
 * toggle, full screen, and an interval slider. Pure presentational
 * component; Slideshow owns all the state.
 */
export function SlideshowControls({
  playing,
  onTogglePlay,
  onPrev,
  onNext,
  disablePrevNext = false,
  showCaptions,
  onToggleCaptions,
  isFullscreen,
  onToggleFullscreen,
  intervalMs,
  onIntervalChange,
  minIntervalMs,
  maxIntervalMs,
  className,
}: SlideshowControlsProps) {
  return (
    <div
      className={
        className ??
        "atlas-slideshow-controls-inner"
      }
    >
      <button
        type="button"
        onClick={onPrev}
        disabled={disablePrevNext}
        className={BUTTON_CLASS}
        aria-label="Previous photo"
      >
        <ChevronLeft aria-hidden="true" size={15} strokeWidth={1.6} />
        Prev
      </button>
      <button
        type="button"
        onClick={onTogglePlay}
        className={BUTTON_CLASS}
        aria-pressed={playing}
      >
        {playing ? (
          <Pause aria-hidden="true" size={14} strokeWidth={1.6} />
        ) : (
          <Play aria-hidden="true" size={14} strokeWidth={1.6} />
        )}
        {playing ? "Pause" : "Play"}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={disablePrevNext}
        className={BUTTON_CLASS}
        aria-label="Next photo"
      >
        Next
        <ChevronRight aria-hidden="true" size={15} strokeWidth={1.6} />
      </button>

      <button
        type="button"
        onClick={onToggleCaptions}
        aria-pressed={showCaptions}
        className={BUTTON_CLASS}
      >
        <Captions aria-hidden="true" size={15} strokeWidth={1.6} />
        {showCaptions ? "Hide captions" : "Show captions"}
      </button>

      <button
        type="button"
        onClick={onToggleFullscreen}
        aria-pressed={isFullscreen}
        className={BUTTON_CLASS}
      >
        {isFullscreen ? (
          <Minimize2 aria-hidden="true" size={14} strokeWidth={1.6} />
        ) : (
          <Maximize2 aria-hidden="true" size={14} strokeWidth={1.6} />
        )}
        {isFullscreen ? "Exit full screen" : "Full screen"}
      </button>

      <label className="atlas-slideshow-speed">
        Speed
        <input
          type="range"
          min={minIntervalMs}
          max={maxIntervalMs}
          step={500}
          value={intervalMs}
          onChange={(event) => onIntervalChange(Number(event.target.value))}
          aria-label="Seconds per photo"
          className="accent-coral"
        />
        <span className="tabular-nums">{(intervalMs / 1000).toFixed(1)}s</span>
      </label>
    </div>
  );
}
