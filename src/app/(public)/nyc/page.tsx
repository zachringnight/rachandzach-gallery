import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, Heart, MoveRight } from "lucide-react";

import { Reveal } from "@/components/motion/Reveal";
import { DaysRemaining } from "@/components/nyc/DaysRemaining";
import { FollowTheRun } from "@/components/nyc/FollowTheRun";
import { FundraiserProgress } from "@/components/nyc/FundraiserProgress";
import { Supporters } from "@/components/nyc/Supporters";
import { PublicShell } from "@/components/site/PublicShell";
import {
  hasSupporters,
  nycFundraiser,
  nycRaceDay,
} from "@/content/nyc";
import { SITE_ORIGIN } from "@/lib/redirects";

const { photo, shareImage } = nycFundraiser;

/**
 * Crawler policy for this page is coupled to the supporters wall.
 *
 * While the wall is off, /nyc is an ordinary public fundraiser page and should
 * be findable. The moment Rachel approves the wall, this page starts carrying
 * 46 named people and the personal notes they wrote her, and that should not
 * be indexable under this domain. Deriving both from hasSupporters() means the
 * two can never drift apart: you cannot turn the names on and leave the page
 * indexed.
 *
 * src/app/sitemap.ts reads the same hasSupporters() and drops /nyc from the
 * sitemap whenever this page goes noindex, so the sitemap and the robots tag
 * cannot contradict each other. Change one and change the other.
 */
const supportersVisible = hasSupporters();

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: "Rach Runs NYC | Rach & Zach",
  description:
    "Rachel is running the 2026 TCS New York City Marathon with NYRR Team for Kids. Read her story and back her before donations close.",
  alternates: {
    canonical: "/nyc",
  },
  robots: supportersVisible
    ? { index: false, follow: true }
    : { index: true, follow: true },
  // This page's whole job is to be sent to people. A bare link preview was
  // costing it the photograph and the ask, so both are declared here.
  openGraph: {
    type: "article",
    url: "/nyc",
    siteName: "Rach & Zach",
    title: "Rach runs New York: 26.2 miles for brighter futures",
    description:
      "Rachel is running the 2026 TCS New York City Marathon for NYRR Team for Kids. Read her story and back her before donations close.",
    images: [
      {
        url: shareImage.src,
        width: shareImage.width,
        height: shareImage.height,
        alt: shareImage.alt,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Rach runs New York: 26.2 miles for brighter futures",
    description:
      "Rachel is running the 2026 TCS New York City Marathon for NYRR Team for Kids.",
    images: [shareImage.src],
  },
};

export default function NycPage() {
  return (
    <PublicShell>
      <article className="atlas-nyc">
        <section className="atlas-nyc-hero" aria-labelledby="nyc-title">
          <Reveal className="atlas-nyc-hero-copy">
            <p className="atlas-kicker">
              Rach runs New York · {nycFundraiser.charityFullName}
            </p>
            <h1 id="nyc-title">
              26.2 miles
              <span>for brighter futures.</span>
            </h1>
            {/* Present and future tense throughout: the race has not happened
                yet, so nothing on this page may read as a recap. */}
            <p className="atlas-nyc-deck">
              In November, Rachel is running the New York City Marathon for
              Team for Kids, so that more young people get to find out what
              running can open up. She is raising money for it now.
            </p>
            <div className="atlas-nyc-hero-actions">
              <Link
                className="atlas-primary-link"
                href={nycFundraiser.donationUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Donate to her run
                <ArrowUpRight aria-hidden="true" size={16} />
              </Link>
              <a className="atlas-text-link" href="#rachels-story">
                Read Rachel&rsquo;s story
                <ArrowDown aria-hidden="true" size={15} />
              </a>
            </div>
          </Reveal>

          <Reveal className="atlas-nyc-hero-photo" delayMs={100}>
            <div className="atlas-nyc-photo-frame">
              <Image
                src={photo.src}
                alt={photo.alt}
                fill
                priority
                sizes="(max-width: 760px) 100vw, 54vw"
              />
              <span aria-hidden="true" className="atlas-nyc-photo-index">
                26.2 MI
              </span>
            </div>
            <p>
              <span>{photo.caption}</span>
              <span>{photo.captionMeta}</span>
            </p>
          </Reveal>

          <Reveal className="atlas-nyc-progress-card" delayMs={180}>
            <FundraiserProgress />
          </Reveal>
        </section>

        {/* Race facts. The page previously carried no date anywhere, so it
            read as an open-ended appeal rather than a run with a start line on
            a specific Sunday. Race day and the donation deadline are labelled
            separately on purpose: they are 25 days apart and a reader will
            otherwise assume the deadline is race day. */}
        <Reveal as="section" className="atlas-nyc-facts" aria-label="Race details">
          <dl>
            <div>
              <dt>The race</dt>
              <dd>
                <Link
                  href={nycFundraiser.raceInfoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {nycFundraiser.raceName}
                  <ArrowUpRight aria-hidden="true" size={13} />
                </Link>
              </dd>
            </div>
            <div>
              <dt>Race day</dt>
              <dd>
                <time dateTime={nycRaceDay.iso}>{nycRaceDay.label}</time>
                <DaysRemaining
                  iso={nycRaceDay.iso}
                  closedLabel="She ran it"
                  className="atlas-nyc-fact-countdown"
                />
              </dd>
            </div>
            <div>
              <dt>Course</dt>
              <dd>{nycFundraiser.course}</dd>
            </div>
            <div>
              <dt>Running for</dt>
              <dd>{nycFundraiser.charityFullName}</dd>
            </div>
          </dl>
        </Reveal>

        <section
          id="rachels-story"
          className="atlas-nyc-story"
          aria-labelledby="nyc-story-title"
        >
          <Reveal className="atlas-nyc-story-label">
            <p className="atlas-kicker">In Rachel&rsquo;s words</p>
            <span aria-hidden="true">01</span>
          </Reveal>
          <div className="atlas-nyc-story-copy">
            <Reveal>
              <h2 id="nyc-story-title">
                Running has carried me through. Now I get to give some of that
                back.
              </h2>
            </Reveal>
            {/* Verbatim from her NYRR story, not a paraphrase. See the
                pullQuote comment in src/content/nyc.ts. */}
            <Reveal>
              <blockquote className="atlas-nyc-pullquote">
                <p>{nycFundraiser.pullQuote}</p>
              </blockquote>
            </Reveal>
            {nycFundraiser.story.map((paragraph, index) => (
              <Reveal key={paragraph} delayMs={Math.min(index * 70, 140)}>
                <p>{paragraph}</p>
              </Reveal>
            ))}
            <Reveal className="atlas-nyc-signoff">
              <Heart aria-hidden="true" size={18} strokeWidth={1.4} />
              <p>{nycFundraiser.signoff}</p>
            </Reveal>
            <Reveal>
              <p className="atlas-nyc-footnote">{nycFundraiser.footnote}</p>
            </Reveal>
          </div>
        </section>

        <section className="atlas-nyc-impact" aria-labelledby="nyc-impact-title">
          <Reveal className="atlas-nyc-impact-heading">
            <div className="atlas-nyc-section-label">
              <p className="atlas-kicker">Why {nycFundraiser.charityName}</p>
              <span aria-hidden="true">02</span>
            </div>
            <h2 id="nyc-impact-title">Every mile can move a life forward.</h2>
          </Reveal>

          <Reveal className="atlas-nyc-cause">
            <p>{nycFundraiser.charityBlurb}</p>
            <Link
              className="atlas-nyc-inline-link"
              href={nycFundraiser.impactReportUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              See where the money goes: NYRR&rsquo;s impact report
              <ArrowUpRight aria-hidden="true" size={14} />
            </Link>
          </Reveal>

          <div className="atlas-nyc-impact-stats">
            {nycFundraiser.impactStats.map((stat, index) => (
              <Reveal key={stat.label} delayMs={index * 70}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </Reveal>
            ))}
          </div>
          <Reveal className="atlas-nyc-impact-cta">
            <p>
              Help more kids build healthy habits, confidence, and brighter
              futures through running. {nycFundraiser.taxNote}
            </p>
            <Link
              className="atlas-primary-link"
              href={nycFundraiser.donationUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Support Rachel&rsquo;s run
              <MoveRight aria-hidden="true" size={17} />
            </Link>
          </Reveal>
        </section>

        <FollowTheRun />

        <Supporters />
      </article>
    </PublicShell>
  );
}
