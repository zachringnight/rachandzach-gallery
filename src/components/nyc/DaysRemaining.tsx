"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Live "N days left" figure, computed in the viewer's browser.
 *
 * WHY THIS IS A CLIENT COMPONENT
 * /nyc declares no `dynamic` or `revalidate` export and touches no
 * request-scoped API, so Next statically prerenders it at build time. A
 * countdown computed on the server would therefore be frozen at the moment of
 * the build and would go on confidently displaying a stale number for as long
 * as the deployment lives. Adding `revalidate` would only shrink that window,
 * not close it, and would give up the page's full static cacheability to do
 * it. Computing in the browser is always correct for whoever is looking,
 * costs nothing at build, and keeps the route static.
 *
 * WHY IT RENDERS NOTHING ON THE FIRST PAINT
 * The server has no idea what day it is for the viewer, so it renders nothing
 * and the real figure appears after mount. That avoids a hydration mismatch
 * without `suppressHydrationWarning`. The surrounding markup always states the
 * absolute deadline date, which is correct with or without JavaScript, so this
 * component is a live enhancement and never the only source of the fact.
 *
 * Only absolute dates are ever stored (see nycFundraisingDeadline in
 * src/content/nyc.ts). Nothing anywhere persists a day count.
 */

export interface DaysRemainingProps {
  /** Absolute target date, YYYY-MM-DD. */
  iso: string;
  /** Shown once the date has passed, e.g. "Fundraising has closed". */
  closedLabel: string;
  className?: string;
}

/**
 * Whole days from today to `iso`, both taken as local calendar dates so the
 * answer matches what the viewer would say looking at a wall calendar.
 * Midnight-to-midnight differences are exact multiples of a day except across
 * a DST boundary, where the total is off by an hour; rounding absorbs that.
 * Returns null for an unparseable date so the caller can render nothing
 * rather than "NaN days left".
 */
export function daysUntil(iso: string, now: Date = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const target = new Date(year, month - 1, day);
  // Guard against overflow dates like 2026-02-31, which Date silently rolls
  // forward into March rather than rejecting.
  if (
    target.getFullYear() !== year ||
    target.getMonth() !== month - 1 ||
    target.getDate() !== day
  ) {
    return null;
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Every terminal state spelled out, so the math can never produce nonsense. */
export function remainingLabel(
  days: number | null,
  closedLabel: string,
): string | null {
  if (days === null) return null;
  if (days < 0) return closedLabel;
  if (days === 0) return "Last day";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

/**
 * The clock is an external system that never notifies us, so there is nothing
 * to subscribe to. Module scope keeps the identity stable across renders.
 */
const subscribeToNothing = () => () => {};

export function DaysRemaining({
  iso,
  closedLabel,
  className,
}: DaysRemainingProps) {
  /*
   * useSyncExternalStore rather than useEffect + setState, matching
   * Reveal.tsx and Slideshow.tsx in this repo. getServerSnapshot returns null,
   * so the server and the pre-hydration client render agree on "nothing";
   * React then re-reads getSnapshot after hydration and the real figure
   * appears. No hydration warning, no cascading render, no setState in an
   * effect. getSnapshot returns a primitive that is equal by value on repeat
   * calls, so it cannot loop.
   */
  const label = useSyncExternalStore(
    subscribeToNothing,
    useCallback(
      () => remainingLabel(daysUntil(iso), closedLabel),
      [iso, closedLabel],
    ),
    () => null,
  );

  if (!label) return null;
  return <span className={className}>{label}</span>;
}
