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
    <header className="sticky top-0 z-20 border-b border-wheat bg-cream">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3 sm:px-8">
        <Link
          href="/"
          className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <BrandMark size={22} alt="0719 + co. home" />
        </Link>
        <nav aria-label="Site">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="font-body text-sm tracking-wide text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
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
