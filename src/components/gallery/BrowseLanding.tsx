import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";

import { Reveal } from "@/components/motion/Reveal";
import { GALLERY_SEARCH_URL_PARAM } from "@/lib/gallery/client-types";
import { MAX_GALLERY_SEARCH_LENGTH } from "@/lib/gallery/query";
import { MOMENT_SEARCH_EXAMPLES } from "@/lib/search/contracts";

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
  /** Whether to offer Moment Search prompts. Mirrors featureFlags. */
  momentSearch: boolean;
}

/** A handful of prompts, not the full set: this is a door, not the panel. */
const LANDING_MOMENT_PROMPTS = MOMENT_SEARCH_EXAMPLES.slice(0, 4);

/** Card sizes track the event grid's column count (see globals.css). */
const COVER_SIZES =
  "(max-width: 639px) 46vw, (max-width: 979px) 31vw, (max-width: 1399px) 23vw, 18vw";

export function BrowseLanding({
  totalPhotos,
  events,
  faces,
  taggedPeople,
  momentSearch,
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

      {/*
       * Search is one of the four named guest jobs, and until now it only
       * existed once the grid had mounted: a guest who arrived knowing they
       * wanted "the sunset kiss" had to open all 1,721 photographs first and
       * find the field inside. This is a plain GET form, so it works with no
       * JavaScript and lands directly on the filtered grid -- gallery_q is
       * already in GRID_PARAM_KEYS, so the URL mounts the grid rather than
       * bouncing back to this landing.
       */}
      <section className="atlas-browse-search" aria-labelledby="atlas-browse-search-title">
        <h2 id="atlas-browse-search-title" className="atlas-kicker">
          By search
        </h2>
        <form action="/photos" method="get" role="search">
          <label htmlFor="atlas-browse-search-input">
            Search names, events, tags
          </label>
          <div className="atlas-browse-search-field">
            <Search aria-hidden="true" size={16} strokeWidth={1.6} />
            <input
              id="atlas-browse-search-input"
              type="search"
              name={GALLERY_SEARCH_URL_PARAM}
              placeholder="Search names, events, tags"
              autoComplete="off"
              /* Same cap as the in-grid field and as parseGalleryQuery.
                 Without it the browser happily submits a longer value, the
                 server throws GalleryQueryError, and the catch falls back to
                 the unfiltered gallery while initialFilters clears the
                 query -- so a submission that looked fine returns the whole
                 archive with no indication why. */
              maxLength={MAX_GALLERY_SEARCH_LENGTH}
            />
            <button type="submit">Search</button>
          </div>
        </form>
        {momentSearch ? (
          /* Moment Search sat at the bottom of /my-weekend, below all 186
           * faces, on a 4,287px page. These prompts are a second door to it
           * from the surface guests actually land on. Plain `q` is Moment
           * Search's param and is also in GRID_PARAM_KEYS. */
          <div className="atlas-browse-prompts">
            <p>Or describe a moment:</p>
            <ul>
              {LANDING_MOMENT_PROMPTS.map((prompt) => (
                <li key={prompt}>
                  <Link
                    href={`/photos?q=${encodeURIComponent(prompt)}`}
                    className="atlas-picker-chip"
                  >
                    {prompt}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

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
