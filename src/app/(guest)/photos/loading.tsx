/**
 * Route-level loading UI for the gallery. A quiet skeleton that reserves the
 * compact page-bar + control-bar + full-width grid shape of the loaded page,
 * so the layout does not jump when the server data arrives.
 */
export default function PhotosLoading() {
  return (
    <section className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <div className="flex items-baseline gap-4">
        <div className="h-9 w-44 rounded bg-wheat/70" />
        <div className="h-3 w-28 rounded bg-wheat/50" />
      </div>

      <div className="mt-5 flex items-center gap-3 border-y border-wheat/70 py-3">
        <div className="h-9 w-64 rounded bg-wheat/50" />
        <div className="ml-auto flex gap-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 w-20 rounded bg-wheat/50" />
          ))}
        </div>
      </div>

      <div
        className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        aria-hidden="true"
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="aspect-[4/3] rounded-sm bg-wheat/50" />
        ))}
      </div>

      <p className="sr-only" role="status">
        Loading photos…
      </p>
    </section>
  );
}
