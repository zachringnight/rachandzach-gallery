import Link from "next/link";

import { BrandMark } from "@/components/brand/BrandMark";
import { featureFlags } from "@/content/features";
import { siteConfig } from "@/content/site";

/**
 * Quiet sticky navigation. Disabled flagged items never render, not even as
 * placeholders (content rule from packet 01).
 */
export function SiteHeader() {
  const items = siteConfig.navigation.filter((item) =>
    item.enabled ? true : item.flag ? featureFlags[item.flag] : false,
  );

  return (
    <header className="atlas-site-header">
      <div className="atlas-header-inner">
        <Link
          href="/"
          className="atlas-brand-link"
        >
          <BrandMark size={20} alt="0719 + co. home" />
          <span aria-hidden="true" className="atlas-header-place">
            Santa Barbara
            <small>July 19, 2025</small>
          </span>
        </Link>
        <nav aria-label="Site" className="atlas-site-nav">
          <ul>
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="atlas-nav-link"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
