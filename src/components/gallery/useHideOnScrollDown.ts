"use client";

import { useEffect, useRef, useState } from "react";

/**
 * True while the guest is actively scrolling down the page, with hysteresis
 * so the value does not flap at row boundaries. Drives the phone-width
 * behavior of the sticky gallery chrome (chapter strip and Light Bar): on a
 * 667px viewport that chrome plus the header costs about a quarter of the
 * screen, so it steps aside while the guest is heading down into the
 * photographs and returns on the first gesture back up.
 *
 * The value is direction, not viewport width: CSS scopes what actually hides
 * to the sub-720px layout, so desktop renders identically whatever this
 * reports.
 */
export function useHideOnScrollDown(activationOffset = 160): boolean {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const upTravel = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      if (frame.current) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = 0;
        const y = window.scrollY;
        const delta = y - lastY.current;
        lastY.current = y;
        if (y <= activationOffset) {
          upTravel.current = 0;
          setHidden(false);
          return;
        }
        if (delta > 0) {
          upTravel.current = 0;
          setHidden(true);
        } else if (delta < 0) {
          // 24px of upward travel before the chrome returns: a rubber-band
          // bounce or a one-pixel wobble mid-fling should not summon it.
          upTravel.current -= delta;
          if (upTravel.current >= 24) setHidden(false);
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame.current) window.cancelAnimationFrame(frame.current);
    };
  }, [activationOffset]);

  return hidden;
}
