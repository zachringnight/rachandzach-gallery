import type { Metadata } from "next";
import Link from "next/link";
import { Heart, Images, Search, Upload } from "lucide-react";

import { AtlasExplorer, type AtlasMoment } from "@/components/site/AtlasExplorer";
import { FeaturePortal } from "@/components/site/FeaturePortal";
import { Hero } from "@/components/site/Hero";
import { PhotoMarquee } from "@/components/site/PhotoMarquee";
import { PublicShell } from "@/components/site/PublicShell";
import { StoryChapter } from "@/components/site/StoryChapter";
import { Reveal } from "@/components/motion/Reveal";
import { siteConfig } from "@/content/site";
import { storyPhotos } from "@/content/story-photos";

export const metadata: Metadata = {
  title: "Santa Barbara Wedding | Rach & Zach",
  description:
    "Rachel and Zach's wedding weekend in Santa Barbara, California, July 19, 2025: the story, the photos, and the people we love.",
};

/**
 * The post-wedding home. Five chapters walk the day from the coast to the
 * after party; the portals below open the living parts of the site.
 */
export default function HomePage() {
  const { chapters } = storyPhotos;
  const moments: AtlasMoment[] = [
    {
      id: "coast",
      number: "01",
      kicker: "Friday evening · Hotel Californian",
      title: "By the water",
      body:
        "The weekend eased in with dinner and drinks by the coast, no seating chart, no schedule, just everyone arriving hungry and thirsty the way we asked.",
      photo: chapters.coast,
    },
    {
      id: "ceremony",
      number: "02",
      kicker: "Saturday, 4:30 PM · Rincon Pergola",
      title: "The ceremony",
      body:
        "Outdoors, with Santa Barbara views in every direction and the people we love most in the seats.",
      photo: chapters.ceremony,
    },
    {
      id: "dinner",
      number: "03",
      kicker: "Saturday evening",
      title: "Golden hour",
      body:
        "Cocktail hour rolled into dinner, and dinner rolled into a party that carried the reception all the way to 10:00 PM.",
      photo: chapters.dinner,
    },
    {
      id: "dancing",
      number: "04",
      kicker: "Saturday night",
      title: "The dance floor",
      body:
        "Coastal views, happy tears, and plenty of dance floor evidence. It is all in the gallery.",
      photo: chapters.dancing,
    },
    {
      id: "after-party",
      number: "05",
      kicker: "Saturday, 10:30 PM · Studio Sound Room",
      title: "After hours",
      body:
        "When Santa Barbara's sound ordinances kicked in at 10 PM, the celebration moved to a beach bungalow bar in the Funk Zone and kept going past midnight.",
      photo: chapters["after-party"],
    },
  ];

  return (
    <PublicShell>
      <Hero />

      <Reveal as="section" className="atlas-introduction" y={30}>
        <p className="atlas-kicker">Still not over it</p>
        <p className="atlas-introduction-statement">
          This is the weekend as we remember it:
          <span> warm, wonderfully full, and made by everyone who showed up.</span>
        </p>
        <div className="atlas-introduction-meta">
          <span>03 days</span>
          <span>01 favorite place</span>
          <span>All of our favorite people</span>
        </div>
      </Reveal>

      <AtlasExplorer moments={moments} />

      <section className="atlas-story-intro" aria-labelledby="story-title">
        <p className="atlas-kicker">The long way through</p>
        <h2 id="story-title">A weekend worth lingering in.</h2>
        <p>
          The big moments, the in-between ones, and the parts we only saw after
          everyone sent us their photos.
        </p>
      </section>

      <StoryChapter
        id="coast"
        number="01"
        kicker="Friday evening · Hotel Californian"
        title="It started by the water"
        body="The weekend eased in with dinner and drinks by the coast, no seating chart, no schedule, just everyone arriving hungry and thirsty the way we asked."
        photo={chapters.coast}
      />
      <StoryChapter
        id="ceremony"
        number="02"
        kicker="Saturday, 4:30 PM · Rincon Pergola"
        title="The ceremony"
        body="Outdoors, with Santa Barbara views in every direction and the people we love most in the seats."
        photo={chapters.ceremony}
        reverse
      />
      <StoryChapter
        id="dinner"
        number="03"
        kicker="Saturday evening"
        title="Dinner"
        body="Cocktail hour rolled into dinner, and dinner rolled into a party that carried the reception all the way to 10:00 PM."
        photo={chapters.dinner}
      />
      <StoryChapter
        id="dancing"
        number="04"
        kicker="Saturday night"
        title="The dance floor"
        body="Coastal views, happy tears, and plenty of dance floor evidence. It is all in the gallery."
        photo={chapters.dancing}
        reverse
      />
      <StoryChapter
        id="after-party"
        number="05"
        kicker="Saturday, 10:30 PM · Studio Sound Room"
        title="The after party"
        body="When Santa Barbara's sound ordinances kicked in at 10 PM, the celebration moved to a beach bungalow bar in the Funk Zone and kept going past midnight."
        photo={chapters["after-party"]}
      />

      <PhotoMarquee photos={Object.values(chapters)} />

      <section aria-labelledby="find-title" className="atlas-discovery">
        <div className="atlas-section-heading">
          <div>
            <p className="atlas-kicker">Made personal</p>
            <h2 id="find-title">Find yourself in the weekend.</h2>
          </div>
          <p className="atlas-section-intro">
            Start with your name, wander the full collection, or keep a small
            private set of the photos you never want to lose.
          </p>
        </div>

        <div className="atlas-pathways">
          <Link href="/my-weekend" className="atlas-pathway">
            <span className="atlas-pathway-number">01</span>
            <Search aria-hidden="true" size={24} strokeWidth={1.25} />
            <span>
              <strong>My Weekend</strong>
              <small>Tell us who you are. We will gather the photos that include you.</small>
            </span>
          </Link>
          <Link href="/photos" className="atlas-pathway">
            <span className="atlas-pathway-number">02</span>
            <Images aria-hidden="true" size={24} strokeWidth={1.25} />
            <span>
              <strong>Every photo</strong>
              <small>Filter the full weekend by moment, person, source, or orientation.</small>
            </span>
          </Link>
          <Link href="/favorites" className="atlas-pathway">
            <span className="atlas-pathway-number">03</span>
            <Heart aria-hidden="true" size={24} strokeWidth={1.25} />
            <span>
              <strong>Your favorites</strong>
              <small>Heart the frames you love and keep your own living shortlist.</small>
            </span>
          </Link>
          <Link href="/add-yours" className="atlas-pathway">
            <span className="atlas-pathway-number">04</span>
            <Upload aria-hidden="true" size={24} strokeWidth={1.25} />
            <span>
              <strong>Add yours</strong>
              <small>Bring your camera roll into the story, exactly as you saw it.</small>
            </span>
          </Link>
        </div>
      </section>

      <section aria-labelledby="portals-title" className="atlas-growing">
        <div>
          <p className="atlas-kicker">The collection is still growing</p>
          <h2 id="portals-title">Your camera was there too.</h2>
          <p>{siteConfig.voice.uploadIntro}</p>
        </div>
        <div className="atlas-growing-portal">
          <FeaturePortal
            href="/add-yours"
            title="Add yours"
            body={siteConfig.voice.uploadIntro}
          />
          <FeaturePortal
            flag="playlists"
            href="/playlists"
            title="Playlists"
            body="The weekend's soundtrack, chapter by chapter."
          />
          <FeaturePortal
            flag="marathon"
            href="/marathon"
            title="The Marathon"
            body="The story of Rachel's run, and how to support it."
          />
          <FeaturePortal
            flag="anniversaryCapsule"
            href="/anniversary"
            title="The anniversary capsule"
            body="A time capsule that opens on our first anniversary."
          />
        </div>
        <p className="atlas-growing-footnote">
          Prefer the whole story in order?{" "}
          <Link
            href="/weekend"
          >
            Walk through the weekend
          </Link>
          .
        </p>
      </section>
    </PublicShell>
  );
}
