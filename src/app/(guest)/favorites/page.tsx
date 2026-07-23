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
  description: "Your favorite photos from the wedding weekend.",
};

export default function FavoritesPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 pt-8 pb-16 sm:px-6">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-wider text-muted">Your collection</p>
        <h1 className="mt-1 font-display text-3xl text-ink sm:text-4xl">Favorites</h1>
        <p className="mt-3 text-ink/70">
          Every photo you have hearted, all in one place. Favorites are saved on this device
          and follow you: tell us who you are on My Weekend and they sync to your name. Play
          them as a slideshow, download the whole set as one file, or export a shortlist to
          help plan a printed album.
        </p>
      </header>
      <FavoritesGallery />
    </section>
  );
}
