import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, Heart, MoveRight } from "lucide-react";
import type { CSSProperties } from "react";

import { Reveal } from "@/components/motion/Reveal";
import { PublicShell } from "@/components/site/PublicShell";
import {
  fundraiserProgressPercent,
  nycFundraiser,
} from "@/content/nyc";

export const metadata: Metadata = {
  title: "Rach Runs NYC | Rach & Zach",
  description:
    "Rachel is running the 2026 TCS New York City Marathon with Team for Kids. Read her story and support the run.",
  alternates: {
    canonical: "/nyc",
  },
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default function NycPage() {
  const { progress } = nycFundraiser;
  const percent = fundraiserProgressPercent(progress.raised, progress.goal);

  return (
    <PublicShell>
      <article className="atlas-nyc">
        <section className="atlas-nyc-hero" aria-labelledby="nyc-title">
          <Reveal className="atlas-nyc-hero-copy">
            <p className="atlas-kicker">Rach runs New York · 2026</p>
            <h1 id="nyc-title">
              26.2 miles
              <span>for brighter futures.</span>
            </h1>
            <p className="atlas-nyc-deck">
              Rachel is running the New York City Marathon with Team for Kids,
              helping more young people discover what running can open up.
            </p>
            <div className="atlas-nyc-hero-actions">
              <Link
                className="atlas-primary-link"
                href={nycFundraiser.donationUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Donate on NYRR
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
                src={nycFundraiser.photo.src}
                alt={nycFundraiser.photo.alt}
                fill
                priority
                sizes="(max-width: 760px) 100vw, 54vw"
              />
              <span aria-hidden="true" className="atlas-nyc-photo-index">
                NYC / 26.2
              </span>
            </div>
            <p>
              <span>Running toward something bigger.</span>
              <span>New York City · 2026</span>
            </p>
          </Reveal>

          <Reveal className="atlas-nyc-progress-card" delayMs={180}>
            <div className="atlas-nyc-progress-heading">
              <span>Fundraising progress</span>
              <strong>{percent}%</strong>
            </div>
            <div
              className="atlas-nyc-progress-track"
              role="progressbar"
              aria-label="Fundraising progress"
              aria-valuemin={0}
              aria-valuemax={progress.goal}
              aria-valuenow={progress.raised}
              aria-valuetext={`${usd.format(progress.raised)} raised of ${usd.format(progress.goal)}`}
            >
              <span style={{ "--atlas-progress": `${percent}%` } as CSSProperties} />
            </div>
            <div className="atlas-nyc-progress-numbers">
              <p>
                <strong>{usd.format(progress.raised)}</strong>
                <span>raised</span>
              </p>
              <p>
                <strong>{usd.format(progress.goal)}</strong>
                <span>goal</span>
              </p>
            </div>
            <p className="atlas-nyc-progress-note">
              Snapshot verified {progress.verifiedOn}.{" "}
              <Link
                href={nycFundraiser.fundraiserUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                See live progress
                <ArrowUpRight aria-hidden="true" size={12} />
              </Link>
            </p>
          </Reveal>
        </section>

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
            {nycFundraiser.story.map((paragraph, index) => (
              <Reveal key={paragraph} delayMs={Math.min(index * 70, 140)}>
                <p>{paragraph}</p>
                {index === 0 && (
                  <Link
                    className="atlas-nyc-inline-link"
                    href={nycFundraiser.impactReportUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Read the full Team for Kids impact report
                    <ArrowUpRight aria-hidden="true" size={14} />
                  </Link>
                )}
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
            <p className="atlas-kicker">Why Team for Kids</p>
            <h2 id="nyc-impact-title">Every mile can move a life forward.</h2>
          </Reveal>
          <div className="atlas-nyc-impact-stats">
            <Reveal>
              <strong>$120M+</strong>
              <span>raised by Team for Kids</span>
            </Reveal>
            <Reveal delayMs={70}>
              <strong>2.5M</strong>
              <span>students served</span>
            </Reveal>
            <Reveal delayMs={140}>
              <strong>26.2</strong>
              <span>miles through New York</span>
            </Reveal>
          </div>
          <Reveal className="atlas-nyc-impact-cta">
            <p>
              Help more kids build healthy habits, confidence, and brighter
              futures through running.
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
      </article>
    </PublicShell>
  );
}
