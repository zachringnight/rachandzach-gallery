import type { Metadata } from "next";
import Link from "next/link";
import { clsx } from "clsx";

import { BrandMark } from "@/components/brand/BrandMark";
import { Reveal } from "@/components/motion/Reveal";
import { featureFlags, type FeatureFlagName } from "@/content/features";
import { siteConfig } from "@/content/site";
import {
  focalObjectPosition,
  storyPhotos,
  type StoryPhotoContent,
} from "@/content/story-photos";

import { ChapterIndex, type ChapterIndexItem } from "./ChapterIndex";

export const metadata: Metadata = {
  title: "Comp B · Gallery House",
  robots: { index: false },
};

/**
 * Homepage comp B: Gallery House.
 *
 * A museum hang. The homepage is the couple's own gallery: an exhibition
 * title wall, five framed plates on a calm cream field, wall labels in
 * immaculate small type, a sticky chapter index rail tracking scroll, and
 * ink-on-cream duotone frontispieces announcing each day. Near-zero motion
 * by design: plates fade up like lights coming on over an artwork, and
 * everything else holds still. The discipline is the statement.
 *
 * Temporary comp route (design overhaul task 02); deleted by task 17.
 */

/** Weekend day label straight from the content source, never retyped. */
function weekendDateLabel(id: string): string {
  return siteConfig.weekend.find((event) => event.id === id)?.dateLabel ?? "";
}

/** Navigation label straight from the content source, with a pinned fallback. */
function navLabel(href: string, fallback: string): string {
  return (
    siteConfig.navigation.find((item) => item.href === href)?.label ?? fallback
  );
}

type PlateLayout = "landscape" | "panorama" | "portrait";

interface Room {
  id: string;
  numeral: string;
  /** Date or time-of-day line, set like the year line of a wall label. */
  kicker: string;
  title: string;
  body: string;
  photo: StoryPhotoContent;
  layout: PlateLayout;
}

/** Chapter copy matches the shipped homepage verbatim; copy is locked. */
const rooms: Room[] = [
  {
    id: "coast",
    numeral: "I",
    kicker: "Friday evening · Hotel Californian",
    title: "It started by the water",
    body: "The weekend eased in with dinner and drinks by the coast, no seating chart, no schedule, just everyone arriving hungry and thirsty the way we asked.",
    photo: storyPhotos.chapters.coast,
    layout: "landscape",
  },
  {
    id: "ceremony",
    numeral: "II",
    kicker: "Saturday, 4:30 PM · Rincon Pergola",
    title: "The ceremony",
    body: "Outdoors, with Santa Barbara views in every direction and the people we love most in the seats.",
    photo: storyPhotos.chapters.ceremony,
    layout: "panorama",
  },
  {
    id: "dinner",
    numeral: "III",
    kicker: "Saturday evening",
    title: "Dinner",
    body: "Cocktail hour rolled into dinner, and dinner rolled into a party that carried the reception all the way to 10:00 PM.",
    photo: storyPhotos.chapters.dinner,
    layout: "landscape",
  },
  {
    id: "dancing",
    numeral: "IV",
    kicker: "Saturday night",
    title: "The dance floor",
    body: "Coastal views, happy tears, and plenty of dance floor evidence. It is all in the gallery.",
    photo: storyPhotos.chapters.dancing,
    layout: "portrait",
  },
  {
    id: "after-party",
    numeral: "V",
    kicker: "Saturday, 10:30 PM · Studio Sound Room",
    title: "The after party",
    body: "When Santa Barbara's sound ordinances kicked in at 10 PM, the celebration moved to a beach bungalow bar in the Funk Zone and kept going past midnight.",
    photo: storyPhotos.chapters["after-party"],
    layout: "landscape",
  },
];

const chapterIndex: ChapterIndexItem[] = rooms.map(({ id, numeral, title }) => ({
  id,
  numeral,
  title,
}));

/** Frame and label column plans per plate shape. Literal classes for Tailwind. */
const plateGrid: Record<PlateLayout, { frame: string; label: string; aspect: string }> = {
  landscape: {
    frame: "lg:col-span-8",
    label: "mt-6 lg:col-span-4 lg:mt-0",
    aspect: "aspect-[3/2]",
  },
  panorama: {
    frame: "lg:col-span-12",
    label: "mt-6 lg:col-span-4 lg:col-start-9",
    aspect: "aspect-[21/9]",
  },
  portrait: {
    frame: "lg:col-span-5",
    label: "mt-6 lg:col-span-4 lg:mt-0",
    aspect: "aspect-[3/4]",
  },
};

/** A framed print: hairline ink frame, white mat, the photograph. */
function Plate({
  photo,
  aspect,
  priority = false,
}: {
  photo: StoryPhotoContent;
  aspect: string;
  priority?: boolean;
}) {
  return (
    <div className="compb-frame">
      {/* Static public derivative on a comp; next/image adds only config surface. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.src}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        loading={priority ? undefined : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        className={clsx("w-full object-cover", aspect)}
        style={{ objectPosition: focalObjectPosition(photo) }}
      />
    </div>
  );
}

/**
 * Ink-on-cream duotone section break: a letterboxed slice of the day ahead,
 * printed in the two page colors, with a small plaque naming the day. The
 * duotone is pure CSS blending of the locked palette (grayscale image
 * screened over ink, cream multiplied on top), no new hues.
 */
function DuotoneBreak({
  photo,
  label,
  className,
  heightClassName = "h-40 sm:h-56",
}: {
  photo: StoryPhotoContent;
  label: string;
  className?: string;
  heightClassName?: string;
}) {
  return (
    <div
      className={clsx(
        "compb-duotone relative isolate overflow-hidden",
        heightClassName,
        className,
      )}
    >
      {/* Decorative restatement of a plate; the plaque carries the meaning. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.src}
        alt=""
        aria-hidden="true"
        width={photo.width}
        height={photo.height}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
        style={{ objectPosition: focalObjectPosition(photo) }}
      />
      <p className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap border border-ink/25 bg-cream px-4 py-2 font-body text-[11px] uppercase tracking-[0.18em] text-ink">
        {label}
      </p>
    </div>
  );
}

/** One hung work: framed plate beside its wall label, bases aligned. */
function GalleryRoom({ room }: { room: Room }) {
  const grid = plateGrid[room.layout];
  return (
    <section
      id={room.id}
      aria-labelledby={`${room.id}-title`}
      className="mt-16 scroll-mt-16 sm:mt-24 lg:scroll-mt-10"
    >
      <div className="lg:grid lg:grid-cols-12 lg:items-end lg:gap-10">
        <Reveal y={0} className={grid.frame}>
          <Plate photo={room.photo} aspect={grid.aspect} />
        </Reveal>
        <div className={clsx("max-w-[44ch]", grid.label)}>
          <p className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px w-6 bg-coral" />
            <span className="compb-display font-display text-sm text-ink">
              {room.numeral}
            </span>
          </p>
          <h2
            id={`${room.id}-title`}
            className="compb-display mt-3 font-display text-2xl leading-snug text-ink sm:text-[1.75rem]"
          >
            {room.title}
          </h2>
          <p className="mt-2 font-body text-[11px] uppercase tracking-[0.18em] text-muted">
            {room.kicker}
          </p>
          <p className="mt-4 font-body text-sm leading-relaxed text-ink">
            {room.body}
          </p>
        </div>
      </div>
    </section>
  );
}

interface Door {
  href: string;
  title: string;
  body: string;
  flag?: FeatureFlagName;
}

export default function GalleryHouseComp() {
  const { voice, names, photographer } = siteConfig;
  const hero = storyPhotos.hero;
  const weddingDate = weekendDateLabel("wedding");

  const doors: Door[] = [
    {
      href: "/photos",
      title: navLabel("/photos", "Photos"),
      body: voice.galleryIntro,
    },
    {
      href: "/add-yours",
      title: navLabel("/add-yours", "Add Yours"),
      body: voice.uploadIntro,
    },
    {
      href: "/my-weekend",
      title: navLabel("/my-weekend", "My Weekend"),
      body: "Your own view of the weekend.",
    },
    {
      href: "/weekend",
      title: navLabel("/weekend", "The Weekend"),
      body: "The whole story in order, from Friday to Sunday.",
    },
    {
      href: "/playlists",
      title: navLabel("/playlists", "Playlists"),
      body: "The weekend's soundtrack, chapter by chapter.",
      flag: "playlists",
    },
    {
      href: "/marathon",
      title: navLabel("/marathon", "The Marathon"),
      body: "The story of Rachel's run, and how to support it.",
      flag: "marathon",
    },
    {
      href: "/anniversary",
      title: "The anniversary capsule",
      body: "A time capsule that opens on our first anniversary.",
      flag: "anniversaryCapsule",
    },
  ];
  const openDoors = doors.filter((door) => !door.flag || featureFlags[door.flag]);

  return (
    <div data-compb className="bg-cream text-ink">
      {/* Header sketch (variant-local): a centered gallery lockup over one
          quiet nav line, like a museum's entrance wall. Non-sticky on
          purpose; the chapter rail is the persistent orientation device. */}
      <header className="border-b border-ink/10">
        <div className="mx-auto max-w-6xl px-5 pb-5 pt-7 text-center sm:px-8">
          <Link
            href="/"
            className="inline-flex focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            <BrandMark size={26} alt="0719 + co." />
          </Link>
          <nav aria-label="Site" className="mt-5">
            <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-body text-[11px] uppercase tracking-[0.18em]">
              {siteConfig.navigation
                .filter((item) => item.enabled)
                .map((item) => {
                  const isHome = item.href === "/";
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isHome ? "page" : undefined}
                        className={clsx(
                          "pb-0.5 text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink",
                          isHome && "border-b border-ink",
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </nav>
        </div>
      </header>

      {/* Exhibition title wall: the names, the curatorial statement, the
          checklist of facts, then the first framed work. */}
      <section
        aria-labelledby="compb-hero-title"
        className="mx-auto max-w-6xl px-5 pt-14 sm:px-8 sm:pt-20"
      >
        <p className="font-body text-[11px] uppercase tracking-[0.22em] text-muted">
          {voice.eyebrow}
        </p>
        <h1
          id="compb-hero-title"
          className="compb-display compb-hero-title mt-5 font-display text-[length:var(--text-hero)] leading-[0.95] text-ink"
        >
          {names.primary}
          <span aria-hidden="true" className="compb-amp text-coral">
            {" "}
            &amp;{" "}
          </span>
          <span className="sr-only"> and </span>
          {names.secondary}
        </h1>

        <div className="mt-10 grid gap-10 lg:mt-14 lg:grid-cols-12 lg:gap-12">
          <p className="compb-display max-w-[34rem] font-display text-lg leading-relaxed text-ink sm:text-xl lg:col-span-7">
            {voice.heroBody}
          </p>
          <dl className="self-end font-body text-sm lg:col-span-4 lg:col-start-9">
            <div className="grid grid-cols-[7.5rem_1fr] gap-4 border-t border-ink/15 py-3">
              <dt className="pt-0.5 text-[11px] uppercase tracking-[0.18em] text-muted">
                Date
              </dt>
              <dd className="text-ink">{weddingDate}</dd>
            </div>
            <div className="grid grid-cols-[7.5rem_1fr] gap-4 border-t border-ink/15 py-3">
              <dt className="pt-0.5 text-[11px] uppercase tracking-[0.18em] text-muted">
                Place
              </dt>
              <dd className="text-ink">{siteConfig.location}</dd>
            </div>
            <div className="grid grid-cols-[7.5rem_1fr] gap-4 border-y border-ink/15 py-3">
              <dt className="pt-0.5 text-[11px] uppercase tracking-[0.18em] text-muted">
                Photography
              </dt>
              <dd className="text-ink">
                {photographer.websiteUrl ? (
                  <Link
                    href={photographer.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
                  >
                    {photographer.name}
                  </Link>
                ) : (
                  photographer.name
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-10 flex flex-wrap gap-x-10 gap-y-4">
          <Link
            href="/photos"
            className="border-b border-ink/40 pb-1 font-body text-[11px] uppercase tracking-[0.18em] text-ink transition-colors hover:border-coral focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            Find your photos
          </Link>
          <Link
            href="/weekend"
            className="border-b border-ink/40 pb-1 font-body text-[11px] uppercase tracking-[0.18em] text-ink transition-colors hover:border-coral focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            Walk through the weekend
          </Link>
        </div>

        <Reveal y={0} className="mt-14 sm:mt-20">
          <Plate photo={hero} aspect="aspect-[16/9]" priority />
          <p className="mt-3 text-right font-body text-xs text-muted">
            {hero.alt}
          </p>
        </Reveal>
      </section>

      {/* The hang: sticky chapter rail beside five rooms, with duotone
          frontispieces announcing Friday and Saturday. */}
      <div className="mx-auto mt-16 max-w-6xl px-5 sm:mt-24 sm:px-8 lg:flex lg:gap-14 [--compb-pad:1.25rem] sm:[--compb-pad:2rem]">
        <ChapterIndex chapters={chapterIndex} />
        <div className="min-w-0 flex-1">
          <DuotoneBreak
            photo={storyPhotos.chapters.coast}
            label={weekendDateLabel("welcome-party")}
          />
          <GalleryRoom room={rooms[0]} />

          <DuotoneBreak
            photo={storyPhotos.chapters.ceremony}
            label={weekendDateLabel("wedding")}
            className="mt-16 sm:mt-24"
          />
          <GalleryRoom room={rooms[1]} />
          <GalleryRoom room={rooms[2]} />
          <GalleryRoom room={rooms[3]} />
          <GalleryRoom room={rooms[4]} />
        </div>
      </div>

      {/* End wall: the entry photograph again, printed in the page's two
          inks. You came in through color; you leave through memory. */}
      <div className="mx-auto mt-20 max-w-6xl px-5 sm:mt-28 sm:px-8">
        <DuotoneBreak
          photo={hero}
          label={voice.eyebrow}
          heightClassName="h-52 sm:h-72"
        />
      </div>

      {/* The doors: a gallery directory instead of cards. */}
      <section
        aria-labelledby="compb-doors-title"
        className="mx-auto mt-20 max-w-6xl px-5 sm:mt-28 sm:px-8"
      >
        <h2
          id="compb-doors-title"
          className="compb-display font-display text-3xl leading-tight text-ink sm:text-4xl"
        >
          Keep the weekend going
        </h2>
        <ul className="mt-8 border-b border-ink/15">
          {openDoors.map((door) => (
            <li key={door.href} className="border-t border-ink/15">
              <Link
                href={door.href}
                className="group flex items-baseline justify-between gap-6 py-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
              >
                <span className="min-w-0">
                  <span className="compb-display block font-display text-xl text-ink underline-offset-4 group-hover:underline">
                    {door.title}
                  </span>
                  <span className="mt-1 block max-w-[52rem] font-body text-sm leading-relaxed text-muted">
                    {door.body}
                  </span>
                </span>
                <span aria-hidden="true" className="text-coral">
                  &rarr;
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Footer strip: the colophon. */}
      <footer className="mt-20 border-t border-ink/15 sm:mt-28">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="compb-display font-display text-2xl text-ink">
              {names.primary}
              <span aria-hidden="true"> &amp; </span>
              <span className="sr-only"> and </span>
              {names.secondary}
            </p>
            <p className="mt-2 font-body text-sm text-muted">{voice.eyebrow}</p>
            <p className="mt-1 font-body text-sm text-muted">
              Made with love for the people we love.
            </p>
          </div>
          <div className="font-body text-xs text-muted md:text-right">
            <p>
              Photography by{" "}
              {photographer.websiteUrl ? (
                <Link
                  href={photographer.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
                >
                  {photographer.name}
                </Link>
              ) : (
                photographer.name
              )}
              {photographer.instagramUrl ? (
                <>
                  {" "}
                  ·{" "}
                  <Link
                    href={photographer.instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
                  >
                    Instagram
                  </Link>
                </>
              ) : null}
            </p>
            <p className="mt-2">
              <Link
                href="/admin"
                className="text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
              >
                Admin
              </Link>
            </p>
          </div>
        </div>
      </footer>

      {/* Comp-scoped styles: the museum devices this variant is auditioning.
          All colors derive from the locked palette (opacity or blends of
          ink and cream); the only transitions are color and opacity. */}
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          html:has([data-compb]) {
            scroll-behavior: smooth;
          }
        }

        /* Fraunces at full optical size, soft and wonk off: precise, not quaint. */
        .compb-display {
          font-variation-settings: "opsz" 144, "SOFT" 0, "WONK" 0;
        }
        .compb-hero-title {
          font-weight: 400;
          letter-spacing: -0.015em;
        }
        /* The one indulgent glyph on the page: a softened coral ampersand. */
        .compb-amp {
          font-variation-settings: "opsz" 144, "SOFT" 100, "WONK" 0;
          font-weight: 340;
        }

        /* A framed print: hairline ink frame, white mat, hairline around the
           print itself. Square corners on purpose; the site default radius
           reads as product UI, and these are artworks. */
        .compb-frame {
          border: 1px solid rgba(40, 37, 33, 0.16);
          background: var(--rz-white);
          padding: 0.625rem;
          box-shadow: var(--rz-shadow-soft);
        }
        @media (min-width: 640px) {
          .compb-frame {
            padding: 1rem;
          }
        }
        .compb-frame img {
          display: block;
          border: 1px solid rgba(40, 37, 33, 0.1);
        }

        /* Ink-on-cream duotone: grayscale print screened over an ink ground,
           cream multiplied over the result. Only the two page colors. */
        .compb-duotone {
          background: var(--rz-ink);
        }
        .compb-duotone > img {
          filter: grayscale(1) contrast(1.06);
          mix-blend-mode: screen;
        }
        .compb-duotone::after {
          content: "";
          position: absolute;
          inset: 0;
          background: var(--rz-cream);
          mix-blend-mode: multiply;
          pointer-events: none;
        }

        /* Chapter index rail. Mobile: a slim sticky strip of numerals over a
           blurred cream ground. Desktop: a vertical hang list on a hairline,
           with a coral tick marking the current room. */
        .compb-rail {
          position: sticky;
          top: 0;
          z-index: 30;
          margin: 0 calc(-1 * var(--compb-pad, 1.25rem));
          border-bottom: 1px solid rgba(40, 37, 33, 0.12);
          background: color-mix(in srgb, var(--rz-cream) 92%, transparent);
          backdrop-filter: blur(8px);
        }
        .compb-rail ol {
          display: flex;
          gap: 0.25rem;
          margin: 0;
          padding: 0.5rem var(--compb-pad, 1.25rem);
          list-style: none;
          overflow-x: auto;
        }
        .compb-rail-link {
          display: inline-flex;
          align-items: baseline;
          gap: 0.6rem;
          padding: 0.35rem 0.6rem;
          color: var(--rz-muted);
          font-size: 0.8125rem;
          text-decoration: none;
          transition: color var(--rz-dur-fast) var(--rz-ease-out);
        }
        .compb-rail-link:hover,
        .compb-rail-link[aria-current="true"] {
          color: var(--rz-ink);
        }
        .compb-rail-link:focus-visible {
          outline: 2px solid var(--rz-ink);
          outline-offset: 2px;
        }
        .compb-rail-numeral {
          font-family: var(--rz-font-display);
          font-size: 0.9375rem;
          font-variation-settings: "opsz" 144, "SOFT" 0, "WONK" 0;
        }
        /* Mobile strip shows numerals only; titles stay in the accessible
           name via this clip (display: none would drop them). */
        .compb-rail-title {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        @media (min-width: 1024px) {
          .compb-rail {
            top: 5.5rem;
            z-index: auto;
            width: 13rem;
            flex: none;
            align-self: flex-start;
            margin: 0;
            border-bottom: 0;
            background: none;
            backdrop-filter: none;
          }
          .compb-rail ol {
            display: block;
            padding: 0;
            border-left: 1px solid rgba(40, 37, 33, 0.14);
            overflow: visible;
          }
          .compb-rail-link {
            position: relative;
            display: grid;
            grid-template-columns: 1.6rem minmax(0, 1fr);
            gap: 0.6rem;
            padding: 0.45rem 0 0.45rem 1.1rem;
            line-height: 1.35;
          }
          .compb-rail-link::before {
            content: "";
            position: absolute;
            left: -1px;
            top: 1.05rem;
            width: 0.7rem;
            height: 2px;
            background: var(--rz-coral);
            opacity: 0;
            transition: opacity var(--rz-dur-fast) var(--rz-ease-out);
          }
          .compb-rail-link[aria-current="true"]::before {
            opacity: 1;
          }
          .compb-rail-title {
            position: static;
            width: auto;
            height: auto;
            margin: 0;
            padding: 0;
            overflow: visible;
            clip-path: none;
            white-space: normal;
          }
        }
      `}</style>
    </div>
  );
}
