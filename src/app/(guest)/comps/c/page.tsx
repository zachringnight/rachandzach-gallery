import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion/Reveal";
import { featureFlags, type FeatureFlagName } from "@/content/features";
import { siteConfig } from "@/content/site";
import {
  focalObjectPosition,
  storyPhotos,
  type StoryChapterId,
} from "@/content/story-photos";

import { ReelProgress } from "./ReelProgress";

export const metadata: Metadata = {
  title: "Comp C · Keepsake Cinema",
  description:
    "Design comp: the homepage as a slow film, from opening titles to end credits.",
  robots: { index: false },
};

/**
 * Homepage comp, variant c: Keepsake Cinema (design overhaul task 02).
 *
 * The wedding as a film the family can rewatch. One continuous reel: opening
 * titles over a slow Ken Burns hero, five scenes that pin and dissolve into
 * each other as the guest scrolls, an intermission on cream for the gallery
 * and portals, then end credits that roll the real venues and the real
 * photographer before a quiet ink footer strip.
 *
 * Mechanics: the reel is a stack of sibling sticky frames inside one tall
 * container. Each frame pins at the viewport top while the next slides over
 * it; the incoming frame's photograph rides a Reveal (pure opacity, y=0), so
 * the cut reads as a scroll-driven crossfade. No JS beyond the shared Reveal
 * primitive and the decorative reel counter. Reduced motion: Ken Burns, the
 * credits roll, the scroll cue, and every Reveal all collapse to simply
 * visible content; the sticky frames remain plain scroll positioning.
 *
 * Copy: everything imported from src/content/site.ts where it lives there.
 * Scene and portal strings mirror the approved homepage copy in
 * src/app/page.tsx verbatim (Fable pass, 2026-07-23); they are retyped only
 * because that page does not export them.
 */

interface SceneContent {
  id: StoryChapterId;
  kicker: string;
  title: string;
  body: string;
}

/** Approved chapter copy, verbatim from src/app/page.tsx. */
const scenes: SceneContent[] = [
  {
    id: "coast",
    kicker: "Friday evening · Hotel Californian",
    title: "It started by the water",
    body: "The weekend eased in with dinner and drinks by the coast, no seating chart, no schedule, just everyone arriving hungry and thirsty the way we asked.",
  },
  {
    id: "ceremony",
    kicker: "Saturday, 4:30 PM · Rincon Pergola",
    title: "The ceremony",
    body: "Outdoors, with Santa Barbara views in every direction and the people we love most in the seats.",
  },
  {
    id: "dinner",
    kicker: "Saturday evening",
    title: "Dinner",
    body: "Cocktail hour rolled into dinner, and dinner rolled into a party that carried the reception all the way to 10:00 PM.",
  },
  {
    id: "dancing",
    kicker: "Saturday night",
    title: "The dance floor",
    body: "Coastal views, happy tears, and plenty of dance floor evidence. It is all in the gallery.",
  },
  {
    id: "after-party",
    kicker: "Saturday, 10:30 PM · Studio Sound Room",
    title: "The after party",
    body: "When Santa Barbara's sound ordinances kicked in at 10 PM, the celebration moved to a beach bungalow bar in the Funk Zone and kept going past midnight.",
  },
];

interface PortalContent {
  flag?: FeatureFlagName;
  href: string;
  title: string;
  body: string;
}

/** Approved portal copy, verbatim from src/app/page.tsx. Gated portals
 *  render nothing at all while their flag is off (FeaturePortal rule). */
const portals: PortalContent[] = [
  { href: "/add-yours", title: "Add yours", body: siteConfig.voice.uploadIntro },
  {
    flag: "playlists",
    href: "/playlists",
    title: "Playlists",
    body: "The weekend's soundtrack, chapter by chapter.",
  },
  {
    flag: "marathon",
    href: "/marathon",
    title: "The Marathon",
    body: "The story of Rachel's run, and how to support it.",
  },
  {
    flag: "anniversaryCapsule",
    href: "/anniversary",
    title: "The anniversary capsule",
    body: "A time capsule that opens on our first anniversary.",
  },
];

/** Links that stay visible in the sketched header below md. */
const compactHeaderLinks = new Set(["/photos", "/add-yours"]);

function Ampersand() {
  return (
    <>
      <span aria-hidden="true" className="text-coral">
        &amp;&nbsp;
      </span>
      <span className="sr-only">and </span>
    </>
  );
}

export default function KeepsakeCinemaComp() {
  const hero = storyPhotos.hero;
  const { primary, secondary } = siteConfig.names;
  const { photographer } = siteConfig;
  const headerLinks = siteConfig.navigation.filter(
    (item) =>
      item.href !== "/" &&
      (item.enabled ? true : item.flag ? featureFlags[item.flag] : false),
  );
  const visiblePortals = portals.filter(
    (portal) => !portal.flag || featureFlags[portal.flag],
  );
  const credits = [
    ...siteConfig.weekend.map((event) => ({
      id: event.id,
      label: event.title,
      name: event.venue,
      detail: event.timeLabel
        ? `${event.dateLabel} · ${event.timeLabel}`
        : event.dateLabel,
    })),
    {
      id: "photography",
      label: "Photography",
      name: photographer.name,
      detail: siteConfig.voice.eyebrow,
    },
  ];

  return (
    <div className="bg-ink">
      {/* ---- The reel: opening titles plus five scenes, one sticky stack ---- */}
      <div id="rzc-reel" className="relative">
        {/* Frame 0: opening titles */}
        <section
          aria-label="Opening titles"
          className="sticky top-0 h-svh min-h-[32rem] overflow-hidden"
        >
          <figure className="absolute inset-0">
            {/* Static public derivative; hero stays outside Reveal so first
                paint never waits on hydration. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={hero.src}
              alt={hero.alt}
              width={hero.width}
              height={hero.height}
              decoding="async"
              fetchPriority="high"
              className="rzc-kenburns h-full w-full object-cover"
              style={{
                objectPosition: focalObjectPosition(hero),
                transformOrigin: focalObjectPosition(hero),
              }}
            />
          </figure>
          <div aria-hidden="true" className="rzc-scrim-t absolute inset-x-0 top-0 h-44" />
          <div aria-hidden="true" className="rzc-scrim-b absolute inset-x-0 bottom-0 h-[62%]" />

          {/* Header sketch for this variant: a quiet marquee over the film,
              wordmark left, tracked capitals right. Ships in task 05. */}
          <header className="absolute inset-x-0 top-0 z-10">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
              <Link
                href="/"
                className="font-display text-lg tracking-tight text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              >
                {primary}
                <Ampersand />
                {secondary}
              </Link>
              <nav aria-label="Comp navigation">
                <ul className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1">
                  {headerLinks.map((item) => (
                    <li
                      key={item.href}
                      className={
                        compactHeaderLinks.has(item.href) ? undefined : "hidden md:block"
                      }
                    >
                      <Link
                        href={item.href}
                        className="font-body text-xs uppercase tracking-[0.18em] text-white/85 underline-offset-4 hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </header>

          {/* Title block, lower third, set like a film poster. */}
          <div className="absolute inset-x-0 bottom-0 z-10 px-5 pb-14 sm:px-8 sm:pb-16">
            <div className="mx-auto w-full max-w-6xl">
              <Reveal>
                <p className="flex items-center gap-3 font-body text-xs uppercase tracking-[0.25em] text-white/80">
                  <span aria-hidden="true" className="h-px w-10 bg-coral" />
                  {siteConfig.voice.eyebrow}
                </p>
              </Reveal>
              <Reveal delayMs={120}>
                <h1 className="rzc-film-title mt-4 text-white">
                  <span className="block">{primary}</span>
                  <span className="block">
                    <Ampersand />
                    {secondary}
                  </span>
                </h1>
              </Reveal>
              <Reveal delayMs={240}>
                <p className="mt-5 max-w-xl font-body text-base leading-relaxed text-cream/90 sm:text-lg">
                  {siteConfig.voice.heroBody}
                </p>
              </Reveal>
              <Reveal delayMs={360}>
                <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                  {/* Approved action strings, verbatim from Hero.tsx. */}
                  <Link
                    href="/photos"
                    className="inline-flex min-h-12 items-center justify-center rounded-full bg-white px-7 font-body text-sm font-medium text-ink hover:bg-cream focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                  >
                    Find your photos
                  </Link>
                  <Link
                    href="/weekend"
                    className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/70 px-7 font-body text-sm font-medium text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                  >
                    Browse the weekend
                  </Link>
                </div>
              </Reveal>
            </div>
          </div>

          {/* Scroll cue, bottom right, out of the rail's way. */}
          <div className="absolute bottom-8 right-8 z-10 hidden flex-col items-center gap-3 md:flex">
            <span className="font-body text-[0.625rem] uppercase tracking-[0.25em] text-white/70">
              Scroll
            </span>
            <span aria-hidden="true" className="rzc-cue h-10 w-px bg-white/70" />
          </div>
        </section>

        {/* Frames 1 to 5: the scenes. Transparent until each photo fades in,
            so the pinned previous frame shows through and the cut dissolves. */}
        {scenes.map((scene, index) => {
          const photo = storyPhotos.chapters[scene.id];
          return (
            <section
              key={scene.id}
              id={`rzc-scene-${scene.id}`}
              aria-labelledby={`rzc-scene-title-${scene.id}`}
              className="sticky top-0 h-svh min-h-[32rem] overflow-hidden"
            >
              <Reveal as="figure" y={0} className="absolute inset-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.src}
                  alt={photo.alt}
                  width={photo.width}
                  height={photo.height}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                  style={{ objectPosition: focalObjectPosition(photo) }}
                />
              </Reveal>
              <div
                aria-hidden="true"
                className="rzc-scrim-b absolute inset-x-0 bottom-0 h-[58%]"
              />
              <div className="absolute inset-x-0 bottom-0 px-5 pb-14 sm:px-8 sm:pb-16">
                <div className="mx-auto w-full max-w-6xl">
                  <Reveal delayMs={80}>
                    <p className="flex flex-wrap items-center gap-3 font-body text-xs uppercase tracking-[0.25em] text-white/75">
                      <span className="text-coral">
                        Scene {String(index + 1).padStart(2, "0")}
                      </span>
                      <span aria-hidden="true" className="h-px w-10 bg-white/40" />
                      <span>{scene.kicker}</span>
                    </p>
                  </Reveal>
                  <Reveal delayMs={200}>
                    <h2
                      id={`rzc-scene-title-${scene.id}`}
                      className="rzc-scene-title mt-4 text-white"
                    >
                      {scene.title}
                    </h2>
                  </Reveal>
                  <Reveal delayMs={320}>
                    <p className="mt-4 max-w-prose font-body text-sm leading-relaxed text-cream/90 sm:text-base">
                      {scene.body}
                    </p>
                  </Reveal>
                </div>
              </div>
            </section>
          );
        })}

        <ReelProgress containerId="rzc-reel" sceneCount={scenes.length} />
      </div>

      {/* ---- Intermission: the house lights come up for the gallery ---- */}
      <section
        aria-labelledby="rzc-intermission-title"
        className="rzc-section bg-cream px-5 text-ink sm:px-8"
      >
        <div className="mx-auto grid w-full max-w-6xl gap-12 md:grid-cols-[1.05fr_0.95fr] md:gap-16">
          <div>
            <Reveal>
              <p className="flex items-center gap-3 font-body text-xs uppercase tracking-[0.25em] text-muted">
                <span className="text-coral">Intermission</span>
                <span aria-hidden="true" className="h-px w-10 bg-tan/60" />
              </p>
            </Reveal>
            <Reveal delayMs={120}>
              <h2 id="rzc-intermission-title" className="rzc-scene-title mt-4 text-ink">
                The whole weekend, frame by frame
              </h2>
            </Reveal>
            <Reveal delayMs={240}>
              <p className="mt-5 max-w-prose font-body text-base leading-relaxed text-muted sm:text-lg">
                {siteConfig.voice.galleryIntro}
              </p>
            </Reveal>
            <Reveal delayMs={360}>
              <div className="mt-8">
                <Link
                  href="/photos"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-7 font-body text-sm font-medium text-cream hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
                >
                  Find your photos
                </Link>
                {/* Approved line, verbatim from src/app/page.tsx. */}
                <p className="mt-6 font-body text-base text-muted">
                  Want the whole story in order?{" "}
                  <Link
                    href="/weekend"
                    className="font-medium text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
                  >
                    Walk through the weekend
                  </Link>
                  .
                </p>
              </div>
            </Reveal>
          </div>
          <div className="flex flex-col justify-center gap-5">
            {visiblePortals.map((portal, index) => (
              <Reveal key={portal.href} delayMs={index * 120}>
                <Link
                  href={portal.href}
                  className="rzc-lift group block rounded-card border border-wheat bg-white p-6 shadow-soft focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
                >
                  <h3 className="font-display text-xl text-ink">
                    <span className="underline-offset-4 group-hover:underline">
                      {portal.title}
                    </span>
                    <span aria-hidden="true" className="ml-2 text-coral">
                      &rarr;
                    </span>
                  </h3>
                  <p className="mt-2 font-body text-sm leading-relaxed text-muted">
                    {portal.body}
                  </p>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---- End credits: real venues, real dates, real photographer ---- */}
      <section
        aria-labelledby="rzc-credits-title"
        className="rzc-section bg-ink px-5 text-cream sm:px-8"
      >
        <div className="mx-auto w-full max-w-3xl text-center">
          <Reveal>
            <p className="font-body text-xs uppercase tracking-[0.25em] text-cream/70">
              End credits
            </p>
          </Reveal>
          <Reveal delayMs={120}>
            <h2 id="rzc-credits-title" className="rzc-scene-title mt-4 text-white">
              Where it all happened
            </h2>
          </Reveal>

          {/* The roll: a slow upward loop of the weekend's places. Decorative
              motion only; it pauses on hover and collapses to a static list
              under reduced motion. The duplicate copy exists purely for the
              seamless loop and is hidden from assistive tech. Links never
              ride the moving track. */}
          <Reveal delayMs={240}>
            <div className="rzc-roll relative mx-auto mt-10 h-80 overflow-hidden">
              <div className="rzc-roll-track flex flex-col gap-14">
                <ul className="flex flex-col gap-14">
                  {credits.map((credit) => (
                    <li key={credit.id} className="flex flex-col items-center gap-1">
                      <p className="font-body text-xs uppercase tracking-[0.25em] text-cream/70">
                        {credit.label}
                      </p>
                      <p className="rzc-credit-venue text-white">{credit.name}</p>
                      <p className="font-body text-xs text-cream/70">{credit.detail}</p>
                    </li>
                  ))}
                </ul>
                <ul aria-hidden="true" className="flex flex-col gap-14">
                  {credits.map((credit) => (
                    <li
                      key={`${credit.id}-loop`}
                      className="flex flex-col items-center gap-1"
                    >
                      <p className="font-body text-xs uppercase tracking-[0.25em] text-cream/70">
                        {credit.label}
                      </p>
                      <p className="rzc-credit-venue text-white">{credit.name}</p>
                      <p className="font-body text-xs text-cream/70">{credit.detail}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div
                aria-hidden="true"
                className="rzc-roll-fade-t pointer-events-none absolute inset-x-0 top-0 h-16"
              />
              <div
                aria-hidden="true"
                className="rzc-roll-fade-b pointer-events-none absolute inset-x-0 bottom-0 h-16"
              />
            </div>
          </Reveal>

          {/* Static, keyboard-reachable photographer credit. */}
          <Reveal delayMs={320}>
            <p className="mt-8 font-body text-xs text-cream/80">
              Photography by{" "}
              {photographer.websiteUrl ? (
                <Link
                  href={photographer.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cream"
                >
                  {photographer.name}
                </Link>
              ) : (
                photographer.name
              )}
              {photographer.instagramUrl && (
                <>
                  {" "}
                  ·{" "}
                  <Link
                    href={photographer.instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cream"
                  >
                    Instagram
                  </Link>
                </>
              )}
            </p>
          </Reveal>
        </div>
      </section>

      {/* ---- Footer strip: the last card before the lights come up ---- */}
      <footer className="border-t border-cream/20 bg-ink text-cream">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="font-display text-2xl text-white">
              {primary}
              <Ampersand />
              {secondary}
            </p>
            <p className="font-body text-sm text-cream/80">{siteConfig.voice.eyebrow}</p>
            {/* Approved line, verbatim from SiteFooter.tsx. */}
            <p className="font-body text-sm italic text-cream/80">
              Made with love for the people we love.
            </p>
          </div>
          <nav aria-label="Comp footer" className="font-body text-xs text-cream/80">
            <Link
              href="/admin"
              className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cream"
            >
              Admin
            </Link>
          </nav>
        </div>
      </footer>

      {/* Variant-scoped styles: film typography, scrims, and the three
          decorative motions (Ken Burns, scroll cue, credits roll). All motion
          collapses under prefers-reduced-motion; scrims are opacity blends of
          the locked ink token. */}
      <style>{`
        .rzc-film-title {
          font-family: var(--rz-font-display);
          font-size: var(--rz-text-hero);
          line-height: 0.9;
          letter-spacing: -0.015em;
          font-weight: 430;
          font-variation-settings: "opsz" 144, "SOFT" 40, "WONK" 0;
          text-wrap: balance;
        }
        .rzc-scene-title {
          font-family: var(--rz-font-display);
          font-size: var(--rz-text-display);
          line-height: 1.02;
          letter-spacing: -0.01em;
          font-weight: 460;
          font-variation-settings: "opsz" 96, "SOFT" 100, "WONK" 1;
          text-wrap: balance;
        }
        .rzc-credit-venue {
          font-family: var(--rz-font-display);
          font-size: var(--rz-text-title);
          line-height: 1.1;
          font-weight: 440;
          font-variation-settings: "opsz" 72, "SOFT" 60, "WONK" 0;
        }
        .rzc-section {
          padding-block: var(--rz-space-section);
        }
        .rzc-scrim-b {
          background: linear-gradient(
            to top,
            rgba(40, 37, 33, 0.88),
            rgba(40, 37, 33, 0.42) 45%,
            rgba(40, 37, 33, 0)
          );
        }
        .rzc-scrim-t {
          background: linear-gradient(to bottom, rgba(40, 37, 33, 0.55), rgba(40, 37, 33, 0));
        }
        .rzc-roll-fade-t {
          background: linear-gradient(to bottom, var(--rz-ink), rgba(40, 37, 33, 0));
        }
        .rzc-roll-fade-b {
          background: linear-gradient(to top, var(--rz-ink), rgba(40, 37, 33, 0));
        }
        @keyframes rzc-kenburns {
          from {
            transform: scale(1.06);
          }
          to {
            transform: scale(1.18) translate(-1.2%, -1.8%);
          }
        }
        .rzc-kenburns {
          animation: rzc-kenburns 44s var(--rz-ease-inout) infinite alternate;
          will-change: transform;
        }
        @keyframes rzc-cue {
          0%,
          100% {
            transform: scaleY(0.35);
            opacity: 0.5;
          }
          50% {
            transform: scaleY(1);
            opacity: 1;
          }
        }
        .rzc-cue {
          animation: rzc-cue 2.6s var(--rz-ease-inout) infinite;
          transform-origin: top;
        }
        @keyframes rzc-roll {
          from {
            transform: translateY(0);
          }
          to {
            transform: translateY(-50%);
          }
        }
        .rzc-roll-track {
          animation: rzc-roll 42s linear infinite;
        }
        .rzc-roll:hover .rzc-roll-track,
        .rzc-roll:focus-within .rzc-roll-track {
          animation-play-state: paused;
        }
        .rzc-tick {
          transition:
            width var(--rz-dur-fast) var(--rz-ease-out),
            background-color var(--rz-dur-fast) var(--rz-ease-out);
        }
        .rzc-lift {
          transition:
            transform var(--rz-dur-fast) var(--rz-ease-out),
            box-shadow var(--rz-dur-fast) var(--rz-ease-out);
        }
        .rzc-lift:hover {
          transform: translateY(-3px);
        }
        @media (prefers-reduced-motion: reduce) {
          .rzc-kenburns,
          .rzc-cue,
          .rzc-roll-track {
            animation: none;
          }
          .rzc-tick,
          .rzc-lift {
            transition: none;
          }
          .rzc-lift:hover {
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
