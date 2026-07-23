import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { ScrollProgress } from "@/components/site/ScrollProgress";

/**
 * Shared frame for the public pages: skip link, quiet sticky header, cream
 * canvas, footer, and the site's only motion rules.
 *
 * Motion policy (packet 05): subtle image reveals and marquee drift only,
 * both removed entirely under prefers-reduced-motion.
 */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="atlas-shell min-h-screen bg-cream font-body text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:bg-ink focus:px-4 focus:py-2 focus:text-cream"
      >
        Skip to content
      </a>
      <ScrollProgress />
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}
