/**
 * Route-level loading UI for /tv. Slideshow renders bg-ink/text-cream
 * full-bleed once it mounts; this mirrors that palette (rather than the
 * light cream page background every other guest route loads against) so
 * opening TV mode never flashes bright before the ambient screen appears.
 */
export default function TvLoading() {
  return (
    <div
      role="status"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink text-cream"
    >
      <p className="text-xs uppercase tracking-wider text-cream/70">
        Gathering the weekend&hellip;
      </p>
    </div>
  );
}
