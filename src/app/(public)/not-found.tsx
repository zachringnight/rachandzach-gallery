import Link from "next/link";

import { PublicShell } from "@/components/site/PublicShell";

/** A quiet route back into the working archive. */
export default function NotFound() {
  return (
    <PublicShell>
      <section className="mx-auto max-w-2xl px-5 py-24 text-center sm:px-8">
        <h1 className="font-display text-4xl leading-tight text-ink sm:text-5xl">
          This page is out of frame.
        </h1>
        <p className="mt-5 font-body text-base leading-relaxed text-ink">
          Return to the archive home or open the photos.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex min-h-12 items-center justify-center rounded-[2px] bg-ink px-7 font-body text-sm font-medium text-cream hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            Archive home
          </Link>
          <Link
            href="/photos"
            className="inline-flex min-h-12 items-center justify-center rounded-[2px] border border-ink px-7 font-body text-sm font-medium text-ink hover:bg-sand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            Open photos
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
