import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { CSSProperties } from "react";

import { DaysRemaining, UpdatedAgo } from "@/components/nyc/DaysRemaining";
import {
  fundraiserProgressPercent,
  fundraiserRawPercent,
  fundraiserRemaining,
  nycFundraiser,
  nycFundraisingDeadline,
} from "@/content/nyc";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * The fundraising total, as a dated snapshot rather than a live widget.
 *
 * Two percentages, on purpose: the bar's fill is clamped to 100 so it can
 * never overflow its track, while the headline figure is uncapped so passing
 * the goal reads as "118%" instead of being flattened. Both are computed from
 * `raised` and `goal`; neither is ever hardcoded.
 *
 * No third-party fundraising widget is used here, and none could be: the
 * site's CSP is script-src 'self' / frame-src 'none' (see
 * src/lib/auth/security-headers.ts), which rules out NYRR's or anyone else's
 * embeddable thermometer just as it rules out Instagram's embed script.
 */
export function FundraiserProgress() {
  const { progress } = nycFundraiser;
  const barPercent = fundraiserProgressPercent(progress.raised, progress.goal);
  const shownPercent = fundraiserRawPercent(progress.raised, progress.goal);
  const remaining = fundraiserRemaining(progress.raised, progress.goal);
  const goalMet = remaining === 0;

  return (
    <>
      <div className="atlas-nyc-progress-heading">
        <span>Raised so far</span>
        <strong>{shownPercent}%</strong>
      </div>
      <div
        className="atlas-nyc-progress-track"
        role="progressbar"
        aria-label="Fundraising progress"
        aria-valuemin={0}
        aria-valuemax={progress.goal}
        // Clamped: aria-valuenow must stay within min/max even after she
        // passes the goal. The exact figures live in aria-valuetext.
        aria-valuenow={Math.min(progress.raised, progress.goal)}
        aria-valuetext={`${usd.format(progress.raised)} raised of ${usd.format(progress.goal)}`}
      >
        <span style={{ "--atlas-progress": `${barPercent}%` } as CSSProperties} />
      </div>
      <div className="atlas-nyc-progress-numbers">
        <p>
          <strong>{usd.format(progress.raised)}</strong>
          <span>raised</span>
        </p>
        <p>
          <strong>{usd.format(progress.goal)}</strong>
          <span>goal</span>
        </p>
      </div>

      <p className="atlas-nyc-progress-human">
        {goalMet
          ? `Goal met, and every dollar past it still goes to ${nycFundraiser.charityName}.`
          : `${usd.format(remaining)} to go.`}{" "}
        <span>
          {progress.supporters} people have already chipped in.
        </span>
      </p>

      <p className="atlas-nyc-progress-deadline">
        <span>
          Donations close{" "}
          <time dateTime={nycFundraisingDeadline.iso}>
            {nycFundraisingDeadline.label}
          </time>
          , before she runs.
        </span>
        {/* Live figure, computed in the browser. The absolute date above is
            the source of truth and renders with or without JavaScript. */}
        <DaysRemaining
          iso={nycFundraisingDeadline.iso}
          closedLabel="Fundraising has closed"
          className="atlas-nyc-countdown"
        />
      </p>

      {/*
       * The sentence is ONE flex item, not four.
       *
       * .atlas-nyc-progress-note is a flex row, so every bare text node
       * around the <time> element became its own flex item and wrapped
       * independently. With a short date ("July 27, 2026") they happened to
       * fit on one line and it looked fine; "August 11, 2026" pushed it over
       * and stranded ", entered by hand." alone on the next line with the
       * comma leading. Wrapping the prose in a span makes it a single item
       * that wraps as prose, and leaves the link as the one thing the
       * space-between pushes to the right.
       */}
      <p className="atlas-nyc-progress-note">
        <span>
          Totals as of{" "}
          <time dateTime={progress.asOfISO}>{progress.asOf}</time>, entered by
          hand.{" "}
          {/* Renders nothing while the figures are fresh; see UpdatedAgo. */}
          <UpdatedAgo iso={progress.asOfISO} className="atlas-nyc-stale" />
        </span>
        <Link
          href={nycFundraiser.fundraiserUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          See her fundraiser page
          <ArrowUpRight aria-hidden="true" size={12} />
        </Link>
      </p>
    </>
  );
}
