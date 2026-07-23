"use client";

import { useEffect, useState } from "react";

export interface ReelProgressProps {
  /** id of the reel container whose scroll position drives the counter. */
  containerId: string;
  /** Number of scene frames after the opening-title frame. */
  sceneCount: number;
}

/**
 * Decorative scene counter for the Keepsake Cinema comp (variant c). It
 * floats over the sticky reel and marks which frame currently holds the
 * screen, like a projectionist's reel counter.
 *
 * Scroll math instead of IntersectionObserver on purpose: pinned sticky
 * frames stay geometrically "visible" to an observer even after later frames
 * cover them, so intersection alone can never name the top frame. A
 * rAF-throttled scroll listener reading the reel's bounding rect can.
 *
 * aria-hidden and pointer-events-none: the rail duplicates nothing and
 * controls nothing; assistive tech gets the scene sections themselves.
 * Without JS it renders with every tick dim, which reads as intended.
 */
export function ReelProgress({ containerId, sceneCount }: ReelProgressProps) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const container = document.getElementById(containerId);
    if (!container) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = container.getBoundingClientRect().top;
      const viewport = window.innerHeight || 1;
      // Frames are one viewport tall each; frame 0 is the opening titles.
      const slot = Math.round(-top / viewport);
      setActive(Math.min(sceneCount, Math.max(0, slot)));
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [containerId, sceneCount]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 right-5 z-10 hidden sm:right-7 md:block"
    >
      <div className="sticky top-1/2 flex -translate-y-1/2 flex-col items-end gap-3">
        {Array.from({ length: sceneCount }, (_, index) => {
          const isActive = active === index + 1;
          return (
            <span key={index} className="flex items-center gap-2">
              <span
                className={
                  isActive
                    ? "font-body text-[0.625rem] tracking-[0.2em] text-white"
                    : "font-body text-[0.625rem] tracking-[0.2em] text-white/45"
                }
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span
                className={
                  isActive
                    ? "rzc-tick h-px w-8 bg-coral"
                    : "rzc-tick h-px w-4 bg-white/40"
                }
              />
            </span>
          );
        })}
      </div>
    </div>
  );
}
