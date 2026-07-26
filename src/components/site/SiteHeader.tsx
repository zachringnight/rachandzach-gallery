"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useState } from "react";

import { BrandMark } from "@/components/brand/BrandMark";
import { featureFlags } from "@/content/features";
import { siteConfig } from "@/content/site";

/**
 * Compact archive navigation with a real mobile menu. The active destination
 * is exposed to assistive technology and the menu closes after navigation.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const currentPath = pathname ?? "";
  const [menuOpen, setMenuOpen] = useState(false);
  const items = siteConfig.navigation.filter((item) =>
    item.enabled ? true : item.flag ? featureFlags[item.flag] : false,
  );

  return (
    <header className="atlas-site-header">
      <div className="atlas-header-inner">
        <Link href="/" className="atlas-brand-link" onClick={() => setMenuOpen(false)}>
          <BrandMark size={20} alt="0719 + co. home" />
          <span aria-hidden="true" className="atlas-header-place">
            <i />
            Private archive
          </span>
        </Link>

        <button
          type="button"
          className="atlas-mobile-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="site-navigation"
          aria-label={menuOpen ? "Close site menu" : "Open site menu"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span>{menuOpen ? "Close" : "Menu"}</span>
          {menuOpen ? (
            <X aria-hidden="true" size={18} strokeWidth={1.5} />
          ) : (
            <Menu aria-hidden="true" size={18} strokeWidth={1.5} />
          )}
        </button>

        <nav
          id="site-navigation"
          aria-label="Site"
          className="atlas-site-nav"
          data-open={menuOpen}
        >
          <ul>
            {items.map((item, index) => {
              const active =
                currentPath === item.href ||
                (item.href !== "/" && currentPath.startsWith(`${item.href}/`));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="atlas-nav-link"
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
