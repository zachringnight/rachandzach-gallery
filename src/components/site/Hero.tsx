import Link from "next/link";

import { BrandMark } from "@/components/brand/BrandMark";
import { siteConfig } from "@/content/site";
import { storyPhotos } from "@/content/story-photos";

/**
 * Home hero: the 0719 + co. mark, one full-bleed wedding image, the
 * coast-to-dance-floor line, and the two primary actions.
 *
 * The text sits on cream below the photograph instead of overlaying it, so
 * contrast never depends on the image and the packet's no-gradient rule
 * holds.
 */
export function Hero() {
  const photo = storyPhotos.hero;
  return (
    <section>
      <div className="relative w-full overflow-hidden bg-sand">
        {/* Static public derivative; next/image adds only config surface here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.src}
          alt={photo.alt}
          width={photo.width}
          height={photo.height}
          decoding="async"
          fetchPriority="high"
          className="rz-reveal h-[52vh] min-h-[320px] w-full object-cover sm:h-[68vh]"
        />
      </div>
      <div className="mx-auto max-w-3xl px-5 py-14 text-center sm:px-8 sm:py-20">
        <BrandMark
          size={40}
          alt="0719 + co."
          className="mx-auto"
        />
        <p className="mt-8 font-body text-sm uppercase tracking-[0.2em] text-muted">
          {siteConfig.voice.eyebrow}
        </p>
        <h1 className="mt-4 font-display text-4xl leading-tight text-ink sm:text-6xl">
          From the coast to the dance floor
        </h1>
        <p className="mx-auto mt-6 max-w-xl font-body text-base leading-relaxed text-ink sm:text-lg">
          {siteConfig.voice.heroBody}
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/photos"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-7 font-body text-sm font-medium text-cream hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            Find your photos
          </Link>
          <Link
            href="/weekend"
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-ink px-7 font-body text-sm font-medium text-ink hover:bg-sand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            Browse the weekend
          </Link>
        </div>
      </div>
    </section>
  );
}
