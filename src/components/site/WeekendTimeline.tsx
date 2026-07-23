import type { WeekendEventContent } from "@/content/site";

/**
 * The weekend at a glance: every event with its date, time, venue, and
 * address, rendered as a typographic list rather than a card grid. Facts come
 * straight from site content; this component invents nothing.
 */
export function WeekendTimeline({ events }: { events: WeekendEventContent[] }) {
  return (
    <ol className="mx-auto max-w-3xl divide-y divide-wheat px-5 sm:px-8">
      {events.map((event) => (
        <li key={event.id} className="py-8">
          <article aria-labelledby={`timeline-${event.id}`}>
            <p className="font-body text-xs uppercase tracking-[0.2em] text-muted">
              {event.dateLabel}
              {event.timeLabel ? ` · ${event.timeLabel}` : ""}
            </p>
            <h3
              id={`timeline-${event.id}`}
              className="mt-2 font-display text-2xl text-ink"
            >
              {event.title}
            </h3>
            <p className="mt-1 font-body text-sm font-medium text-ink">
              {event.venue}
              {event.addressLines ? (
                <span className="font-normal text-muted"> · {event.addressLines.join(", ")}</span>
              ) : null}
            </p>
            <p className="mt-3 font-body text-base leading-relaxed text-ink">
              {event.description}
            </p>
          </article>
        </li>
      ))}
    </ol>
  );
}
