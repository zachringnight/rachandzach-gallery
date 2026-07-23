import Link from "next/link";

import { PublicShell } from "@/components/site/PublicShell";

/**
 * 404 in the site's own voice (copy carried over from the original site's
 * spec). Note for Integrate/packet 12: Next.js only serves a not-found file
 * from the root app segment for unmatched URLs, so this file may need to move
 * (or be re-exported) to src/app/not-found.tsx once route ownership settles.
 * The packet contract places it here.
 */
export default function NotFound() {
  return (
    <PublicShell>
      <section className="mx-auto max-w-2xl px-5 py-24 text-center sm:px-8">
        <h1 className="font-display text-4xl leading-tight text-ink sm:text-5xl">
          This page wandered off to the Funk Zone.
        </h1>
        <p className="mt-5 font-body text-base leading-relaxed text-ink">
          Let&apos;s get you back to the party.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-7 font-body text-sm font-medium text-cream hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            Go Home
          </Link>
          <Link
            href="/weekend"
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-ink px-7 font-body text-sm font-medium text-ink hover:bg-sand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            Browse the weekend
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
