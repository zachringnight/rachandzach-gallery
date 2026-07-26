import Link from "next/link";

import { BrandMark } from "@/components/brand/BrandMark";
import { siteConfig } from "@/content/site";

/**
 * Site footer: the archive's utility map, photographer credit, and a discreet
 * admin link. External credit links open in a new tab.
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
          <p>Private photo archive · Santa Barbara</p>
          <p className="atlas-footer-love">
            Made for the people in it.
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
