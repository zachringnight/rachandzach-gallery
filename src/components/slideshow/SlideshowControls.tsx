"use client";

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
  "inline-flex items-center gap-1.5 rounded-md border border-cream/25 bg-cream/10 px-3 py-1.5 text-sm text-cream transition hover:bg-cream/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream disabled:cursor-not-allowed disabled:opacity-40";

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
        "flex flex-wrap items-center justify-center gap-2 border-t border-cream/10 p-3"
      }
    >
      <button
        type="button"
        onClick={onPrev}
        disabled={disablePrevNext}
        className={BUTTON_CLASS}
        aria-label="Previous photo"
      >
        &lsaquo; Prev
      </button>
      <button
        type="button"
        onClick={onTogglePlay}
        className={BUTTON_CLASS}
        aria-pressed={playing}
      >
        {playing ? "Pause" : "Play"}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={disablePrevNext}
        className={BUTTON_CLASS}
        aria-label="Next photo"
      >
        Next &rsaquo;
      </button>

      <button
        type="button"
        onClick={onToggleCaptions}
        aria-pressed={showCaptions}
        className={BUTTON_CLASS}
      >
        {showCaptions ? "Hide captions" : "Show captions"}
      </button>

      <button
        type="button"
        onClick={onToggleFullscreen}
        aria-pressed={isFullscreen}
        className={BUTTON_CLASS}
      >
        {isFullscreen ? "Exit full screen" : "Full screen"}
      </button>

      <label className="flex items-center gap-2 text-xs text-cream/80">
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
