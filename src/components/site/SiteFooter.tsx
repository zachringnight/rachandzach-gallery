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
    <footer className="atlas-footer">
      <div className="atlas-footer-grid">
        <div className="atlas-footer-signoff">
          {/* Decorative: the names right below carry the same information. */}
          <span aria-hidden="true">
            <BrandMark size={28} alt="" className="opacity-80" />
          </span>
          <p className="atlas-footer-names">
            {siteConfig.names.primary} &amp; {siteConfig.names.secondary}
          </p>
          <p>July 19, 2025 · Santa Barbara, CA</p>
          <p className="atlas-footer-love">
            Made with love for the people we love.
          </p>
        </div>

        <nav aria-label="Footer" className="atlas-footer-nav">
          {siteConfig.navigation
            .filter((item) => item.enabled)
            .map((item, index) => (
              <Link key={item.href} href={item.href}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item.label}
              </Link>
            ))}
        </nav>

        <div className="atlas-footer-credit">
          <p>
            Photography by{" "}
            {photographer.websiteUrl ? (
              <Link
                href={photographer.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
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
                >
                  Instagram
                </Link>
              </>
            )}
          </p>
          <Link href="/admin">Admin</Link>
        </div>
      </div>
    </footer>
  );
}
