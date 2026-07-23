import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";

/**
 * Shared frame for the public pages: skip link, quiet sticky header, cream
 * canvas, footer, and the site's only motion rules.
 *
 * Motion policy (packet 05): subtle image reveals and marquee drift only,
 * both removed entirely under prefers-reduced-motion.
 */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream font-body text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-ink focus:px-4 focus:py-2 focus:text-cream"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
      {/* Keyframes for the site's two allowed motions. Scoped here so every
          public page shares one definition. */}
      <style>{`
        @keyframes rz-reveal {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes rz-drift {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .rz-reveal { animation: rz-reveal 700ms ease-out both; }
        .rz-marquee-track {
          display: flex;
          gap: 1rem;
          width: max-content;
          animation: rz-drift 80s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .rz-reveal { animation: none; }
          .rz-marquee-track { animation: none; }
        }
      `}</style>
    </div>
  );
}
