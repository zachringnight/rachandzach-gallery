import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Reveal } from "@/components/motion/Reveal";

/**
 * The browse landing: what /photos renders when a guest arrives with NO
 * filter, no ?photo=, and no ?all=1.
 *
 * The archive is 1,721 photographs. Dropping all of them into one grid on
 * arrival is technically complete and experientially a slog, so this screen
 * asks one question instead -- how do you want in? -- and answers it with
 * three doors: a chapter (an event), a person (Find me), or the whole thing.
 * The filtered grid behind those doors is unchanged; GalleryShell still owns
 * every URL that carries a filter.
 *
 * PRESENTATION ONLY. Everything private is resolved by the authenticated
 * server component that renders this: cover previews arrive pre-signed, and
 * faces arrive as URLs plus crop geometry. This module must never import the
 * face manifest or any person data itself -- see the long note in
 * PersonPicker.tsx about that leaking the guest list into an unauthenticated
 * static chunk. It is also why the face strip carries no names and no
 * per-person counts: it is decoration pointing at /my-weekend, not a roster.
 */

export interface BrowseCover {
  /** Signed preview URL for the card's default width. */
  src: string;
  /** Signed candidates as a srcset string ("url 480w, url 960w"). */
  srcSet: string;
  width: number;
  height: number;
}

export interface BrowseEvent {
  slug: string;
  name: string;
  /** Published photos in this chapter. Per-EVENT counts are fine to show. */
  count: number;
  cover: BrowseCover | null;
}

export interface BrowseFace {
  /** Stable key. Never rendered as text. */
  key: string;
  src: string;
  /**
   * Absolute-positioned CSS crop for a hand-picked face (see faceCropCss).
   * Absent for the committed square crops, which need no positioning.
   */
  crop?: CSSProperties;
}

export interface BrowseLandingProps {
  totalPhotos: number;
  /** Weekend order, as the facets return them. */
  events: BrowseEvent[];
  faces: BrowseFace[];
  /** How many guests are tagged. A roster size, not a per-person count. */
  taggedPeople: number;
}

/** Card sizes track the event grid's column count (see globals.css). */
const COVER_SIZES =
  "(max-width: 639px) 46vw, (max-width: 979px) 31vw, (max-width: 1399px) 23vw, 18vw";

export function BrowseLanding({
  totalPhotos,
  events,
  faces,
  taggedPeople,
}: BrowseLandingProps) {
  return (
    <div className="atlas-browse">
      <nav className="atlas-browse-doors" aria-label="Ways into the archive">
        <Link
          href="/my-weekend"
          className="atlas-browse-door atlas-browse-door-people"
        >
          <span className="atlas-browse-door-head">
            <span className="atlas-kicker">By person</span>
            <span className="atlas-browse-door-index" aria-hidden="true">
              01
            </span>
          </span>
          <span className="atlas-browse-door-title">
            Find the ones you are in.
          </span>
          <span className="atlas-browse-door-body">
            Choose your name once and your own collection opens. The choice
            stays private on this device.
          </span>
          {faces.length > 0 ? (
            <span className="atlas-browse-faces" aria-hidden="true">
              {faces.map((face) => (
                <span
                  key={face.key}
                  className="atlas-browse-face"
                  data-crop={face.crop ? "true" : "false"}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={face.src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    style={face.crop}
                  />
                </span>
              ))}
            </span>
          ) : null}
          {taggedPeople > 0 ? (
            <span className="atlas-browse-door-meta">
              {taggedPeople.toLocaleString()} guests tagged
            </span>
          ) : null}
          <span className="atlas-browse-door-cta">
            Find me
            <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.5} />
          </span>
        </Link>

        <Link href="/photos?all=1" className="atlas-browse-door">
          <span className="atlas-browse-door-head">
            <span className="atlas-kicker">Everything</span>
            <span className="atlas-browse-door-index" aria-hidden="true">
              02
            </span>
          </span>
          <span className="atlas-browse-door-title">
            Or open all {totalPhotos.toLocaleString()}.
          </span>
          <span className="atlas-browse-door-body">
            The whole archive in one grid, with search, filters, favorites,
            and original downloads. It is a long scroll on purpose.
          </span>
          <span className="atlas-browse-door-meta">
            Photographer and guest photos
          </span>
          <span className="atlas-browse-door-cta">
            See everything
            <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.5} />
          </span>
        </Link>
      </nav>

      {events.length > 0 ? (
        <section
          className="atlas-browse-events"
          aria-labelledby="atlas-browse-events-title"
        >
          <div className="atlas-browse-heading">
            <p className="atlas-kicker">By chapter</p>
            <h2 id="atlas-browse-events-title">Start where the day was best.</h2>
            <p>
              {events.length} chapters, in the order they happened. Open one
              and only that part of the weekend loads.
            </p>
          </div>

          <ul className="atlas-browse-event-grid">
            {events.map((event, index) => (
              <Reveal
                as="li"
                key={event.slug}
                className="atlas-browse-event-item"
                delayMs={(index % 4) * 60}
                y={18}
              >
                <Link
                  href={`/photos?event=${encodeURIComponent(event.slug)}`}
                  className="atlas-browse-event"
                >
                  <span className="atlas-browse-event-frame">
                    {event.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={event.cover.src}
                        srcSet={event.cover.srcSet}
                        sizes={COVER_SIZES}
                        width={event.cover.width}
                        height={event.cover.height}
                        alt=""
                        loading={index < 4 ? "eager" : "lazy"}
                        decoding="async"
                      />
                    ) : null}
                    <span className="atlas-browse-event-index" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </span>
                  <span className="atlas-browse-event-line">
                    <strong>{event.name}</strong>
                    <span className="atlas-browse-event-count">
                      {event.count.toLocaleString()} <span>photos</span>
                    </span>
                  </span>
                </Link>
              </Reveal>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
