"use client";

/**
 * TV mode's actual on-screen experience (Round Two: "/tv full-screen auto-
 * looping slideshow for gatherings"). page.tsx does all the data fetching;
 * this component only mounts the pinned Slideshow contract
 * (src/components/slideshow/Slideshow.tsx) full-bleed and immediately, with
 * nothing else added to the page beyond a quiet exit hint that fades on its
 * own.
 *
 * Deliberately thin: autoplay, the event-diverse photo order, prefers-
 * reduced-motion (start paused, controls stay visible), Escape-to-close, and
 * the Close button are ALL already Slideshow's own behavior -- see that
 * file's doc comment for the pinned SlideshowProps contract. Nothing here
 * re-implements or overrides any of it.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Slideshow } from "@/components/slideshow/Slideshow";
import type { ClientPhoto } from "@/lib/gallery/client-types";

export interface TvClientProps {
  /** Already event-diverse ordered (src/app/(guest)/tv/pool.ts's orderForTv). */
  photos: ClientPhoto[];
}

/** How long the first-frame hint stays up before it fades out on its own.
 *  The fade itself is the Tailwind `duration-1000` class below (1000ms). */
const HINT_VISIBLE_MS = 4000;

/**
 * Holds the Screen Wake Lock API for the life of the TV session, feature-
 * detected with a silent fallback (no lock, no error, no UI change) on any
 * browser that lacks it. Slideshow does not lift its internal playing state
 * to a prop (the pinned contract has no such callback), so this route has no
 * way to observe play/pause from outside; "during playback" is read as "for
 * as long as the TV route is mounted," which is the only playback signal
 * available here. Re-acquires on visibilitychange because the platform
 * force-releases the lock whenever the tab/screen goes into the background
 * -- the documented Wake Lock API gotcha (MDN).
 */
function useWakeLock(): void {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let torndown = false;

    async function acquire() {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (torndown) {
          // Unmounted (or a later visibilitychange re-request already ran)
          // while this request was in flight: cleanup already fired and
          // will never see this lock, so release it immediately instead of
          // leaking a held wake lock nobody will ever let go of.
          void lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
      } catch {
        // Denied, unsupported despite the feature check, or the document
        // went hidden mid-request. TV mode still works either way; the
        // display just risks sleeping.
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && !torndown) {
        void acquire();
      }
    }

    void acquire();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      torndown = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void sentinel?.release().catch(() => {});
    };
  }, []);
}

/** The fading "Press Esc to leave" hint; true for HINT_VISIBLE_MS after mount. */
function useHintVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), HINT_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return visible;
}

export function TvClient({ photos }: TvClientProps) {
  const router = useRouter();
  const hintVisible = useHintVisible();
  useWakeLock();

  return (
    <>
      <Slideshow
        photos={photos}
        modeLabel="TV mode"
        onClose={() => router.push("/photos")}
      />
      {/* Decorative: the real exit mechanisms are Slideshow's own Close
          button and its Escape handler, both fully reachable inside its
          dialog. This is a glance-at-the-TV-screen reminder, not the
          accessible path to close -- see this route's report for why it is
          aria-hidden rather than a live region. */}
      <p
        aria-hidden="true"
        className={`pointer-events-none fixed inset-x-0 top-4 z-[60] text-center text-xs uppercase tracking-wider text-cream/80 transition-opacity duration-1000 ease-out motion-reduce:transition-none ${
          hintVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        Press Esc to leave
      </p>
    </>
  );
}
