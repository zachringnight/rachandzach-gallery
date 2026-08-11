import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  CloudDownload,
  Heart,
  Search,
  UserRoundSearch,
} from "lucide-react";

import { Reveal } from "@/components/motion/Reveal";
import { Hero } from "@/components/site/Hero";
import { PublicShell } from "@/components/site/PublicShell";
import { siteConfig } from "@/content/site";
import { storyPhotos } from "@/content/story-photos";

export const metadata: Metadata = {
  title: "Private Photo Archive | Rach & Zach · Santa Barbara",
  description:
    "Find your photos, keep a private shortlist, and save Rachel and Zach's original photos wherever you keep them.",
};

const archiveUtilities = [
  {
    number: "01",
    title: "Find your photos",
    body: "Choose your name to open your confirmed collection.",
    href: "/my-weekend",
    linkLabel: "Find me",
    icon: UserRoundSearch,
  },
  {
    number: "02",
    title: "Search any moment",
    body: "Search by person, event, source, or orientation.",
    href: "/photos",
    linkLabel: "Search photos",
    icon: Search,
  },
  {
    number: "03",
    title: "Keep a shortlist",
    body: "Favorites stay private and are ready whenever you return.",
    href: "/favorites",
    linkLabel: "Open favorites",
    icon: Heart,
  },
  {
    number: "04",
    title: "Take the originals with you",
    body: "Download a selection or save it to your own Google Drive or Dropbox.",
    href: "/photos",
    linkLabel: "Choose photos",
    icon: CloudDownload,
  },
] as const;

const utilityPhotos = [
  storyPhotos.chapters.coast,
  storyPhotos.chapters.dinner,
  storyPhotos.chapters.ceremony,
  storyPhotos.chapters.dancing,
];

export default function HomePage() {
  return (
    <PublicShell>
      <Hero />

      <section className="archive-utility" aria-labelledby="archive-utility-title">
        <Reveal className="archive-utility-heading">
          <div>
            <p className="atlas-kicker">Made to use</p>
            <h2 id="archive-utility-title">A private archive that works for you.</h2>
          </div>
          <p>
            Start with your name or search the whole collection. Keep the
            photos you want, then move the originals to the place you
            already trust.
          </p>
        </Reveal>

        <div className="archive-utility-layout">
          <div className="archive-utility-list">
            {archiveUtilities.map((utility, index) => {
              const Icon = utility.icon;
              return (
                <Reveal
                  as="article"
                  className="archive-utility-row"
                  delayMs={Math.min(index * 60, 180)}
                  key={utility.number}
                >
                  <span>{utility.number}</span>
                  <Icon aria-hidden="true" size={26} strokeWidth={1.2} />
                  <div>
                    <h3>{utility.title}</h3>
                    <p>{utility.body}</p>
                  </div>
                  <Link href={utility.href}>
                    {utility.linkLabel}
                    <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.5} />
                  </Link>
                </Reveal>
              );
            })}
          </div>

          <Reveal className="archive-photo-study" delayMs={100}>
            <div aria-hidden="true" className="archive-photo-study-grid">
              {utilityPhotos.map((photo) => (
                <figure key={photo.id}>
                  <img
                    src={photo.src}
                    alt=""
                    width={photo.width}
                    height={photo.height}
                    loading="lazy"
                    decoding="async"
                  />
                </figure>
              ))}
            </div>
            <p>
              <span>Selected from the private archive</span>
              {/* Was "available after sign-in" until the password gate was
                  removed (2026-08-09). There is no sign-in to wait for. */}
              <span>Original quality on every download</span>
            </p>
          </Reveal>
        </div>
      </section>

      <section className="archive-forward" aria-labelledby="archive-forward-title">
        <Reveal className="archive-forward-heading">
          <p className="atlas-kicker">What comes next</p>
          <h2 id="archive-forward-title">The archive stays useful.</h2>
          <p>
            Add what only you have, come back for the photos you need,
            and follow the next chapter taking shape.
          </p>
        </Reveal>

        <div className="archive-forward-links">
          <Reveal as="article">
            <span>01 / CONTRIBUTE</span>
            <h3>Add your point of view.</h3>
            <p>{siteConfig.voice.uploadIntro}</p>
            <Link href="/add-yours">
              Add photos
              <ArrowUpRight aria-hidden="true" size={15} strokeWidth={1.5} />
            </Link>
          </Reveal>
          <Reveal as="article" delayMs={80}>
            <span>02 / FOLLOW</span>
            <h3>Rach runs New York.</h3>
            <p>
              Follow Rachel&rsquo;s road to 26.2 and support Team for Kids.
            </p>
            <Link href="/nyc">
              Follow the run
              <ArrowUpRight aria-hidden="true" size={15} strokeWidth={1.5} />
            </Link>
          </Reveal>
        </div>
      </section>
    </PublicShell>
  );
}
