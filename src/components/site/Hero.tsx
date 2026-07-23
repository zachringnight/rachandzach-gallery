import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";

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
    <section className="atlas-hero">
      <div className="atlas-hero-copy">
        <div className="atlas-hero-topline">
          <BrandMark size={31} alt="0719 + co." />
          <span>Private wedding home</span>
        </div>

        <div className="atlas-hero-main">
          <p className="atlas-kicker">{siteConfig.voice.eyebrow}</p>
          <h1>
            From the coast{" "}
            <span>to the dance floor</span>
          </h1>
          <p className="atlas-hero-body">{siteConfig.voice.heroBody}</p>
          <div className="atlas-hero-actions">
            <Link href="/photos" className="atlas-primary-link">
              Find your photos
              <ArrowUpRight aria-hidden="true" size={17} strokeWidth={1.5} />
            </Link>
            <Link href="/weekend" className="atlas-secondary-link">
              Browse the weekend
              <ArrowDown aria-hidden="true" size={16} strokeWidth={1.5} />
            </Link>
          </div>
        </div>

        <div className="atlas-hero-signature">
          <span className="atlas-signature-line" aria-hidden="true" />
          <span className="atlas-hero-wordmark">
            {siteConfig.names.primary} &amp; {siteConfig.names.secondary}
          </span>
          <span>With all of our favorite people</span>
        </div>
      </div>

      <figure className="atlas-hero-image">
        <picture>
          <source
            media="(max-width: 720px)"
            srcSet="/story/hero-sunset-mobile-adobe.png"
          />
          {/* Static public derivative; next/image adds only config surface here. */}
          <img
            src={photo.src}
            alt={photo.alt}
            width={photo.width}
            height={photo.height}
            decoding="async"
            fetchPriority="high"
          />
        </picture>
        <figcaption>
          <span>01</span>
          <span>Santa Barbara, California</span>
          <span>34.4208° N · 119.6982° W</span>
        </figcaption>
      </figure>

      <div className="atlas-hero-index" aria-hidden="true">
        <span>R</span>
        <span>+</span>
        <span>Z</span>
      </div>
    </section>
  );
}
