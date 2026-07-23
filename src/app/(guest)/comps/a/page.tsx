import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion/Reveal";
import { featureFlags } from "@/content/features";
import { siteConfig } from "@/content/site";
import {
  focalObjectPosition,
  storyPhotos,
  type StoryPhotoContent,
} from "@/content/story-photos";

/**
 * Comp A: Editorial Album (design overhaul task 02, variant a).
 *
 * The homepage as the opening signature of a hardbound annual printed for one
 * weekend: a cover plate, a large-serif standfirst, five chapters with
 * timestamp running heads, a night section where the paper turns to ink, a
 * contents page, and a colophon. Square corners, hairline rules, no cards,
 * no shadows: print, not product.
 *
 * This whole directory is a temporary comp behind the guest gate and is
 * deleted by task 17. The shipped homepage lands in task 03.
 */

export const metadata: Metadata = {
  title: "Comp A · Editorial Album | Rach & Zach",
  description: "Design comp A: the homepage as an editorial album.",
};

/**
 * Chapter narrative copy reused VERBATIM from the approved homepage
 * (src/app/page.tsx, Fable copy pass approved 2026-07-23). Comps may not
 * import from that file and the strings are locked, so they are mirrored
 * here unchanged. The clock-time markers are facts from
 * siteConfig.weekend timeLabels (6:00 PM welcome party start, 4:30 PM
 * ceremony, 10:30 PM after party); chapters without a real clock time
 * carry no numeral marker rather than an invented one.
 */
const CHAPTERS = {
  coast: {
    kicker: "Friday evening · Hotel Californian",
    title: "It started by the water",
    body: "The weekend eased in with dinner and drinks by the coast, no seating chart, no schedule, just everyone arriving hungry and thirsty the way we asked.",
  },
  ceremony: {
    kicker: "Saturday, 4:30 PM · Rincon Pergola",
    title: "The ceremony",
    body: "Outdoors, with Santa Barbara views in every direction and the people we love most in the seats.",
  },
  dinner: {
    kicker: "Saturday evening",
    title: "Dinner",
    body: "Cocktail hour rolled into dinner, and dinner rolled into a party that carried the reception all the way to 10:00 PM.",
  },
  dancing: {
    kicker: "Saturday night",
    title: "The dance floor",
    body: "Coastal views, happy tears, and plenty of dance floor evidence. It is all in the gallery.",
  },
  afterParty: {
    kicker: "Saturday, 10:30 PM · Studio Sound Room",
    title: "The after party",
    body: "When Santa Barbara's sound ordinances kicked in at 10 PM, the celebration moved to a beach bungalow bar in the Funk Zone and kept going past midnight.",
  },
} as const;

/** Existing homepage strings reused verbatim (src/app/page.tsx). */
const INTRO_TITLE = "From the coast to the dance floor";
const CONTENTS_TITLE = "Keep the weekend going";
/** Reused verbatim from the approved weekend page header (src/app/(public)/weekend/page.tsx). */
const WEEKEND_INTRO =
  "Three days by the water with everyone we love. Here is how it went, in order.";
/** Reused verbatim from the approved footer (src/components/site/SiteFooter.tsx). */
const MADE_WITH_LOVE = "Made with love for the people we love.";

/** "July 19, 2025" from siteConfig.date, parsed as a plain date (no TZ math). */
function formatCoverDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function navLabel(href: string): string {
  return siteConfig.navigation.find((item) => item.href === href)?.label ?? href;
}

interface StoryImageProps {
  photo: StoryPhotoContent;
  className?: string;
  priority?: boolean;
}

/** Focal-cropped photograph via the six approved /story derivatives. */
function StoryImage({ photo, className, priority = false }: StoryImageProps) {
  return (
    // Static public derivative; repo convention is <img>, not next/image.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo.src}
      alt={photo.alt}
      width={photo.width}
      height={photo.height}
      loading={priority ? undefined : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={className}
      style={{ objectPosition: focalObjectPosition(photo) }}
    />
  );
}

/** Hairline running head: folio number left, chapter kicker right. */
function RunningHead({
  no,
  kicker,
  dark = false,
}: {
  no: string;
  kicker: string;
  dark?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 border-t pt-3 font-body text-[0.6875rem] uppercase tracking-[0.25em] ${
        dark ? "border-cream/25 text-cream/70" : "border-ink/20 text-muted"
      }`}
    >
      <span className="whitespace-nowrap">{no}</span>
      <span className="text-right">{kicker}</span>
    </div>
  );
}

/** Editorial underlined text link with an arrow, replacing pill buttons. */
function EditorialLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex min-h-12 items-center gap-3 border-b border-ink font-body text-sm uppercase tracking-[0.2em] text-ink hover:border-coral focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
    >
      {children}
      <span
        aria-hidden="true"
        className="motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-safe:group-hover:translate-x-1.5"
      >
        &rarr;
      </span>
    </Link>
  );
}

export default function CompAPage() {
  const { hero, chapters } = storyPhotos;
  const coverDate = formatCoverDate(siteConfig.date);
  const mastheadNav = siteConfig.navigation.filter((item) =>
    item.enabled ? true : item.flag ? featureFlags[item.flag] : false,
  );
  const contents: { href: string; body: string }[] = [
    { href: "/weekend", body: WEEKEND_INTRO },
    { href: "/photos", body: siteConfig.voice.galleryIntro },
    {
      href: "/my-weekend",
      // Reused verbatim from the approved My Weekend header
      // (src/app/(guest)/my-weekend/page.tsx), names interpolated the same way.
      body: `Tell us who you are and we will gather every photo of ${siteConfig.names.primary} and ${siteConfig.names.secondary}’s weekend that includes you.`,
    },
    { href: "/add-yours", body: siteConfig.voice.uploadIntro },
  ];

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Masthead sketch (task 05 experiments allowed here). The shared      */}
      {/* SiteHeader still renders above from the guest layout; this row      */}
      {/* below it is the variant's own proposal.                             */}
      {/* ------------------------------------------------------------------ */}
      <div className="border-b border-ink/20">
        <div className="mx-auto max-w-[90rem] px-[clamp(1.25rem,5vw,4rem)] py-4">
          <div className="flex items-baseline justify-between gap-6">
            <span className="hidden font-body text-[0.6875rem] uppercase tracking-[0.28em] text-muted sm:block">
              {coverDate}
            </span>
            <span className="compa-masthead font-display text-xl text-ink">
              {siteConfig.names.primary}
              <span aria-hidden="true"> &amp; </span>
              <span className="sr-only"> and </span>
              {siteConfig.names.secondary}
            </span>
            <span className="hidden font-body text-[0.6875rem] uppercase tracking-[0.28em] text-muted sm:block">
              {siteConfig.location}
            </span>
          </div>
          <nav aria-label="Comp A" className="mt-3 border-t border-ink/10 pt-3">
            <ul className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2">
              {mastheadNav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="font-body text-[0.6875rem] uppercase tracking-[0.28em] text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Cover: full-bleed focal-cropped sunset plate, oversized Fraunces    */}
      {/* name lockup with a coral italic ampersand, the date set large in    */}
      {/* italic. Scrim is derived ink (opacity only, no new hue).            */}
      {/* ------------------------------------------------------------------ */}
      <section aria-labelledby="cover-title" className="relative isolate overflow-hidden bg-ink">
        <StoryImage
          photo={hero}
          priority
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-ink/65 via-ink/25 to-transparent"
        />
        <div className="relative z-10 mx-auto flex h-[80svh] max-h-[68rem] min-h-[520px] w-full max-w-[90rem] flex-col justify-end px-[clamp(1.25rem,5vw,4rem)] pb-[clamp(2rem,6svh,4.5rem)]">
          <Reveal y={28}>
            <h1 id="cover-title" className="compa-names font-display text-cream">
              <span className="block">{siteConfig.names.primary}</span>
              <span className="block">
                <span aria-hidden="true" className="compa-amp text-coral">
                  &amp;{" "}
                </span>
                <span className="sr-only">and </span>
                {siteConfig.names.secondary}
              </span>
            </h1>
            <div aria-hidden="true" className="mt-6 h-px w-24 bg-cream/50" />
            <p className="compa-date mt-5 font-display text-cream">{coverDate}</p>
            <p className="mt-2 font-body text-xs uppercase tracking-[0.28em] text-cream/90">
              {siteConfig.location}
            </p>
          </Reveal>
          <p className="absolute bottom-[clamp(2rem,6svh,4.5rem)] right-[clamp(1.25rem,5vw,4rem)] hidden font-body text-xs text-cream/80 md:block">
            Photography by {siteConfig.photographer.name}
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Standfirst: the approved hero copy set as a large-serif intro,      */}
      {/* indented to the right of the page like a magazine opener.           */}
      {/* ------------------------------------------------------------------ */}
      <section
        aria-labelledby="intro-title"
        className="mx-auto max-w-[90rem] px-[clamp(1.25rem,5vw,4rem)] py-[var(--space-section)]"
      >
        <Reveal>
          <h2
            id="intro-title"
            className="compa-title max-w-[16ch] font-display text-[length:var(--text-display)] text-ink"
          >
            {INTRO_TITLE}
          </h2>
        </Reveal>
        <div className="md:grid md:grid-cols-12 md:gap-x-8 lg:gap-x-12">
          <Reveal delayMs={140} className="mt-10 md:col-span-8 md:col-start-5 md:mt-14 lg:col-span-7 lg:col-start-6">
            <div aria-hidden="true" className="h-px w-16 bg-coral" />
            <p className="compa-intro mt-6 max-w-[34ch] font-display text-ink">
              {siteConfig.voice.heroBody}
            </p>
            <div className="mt-10 flex flex-wrap gap-x-10 gap-y-4">
              <EditorialLink href="/photos">Find your photos</EditorialLink>
              <EditorialLink href="/weekend">Browse the weekend</EditorialLink>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Chapter 01, inset: the welcome party. The 6:00 PM marker (a real    */}
      {/* time from siteConfig.weekend) overlaps the plate's top corner.      */}
      {/* ------------------------------------------------------------------ */}
      <section
        id="coast"
        aria-labelledby="coast-title"
        className="mx-auto max-w-[90rem] scroll-mt-24 px-[clamp(1.25rem,5vw,4rem)] pb-[var(--space-section)]"
      >
        <RunningHead no="No. 01" kicker={CHAPTERS.coast.kicker} />
        <div className="mt-6 md:grid md:grid-cols-12 md:grid-rows-[auto_1fr] md:gap-x-8 lg:gap-x-12">
          <Reveal
            y={16}
            className="relative z-10 md:col-span-7 md:col-start-6 md:row-start-1 md:translate-y-8"
          >
            <p className="compa-time compa-time-lg whitespace-nowrap font-display text-ink">
              6:00 PM
            </p>
          </Reveal>
          <Reveal
            delayMs={140}
            className="mt-5 md:col-span-7 md:col-start-1 md:row-span-2 md:row-start-1 md:mt-12"
          >
            <StoryImage
              photo={chapters.coast}
              className="aspect-[4/3] w-full object-cover"
            />
          </Reveal>
          <Reveal
            delayMs={260}
            className="mt-8 md:col-span-4 md:col-start-9 md:row-start-2 md:mt-0 md:self-center"
          >
            <h2
              id="coast-title"
              className="compa-title font-display text-3xl text-ink sm:text-4xl"
            >
              {CHAPTERS.coast.title}
            </h2>
            <p className="mt-4 max-w-[36rem] font-body text-base leading-relaxed text-ink">
              {CHAPTERS.coast.body}
            </p>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Chapter 02, full-bleed: the ceremony plate is nearly all sky, so    */}
      {/* the typography moves into the sky. Ink on pale sky holds contrast;  */}
      {/* the focal crop keeps the guests on the bluff in frame.              */}
      {/* ------------------------------------------------------------------ */}
      <section id="ceremony" aria-labelledby="ceremony-title" className="relative scroll-mt-24">
        <StoryImage
          photo={chapters.ceremony}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="relative z-10 mx-auto flex h-[92svh] max-h-[62.5rem] min-h-[560px] w-full max-w-[90rem] flex-col px-[clamp(1.25rem,5vw,4rem)] pt-6">
          <div className="flex items-baseline justify-between gap-4 border-t border-ink/30 pt-3 font-body text-[0.6875rem] uppercase tracking-[0.25em] text-ink/80">
            <span className="whitespace-nowrap">No. 02</span>
            <span className="text-right">{CHAPTERS.ceremony.kicker}</span>
          </div>
          <Reveal y={20} className="mt-[9svh] text-center">
            <p className="compa-time compa-time-xl whitespace-nowrap font-display text-ink">
              4:30 PM
            </p>
            <h2
              id="ceremony-title"
              className="compa-title mt-6 font-display text-3xl text-ink sm:text-4xl"
            >
              {CHAPTERS.ceremony.title}
            </h2>
            <p className="mx-auto mt-5 max-w-md font-body text-base leading-relaxed text-ink">
              {CHAPTERS.ceremony.body}
            </p>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Chapter 03, inset reversed: the plate bleeds to the right edge of   */}
      {/* the container while the text keeps its generous cream margin.       */}
      {/* ------------------------------------------------------------------ */}
      <section
        id="dinner"
        aria-labelledby="dinner-title"
        className="mx-auto max-w-[90rem] scroll-mt-24 px-[clamp(1.25rem,5vw,4rem)] py-[var(--space-section)] md:pr-0"
      >
        <div className="md:pr-[clamp(1.25rem,5vw,4rem)]">
          <RunningHead no="No. 03" kicker={CHAPTERS.dinner.kicker} />
        </div>
        <div className="mt-6 md:grid md:grid-cols-12 md:gap-x-8 lg:gap-x-12">
          <Reveal className="md:col-span-4 md:self-center">
            <div aria-hidden="true" className="h-px w-16 bg-coral" />
            <h2
              id="dinner-title"
              className="compa-title mt-5 font-display text-3xl text-ink sm:text-4xl"
            >
              {CHAPTERS.dinner.title}
            </h2>
            <p className="mt-4 max-w-[36rem] font-body text-base leading-relaxed text-ink">
              {CHAPTERS.dinner.body}
            </p>
          </Reveal>
          <Reveal delayMs={160} className="mt-8 md:col-span-7 md:col-start-6 md:mt-0">
            <StoryImage
              photo={chapters.dinner}
              className="aspect-[3/2] w-full object-cover"
            />
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Night section: the album turns to ink for the dusk and after-dark  */}
      {/* chapters. Chapter 04 is a tipped-in plate; the oversized italic     */}
      {/* words are decorative (the running head carries the same words).     */}
      {/* ------------------------------------------------------------------ */}
      <section id="dancing" aria-labelledby="dancing-title" className="scroll-mt-24 bg-ink text-cream">
        <div className="mx-auto max-w-[90rem] px-[clamp(1.25rem,5vw,4rem)] py-[var(--space-section)]">
          <RunningHead dark no="No. 04" kicker={CHAPTERS.dancing.kicker} />
          <div className="mt-10 md:grid md:grid-cols-12 md:gap-x-8 lg:gap-x-12">
            <Reveal y={16} className="relative z-10 text-center md:col-span-12">
              <p aria-hidden="true" className="compa-night font-display text-wheat">
                {CHAPTERS.dancing.kicker}
              </p>
            </Reveal>
            <Reveal
              delayMs={140}
              className="mx-auto -mt-4 w-3/4 sm:w-3/5 md:col-span-4 md:col-start-3 md:-mt-8 md:w-full"
            >
              <StoryImage photo={chapters.dancing} className="w-full object-cover" />
            </Reveal>
            <Reveal delayMs={260} className="mt-10 md:col-span-4 md:col-start-8 md:mt-0 md:self-center">
              <h2
                id="dancing-title"
                className="compa-title font-display text-3xl text-cream sm:text-4xl"
              >
                {CHAPTERS.dancing.title}
              </h2>
              <p className="mt-4 max-w-[36rem] font-body text-base leading-relaxed text-cream/85">
                {CHAPTERS.dancing.body}
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Chapter 05, still in ink: the 10:30 PM marker (a real time from     */}
      {/* siteConfig.weekend) leads, the flash-lit plate answers.             */}
      {/* ------------------------------------------------------------------ */}
      <section
        id="after-party"
        aria-labelledby="after-party-title"
        className="scroll-mt-24 bg-ink text-cream"
      >
        <div className="mx-auto max-w-[90rem] px-[clamp(1.25rem,5vw,4rem)] pb-[var(--space-section)]">
          <RunningHead dark no="No. 05" kicker={CHAPTERS.afterParty.kicker} />
          <div className="mt-10 md:grid md:grid-cols-12 md:gap-x-8 lg:gap-x-12">
            <Reveal className="md:col-span-6 md:self-center">
              <p className="compa-time compa-time-lg whitespace-nowrap font-display text-cream">
                10:30 PM
              </p>
              <h2
                id="after-party-title"
                className="compa-title mt-8 font-display text-3xl text-cream sm:text-4xl"
              >
                {CHAPTERS.afterParty.title}
              </h2>
              <p className="mt-4 max-w-[34rem] font-body text-base leading-relaxed text-cream/85">
                {CHAPTERS.afterParty.body}
              </p>
            </Reveal>
            <Reveal delayMs={180} className="mt-10 md:col-span-4 md:col-start-8 md:mt-0">
              <StoryImage photo={chapters["after-party"]} className="w-full object-cover" />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Contents page: the living parts of the site as an annotated index.  */}
      {/* Titles come from siteConfig.navigation; bodies are the approved     */}
      {/* intro copy from each destination.                                   */}
      {/* ------------------------------------------------------------------ */}
      <section
        aria-labelledby="contents-title"
        className="mx-auto max-w-[90rem] px-[clamp(1.25rem,5vw,4rem)] py-[var(--space-section)]"
      >
        <Reveal>
          <h2
            id="contents-title"
            className="compa-title max-w-[16ch] font-display text-[length:var(--text-display)] text-ink"
          >
            {CONTENTS_TITLE}
          </h2>
        </Reveal>
        <ul className="mt-10 border-b border-ink/20">
          {contents.map((row, index) => (
            <Reveal as="li" key={row.href} delayMs={index * 90} y={16}>
              <Link
                href={row.href}
                className="group grid min-h-16 grid-cols-[3rem_1fr_auto] items-start gap-x-4 border-t border-ink/20 py-6 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink sm:gap-x-8"
              >
                <span className="pt-1 font-display text-lg italic text-muted">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <span className="compa-title block font-display text-2xl text-ink sm:text-3xl">
                    {navLabel(row.href)}
                  </span>
                  <span className="mt-2 block max-w-[40rem] font-body text-sm leading-relaxed text-muted">
                    {row.body}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="justify-self-end pt-1 font-body text-xl text-ink motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-safe:group-hover:translate-x-2"
                >
                  &rarr;
                </span>
              </Link>
            </Reveal>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Colophon: thick-thin rule, names, date, credit. Print, closed.      */}
      {/* ------------------------------------------------------------------ */}
      <footer className="mx-auto max-w-[90rem] px-[clamp(1.25rem,5vw,4rem)] pb-16">
        <div aria-hidden="true" className="border-t-2 border-ink" />
        <div aria-hidden="true" className="mt-1 border-t border-ink/30" />
        <div className="mt-8 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-display text-2xl text-ink">
              {siteConfig.names.primary}
              <span aria-hidden="true"> &amp; </span>
              <span className="sr-only"> and </span>
              {siteConfig.names.secondary}
            </p>
            <p className="mt-2 font-body text-sm text-ink">{siteConfig.voice.eyebrow}</p>
            <p className="mt-1 font-body text-sm italic text-ink">{MADE_WITH_LOVE}</p>
          </div>
          <p className="font-body text-xs text-ink">
            Photography by{" "}
            {siteConfig.photographer.websiteUrl ? (
              <Link
                href={siteConfig.photographer.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
              >
                {siteConfig.photographer.name}
              </Link>
            ) : (
              siteConfig.photographer.name
            )}
            {siteConfig.photographer.instagramUrl && (
              <>
                {" "}
                ·{" "}
                <Link
                  href={siteConfig.photographer.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
                >
                  Instagram
                </Link>
              </>
            )}
          </p>
        </div>
      </footer>

      {/* Variant-local type treatments: Fraunces variable axes (opsz, SOFT,
          WONK loaded in Wordmark.tsx). Scoped compa- classes; comp only. */}
      <style>{`
        .compa-masthead {
          font-variation-settings: "opsz" 40;
          letter-spacing: -0.01em;
        }
        .compa-names {
          font-size: clamp(3.5rem, 12vw, 9rem);
          line-height: 0.9;
          letter-spacing: -0.02em;
          font-weight: 480;
          font-variation-settings: "opsz" 144;
        }
        .compa-amp {
          font-style: italic;
          font-weight: 400;
          font-variation-settings: "opsz" 144, "SOFT" 100, "WONK" 1;
        }
        .compa-date {
          font-size: clamp(1.375rem, 2.6vw, 2.125rem);
          font-style: italic;
          font-weight: 420;
          font-variation-settings: "opsz" 60, "SOFT" 50;
        }
        .compa-time {
          line-height: 0.95;
          font-weight: 330;
          letter-spacing: -0.015em;
          font-variation-settings: "opsz" 144;
        }
        .compa-time-xl {
          font-size: clamp(4rem, 13vw, 10.5rem);
        }
        .compa-time-lg {
          font-size: clamp(3rem, 7.5vw, 6.75rem);
        }
        .compa-night {
          font-size: clamp(2.5rem, 7vw, 5.5rem);
          font-style: italic;
          font-weight: 380;
          line-height: 1;
          font-variation-settings: "opsz" 144, "SOFT" 100, "WONK" 1;
        }
        .compa-title {
          font-weight: 500;
          line-height: 1.08;
          font-variation-settings: "opsz" 40;
        }
        .compa-intro {
          font-size: clamp(1.375rem, 2.4vw, 1.875rem);
          font-weight: 420;
          line-height: 1.35;
          font-variation-settings: "opsz" 28, "SOFT" 30;
        }
      `}</style>
    </>
  );
}
