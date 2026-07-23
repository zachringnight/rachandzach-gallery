"use client";

export interface DownloadOriginalButtonProps {
  photoId: string;
  /** Visible label. Defaults to "Download original". */
  children?: React.ReactNode;
  className?: string;
  anchorRef?: React.Ref<HTMLAnchorElement>;
}

const DEFAULT_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-cream/30 bg-cream/10 px-3 py-1.5 text-sm text-cream transition hover:bg-cream/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream";

/**
 * A plain link to GET /api/downloads/photo/[photoId] (packet 09), which
 * itself redirects to a short-lived signed original URL. This is
 * deliberately a real <a href>, not a click handler that fetches JSON: the
 * browser follows the redirect and downloads directly from Supabase
 * Storage, so the original bytes never transit Vercel and the download
 * works even before any client JS has hydrated.
 */
export function DownloadOriginalButton({
  photoId,
  children,
  className,
  anchorRef,
}: DownloadOriginalButtonProps) {
  return (
    <a
      ref={anchorRef}
      href={`/api/downloads/photo/${encodeURIComponent(photoId)}`}
      className={className ?? DEFAULT_CLASS}
    >
      {children ?? "Download original"}
    </a>
  );
}
