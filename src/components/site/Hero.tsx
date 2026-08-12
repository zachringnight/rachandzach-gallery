import Link from "next/link";
import {
  ArrowUpRight,
  CloudDownload,
  Heart,
  Search,
  Upload,
  UserRoundSearch,
} from "lucide-react";

import { siteConfig } from "@/content/site";
import { focalObjectPosition, storyPhotos } from "@/content/story-photos";

const archiveActions = [
  {
    number: "01",
    label: "Find me",
    href: "/my-weekend",
    accessibleLabel: "Find the photos you are in",
    icon: UserRoundSearch,
  },
  {
    number: "02",
    label: "Search",
    href: "/photos",
    accessibleLabel: "Search all the photos",
    icon: Search,
  },
  {
    number: "03",
    label: "Favorites",
    href: "/favorites",
    accessibleLabel: "Open your private favorites",
    icon: Heart,
  },
  {
    number: "04",
    label: "Save originals",
    href: "/photos",
    accessibleLabel: "Download or save the original photos",
    icon: CloudDownload,
  },
  {
    number: "05",
    label: "Add photos",
    href: "/add-yours",
    accessibleLabel: "Add your own photos",
    icon: Upload,
  },
] as const;

/**
 * The site's working front door: one photograph, one promise, and the five
 * actions guests return for. No event recap is required before use.
 */
export function Hero() {
  const photo = storyPhotos.hero;

  return (
    <div className="archive-hero-wrap">
      <section className="archive-hero" aria-labelledby="archive-title">
        <div className="archive-hero-copy">
          <div className="archive-hero-index" aria-hidden="true">
            <span>Santa Barbara</span>
            <span>July 19, 2025</span>
          </div>

          <div className="archive-hero-message">
            <p className="atlas-kicker">{siteConfig.voice.eyebrow}</p>
            <h1 id="archive-title">{siteConfig.voice.heroTitle}</h1>
            <p>{siteConfig.voice.heroBody}</p>
            <div className="archive-hero-actions">
              <Link href="/my-weekend" className="atlas-primary-link">
                Find my photos
                <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.5} />
              </Link>
              <Link href="/photos" className="archive-outline-link">
                Browse all photos
                <ArrowUpRight aria-hidden="true" size={15} strokeWidth={1.5} />
              </Link>
            </div>
          </div>

          <nav className="archive-radial-index" aria-label="Photo shortcuts">
            <div className="archive-radial-center" aria-hidden="true">
              <span>Start here</span>
              <strong>0719</strong>
            </div>
            <ol>
              {archiveActions.map((action) => {
                const Icon = action.icon;
                return (
                  <li key={action.number}>
                    <Link href={action.href} aria-label={action.accessibleLabel}>
                      <span>{action.number}</span>
                      <Icon aria-hidden="true" size={22} strokeWidth={1.25} />
                      <strong>{action.label}</strong>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="archive-hero-note">
            <span>Private to invited guests</span>
            <span>Yours to download</span>
          </div>
        </div>

        <figure className="archive-hero-media">
          <picture>
            <source
              media="(max-width: 720px)"
              srcSet="/story/hero-sunset-mobile-adobe.png"
            />
            {/* Static public derivative; the protected originals never leave storage. */}
            <img
              src={photo.src}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
              decoding="async"
              fetchPriority="high"
              style={{ objectPosition: focalObjectPosition(photo) }}
            />
          </picture>
          <figcaption>
            <span>Rachel &amp; Zach</span>
            <span>Santa Barbara, California</span>
          </figcaption>
        </figure>
      </section>
    </div>
  );
}
