import { featureFlags } from "@/content/features";
import type { PlaylistConfig } from "@/lib/modules/contracts";

export interface PlaylistChapterProps {
  playlist: PlaylistConfig;
}

/**
 * One Spotify-linked playlist chapter. Gated on the playlists flag so this
 * component renders nothing at all if it is ever reached while the flag is
 * off (defense in depth beyond the page's own notFound() gate). Links out to
 * Spotify rather than embedding an iframe, which keeps "avoid autoplay"
 * trivially true and avoids reproducing any Spotify content locally.
 */
export function PlaylistChapter({ playlist }: PlaylistChapterProps) {
  if (!featureFlags.playlists) return null;

  return (
    <article className="rounded-card border border-wheat bg-white p-6 shadow-soft">
      <h3 className="font-display text-xl text-ink">{playlist.title}</h3>
      {playlist.eventSlug ? (
        <p className="mt-1 text-xs uppercase tracking-wide text-muted">
          {playlist.eventSlug}
        </p>
      ) : null}
      <p className="mt-2 font-body text-sm leading-relaxed text-muted">
        {playlist.description}
      </p>
      <a
        href={playlist.spotifyUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center gap-1.5 font-body text-sm font-medium text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
      >
        Listen on Spotify
        <span aria-hidden="true">&rarr;</span>
      </a>
    </article>
  );
}
