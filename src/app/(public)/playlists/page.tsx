import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicShell } from "@/components/site/PublicShell";
import { PlaylistChapter } from "@/components/modules/PlaylistChapter";
import { featureFlags } from "@/content/features";
import { PLAYLIST_CHAPTERS } from "@/lib/modules/contracts";

export const metadata: Metadata = {
  title: "Playlists | Rach & Zach",
  description: "The weekend's soundtrack, chapter by chapter.",
};

/**
 * Public route contract (packet 11): return not found while the playlists
 * flag is off. The flag is the only gate this page has ever had, and a
 * disabled flag must behave like the route does not exist -- never a
 * placeholder "coming soon" page.
 */
export default function PlaylistsPage() {
  if (!featureFlags.playlists) {
    notFound();
  }

  return (
    <PublicShell>
      <section className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
        <header className="max-w-2xl">
          <p className="font-body text-xs uppercase tracking-wider text-muted">
            The soundtrack
          </p>
          <h1 className="mt-1 font-display text-4xl text-ink sm:text-5xl">
            Playlists
          </h1>
        </header>
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {PLAYLIST_CHAPTERS.map((playlist) => (
            <PlaylistChapter key={playlist.spotifyUrl} playlist={playlist} />
          ))}
        </div>
      </section>
    </PublicShell>
  );
}
