import type { WeekendEventContent } from "@/content/site";

/**
 * The weekend at a glance: every event with its date, time, venue, and
 * address, rendered as a typographic list rather than a card grid. Facts come
 * straight from site content; this component invents nothing.
 */
export function WeekendTimeline({ events }: { events: WeekendEventContent[] }) {
  return (
    <ol className="atlas-weekend-timeline">
      {events.map((event, index) => (
        <li key={event.id}>
          <article aria-labelledby={`timeline-${event.id}`}>
            <div className="atlas-timeline-date">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{event.dateLabel}</p>
            </div>
            <div className="atlas-timeline-main">
              <p>{event.timeLabel}</p>
              <h3 id={`timeline-${event.id}`}>{event.title}</h3>
            </div>
            <div className="atlas-timeline-place">
              <p>{event.venue}</p>
              {event.addressLines ? <span>{event.addressLines.join(", ")}</span> : null}
            </div>
            <p className="atlas-timeline-description">{event.description}</p>
          </article>
        </li>
      ))}
    </ol>
  );
}
