import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicShell } from "@/components/site/PublicShell";
import { MarathonSupport } from "@/components/modules/MarathonSupport";
import { featureFlags } from "@/content/features";
import { MARATHON_CONFIG } from "@/lib/modules/contracts";

export const metadata: Metadata = {
  title: "The Marathon | Rach & Zach",
  description: "Rachel's marathon story and how to support her charity run.",
};

/**
 * Public route contract (packet 11): return not found while the marathon
 * flag is off, exactly like /playlists. Even if MARATHON_CONFIG were
 * populated ahead of the flag flipping on, MarathonSupport re-checks the
 * flag itself, so this page cannot render real content early by accident.
 */
export default function MarathonPage() {
  if (!featureFlags.marathon || !MARATHON_CONFIG) {
    notFound();
  }

  return (
    <PublicShell>
      <section className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
        <header className="max-w-2xl">
          <p className="font-body text-xs uppercase tracking-wider text-muted">
            Rachel&rsquo;s run
          </p>
          <h1 className="mt-1 font-display text-4xl text-ink sm:text-5xl">
            The Marathon
          </h1>
        </header>
        <div className="mt-10">
          <MarathonSupport marathon={MARATHON_CONFIG} />
        </div>
      </section>
    </PublicShell>
  );
}
