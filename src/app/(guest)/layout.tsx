import type { Metadata } from "next";
import { ScrollProgress } from "@/components/site/ScrollProgress";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";

/**
 * Shared shell for the archive routes (photos, my-weekend, add-yours).
 *
 * These were the guest-only routes until the password gate was removed
 * (2026-08-09); they are now open to anyone with the URL, and this layout no
 * longer checks anything. `robots: index: false` below stays deliberately:
 * open to a visitor who has the link is not the same as listed in a search
 * index, and the archive is still not meant to be findable.
 *
 * Packet 08 (Add Yours) renders inside this shell and must not recreate it.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Private Gallery | Rach & Zach",
  robots: { index: false, follow: false },
};

export default async function GuestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="atlas-shell min-h-screen bg-cream font-body text-ink">
      <a
        href="#gallery-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:bg-ink focus:px-4 focus:py-2 focus:text-cream"
      >
        Skip to content
      </a>
      <ScrollProgress />
      <SiteHeader />
      <main id="gallery-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
