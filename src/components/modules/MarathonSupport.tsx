import { featureFlags } from "@/content/features";
import type { MarathonConfig } from "@/lib/modules/contracts";

export interface MarathonSupportProps {
  marathon: MarathonConfig;
}

const GOAL_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Rachel's marathon story, charity, and a donation action. Gated on the
 * marathon flag (defense in depth beyond the page's own notFound() gate).
 *
 * Progress is rendered ONLY as the static goal figure Zach supplies, never a
 * computed or fetched percent-complete bar: MarathonConfig has no "amount
 * raised" field, by design (the packet forbids scraping donation totals), so
 * there is no honest numerator to show progress toward the goal with. This
 * is "explicit structured data," never implied live progress.
 */
export function MarathonSupport({ marathon }: MarathonSupportProps) {
  if (!featureFlags.marathon) return null;

  const showGoal = marathon.displayProgress && marathon.goalAmount !== null;

  return (
    <section
      aria-labelledby="marathon-support-title"
      className="rounded-card border border-wheat bg-white p-6 shadow-soft"
    >
      <p className="text-xs uppercase tracking-wide text-muted">
        {marathon.charityName}
      </p>
      <h2 id="marathon-support-title" className="mt-1 font-display text-2xl text-ink">
        {marathon.raceName}
      </h2>
      <p className="mt-3 font-body text-sm leading-relaxed text-muted">
        {marathon.story}
      </p>
      {showGoal ? (
        <p className="mt-3 font-body text-sm text-ink">
          {marathon.runnerName}&rsquo;s goal: {GOAL_FORMATTER.format(marathon.goalAmount as number)}{" "}
          for {marathon.charityName}.
        </p>
      ) : null}
      <a
        href={marathon.donationUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center gap-1.5 font-body text-sm font-medium text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
      >
        Support {marathon.runnerName}
        <span aria-hidden="true">&rarr;</span>
      </a>
    </section>
  );
}
