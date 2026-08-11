import Link from "next/link";

/**
 * Guest-scoped 404. Person pages live at guessable /[name] URLs by design,
 * so a mistyped name is the expected way to arrive here. Rendering inside
 * the guest layout keeps the signed-in header and footer, and both actions
 * point forward: Find me first, the full archive second. Without this file,
 * notFound() from the personalized routes fell through to the public 404,
 * which wears the logged-out shell and has no route back to Find me.
 */
export default function GuestNotFound() {
  return (
    <section className="mx-auto max-w-2xl px-5 py-24 text-center sm:px-8">
      <p className="atlas-kicker">Private gallery</p>
      <h1 className="mt-4 font-display text-4xl leading-tight text-ink sm:text-5xl">
        Nothing is filed at this address.
      </h1>
      <p className="mt-5 font-body text-base leading-relaxed text-ink">
        A typed name has to match exactly. Your photos are still here: find
        yourself by name, or open the full archive.
      </p>
      <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          href="/my-weekend"
          className="inline-flex min-h-12 items-center justify-center rounded-[2px] bg-ink px-7 font-body text-sm font-medium text-cream hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          Find my photos
        </Link>
        <Link
          href="/photos"
          className="inline-flex min-h-12 items-center justify-center rounded-[2px] border border-ink px-7 font-body text-sm font-medium text-ink hover:bg-sand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          Browse all photos
        </Link>
      </div>
    </section>
  );
}
