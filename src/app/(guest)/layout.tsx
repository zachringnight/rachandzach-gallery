import { redirect } from "next/navigation";
import {
  GalleryAccessError,
  requireGalleryAccess,
} from "@/lib/auth/guest-session";
import { SiteHeader } from "@/components/site/SiteHeader";

/**
 * Shared shell for every guest-only route (photos, my-weekend, add-yours).
 *
 * Fails closed: the proxy already gates navigation, but this re-checks the
 * guest session server-side (the platform spike warns proxy matchers can
 * silently skip server functions). A missing/expired session redirects to the
 * access screen; a missing SECRET (GalleryAccessConfigError) propagates as a
 * 500 rather than opening the door.
 *
 * Packet 08 (Add Yours) renders inside this shell and must not recreate it.
 */
export const dynamic = "force-dynamic";

export default async function GuestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireGalleryAccess();
  } catch (error) {
    if (error instanceof GalleryAccessError) {
      // Fallback only: src/proxy.ts normally intercepts unauthenticated page
      // requests first with a per-path next= redirect. A layout cannot know
      // the requested path server-side, so never guess one here; a neutral
      // /enter lands the guest on the public home after sign-in.
      redirect("/enter");
    }
    throw error;
  }

  return (
    <div className="min-h-screen bg-cream font-body text-ink">
      <a
        href="#gallery-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-ink focus:px-4 focus:py-2 focus:text-cream"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="gallery-main">{children}</main>
    </div>
  );
}
