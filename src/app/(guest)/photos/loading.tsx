/**
 * Route-level loading UI for the gallery. A quiet skeleton that reserves the
 * same two-column shape as the loaded page, so the layout does not jump when
 * the server data arrives.
 */
export default function PhotosLoading() {
  return (
    <section className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <div className="max-w-2xl">
        <div className="h-3 w-24 rounded bg-wheat/70" />
        <div className="mt-3 h-9 w-40 rounded bg-wheat/70" />
        <div className="mt-4 h-4 w-full max-w-lg rounded bg-wheat/50" />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="hidden space-y-3 lg:block" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 rounded-md bg-wheat/50" />
          ))}
        </div>
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          aria-hidden="true"
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-[4/3] rounded-sm bg-wheat/50" />
          ))}
        </div>
      </div>

      <p className="sr-only" role="status">
        Loading photos…
      </p>
    </section>
  );
}
