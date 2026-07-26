import type { Metadata } from "next";
import { FavoritesGallery } from "@/components/favorites/FavoritesGallery";

/**
 * /favorites (packet 09; persistence updated by Favorites v2). Favorites are
 * local-first (FavoriteStore in src/lib/favorites/store.ts) with background
 * server sync (src/lib/favorites/sync.ts) keyed to the anonymous session or
 * the claimed My Weekend person. This page still renders no server-fetched
 * photo data itself, just the shell around the client component that reads
 * the guest's favorite ids and looks them up. Access is enforced by
 * src/app/(guest)/layout.tsx, which wraps every route in this group.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Favorites | Rach & Zach",
  description: "Your private shortlist of favorite photographs.",
};

export default function FavoritesPage() {
  return (
    <section className="atlas-guest-page">
      <header className="atlas-guest-header">
        <div>
          <p className="atlas-kicker">Private shortlist</p>
          <h1>Favorites</h1>
        </div>
        <p>
          Keep the photographs you want in one place. Play them as a slideshow,
          download the whole set, save it to your cloud account, or export a
          shortlist for a printed album.
        </p>
        <span aria-hidden="true">Keep · Save · Print</span>
      </header>
      <div className="atlas-guest-body">
        <FavoritesGallery />
      </div>
    </section>
  );
}
