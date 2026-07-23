import Link from "next/link";

import { BrandMark } from "@/components/brand/BrandMark";
import { siteConfig } from "@/content/site";

/**
 * Site footer: names, date, place, photographer credit, and a discreet admin
 * link. Photographer name, Instagram, and website are confirmed
 * (siteConfig.photographer); both credit links open in a new tab since they
 * leave the site.
 */
export function SiteFooter() {
  const { photographer } = siteConfig;
  return (
    <footer className="border-t border-wheat bg-sand">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-12 sm:px-8 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          {/* Decorative: the names right below carry the same information. */}
          <span aria-hidden="true">
            <BrandMark size={28} alt="" className="opacity-80" />
          </span>
          <p className="font-display text-2xl text-ink">
            {siteConfig.names.primary} &amp; {siteConfig.names.secondary}
          </p>
          {/* Ink, not muted, on the sand footer surface: muted (#6B645A) on
              sand (#E8DBC2) is ~4.05:1 and fails WCAG AA for small text, a
              real finding from the packet 12 accessibility scan. Size and
              italics keep the hierarchy soft; ink keeps it readable. */}
          <p className="font-body text-sm text-ink">
            July 19, 2025 · Santa Barbara, CA
          </p>
          <p className="font-body text-sm italic text-ink">
            Made with love for the people we love.
          </p>
          <p className="font-body text-xs text-ink">
            Photography by{" "}
            {photographer.websiteUrl ? (
              <Link
                href={photographer.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
              >
                {photographer.name}
              </Link>
            ) : (
              photographer.name
            )}
            {photographer.instagramUrl && (
              <>
                {" "}
                ·{" "}
                <Link
                  href={photographer.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
                >
                  Instagram
                </Link>
              </>
            )}
          </p>
        </div>
        <nav aria-label="Footer" className="font-body text-xs text-ink">
          <Link
            href="/admin"
            className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            Admin
          </Link>
        </nav>
      </div>
    </footer>
  );
}
