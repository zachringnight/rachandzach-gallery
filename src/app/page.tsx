import type { Metadata } from "next";
import Link from "next/link";

import { FeaturePortal } from "@/components/site/FeaturePortal";
import { Hero } from "@/components/site/Hero";
import { PhotoMarquee } from "@/components/site/PhotoMarquee";
import { PublicShell } from "@/components/site/PublicShell";
import { StoryChapter } from "@/components/site/StoryChapter";
import { siteConfig } from "@/content/site";
import { storyPhotos } from "@/content/story-photos";

export const metadata: Metadata = {
  title: "Rach & Zach | Santa Barbara Wedding",
  description:
    "Rachel and Zach's wedding weekend in Santa Barbara, California, July 19, 2025: the story, the photos, and the people we love.",
};

/**
 * The post-wedding home. Five chapters walk the day from the coast to the
 * after party; the portals below open the living parts of the site.
 */
export default function HomePage() {
  const { chapters } = storyPhotos;
  return (
    <PublicShell>
      <Hero />

      <StoryChapter
        id="coast"
        kicker="Friday evening · Hotel Californian"
        title="It started by the water"
        body="The weekend eased in with dinner and drinks by the coast, no seating chart, no schedule, just everyone arriving hungry and thirsty the way we asked."
        photo={chapters.coast}
      />
      <StoryChapter
        id="ceremony"
        kicker="Saturday, 4:30 PM · Rincon Pergola"
        title="The ceremony"
        body="Outdoors, with Santa Barbara views in every direction and the people we love most in the seats."
        photo={chapters.ceremony}
        reverse
      />
      <StoryChapter
        id="dinner"
        kicker="Saturday evening"
        title="Dinner"
        body="Cocktail hour rolled into dinner, and dinner rolled into a party that carried the reception all the way to 10:00 PM."
        photo={chapters.dinner}
      />
      <StoryChapter
        id="dancing"
        kicker="Saturday night"
        title="The dance floor"
        body="Coastal views, happy tears, and plenty of dance floor evidence. It is all in the gallery."
        photo={chapters.dancing}
        reverse
      />
      <StoryChapter
        id="after-party"
        kicker="Saturday, 10:30 PM · Studio Sound Room"
        title="The after party"
        body="When Santa Barbara's sound ordinances kicked in at 10 PM, the celebration moved to a beach bungalow bar in the Funk Zone and kept going past midnight."
        photo={chapters["after-party"]}
      />

      <PhotoMarquee photos={Object.values(chapters)} />

      <section aria-labelledby="portals-title" className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <h2 id="portals-title" className="font-display text-3xl text-ink">
          Keep the weekend going
        </h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
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
        <p className="mt-10 font-body text-base text-muted">
          Want the whole story in order?{" "}
          <Link
            href="/weekend"
            className="font-medium text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            Walk through the weekend
          </Link>
          .
        </p>
      </section>
    </PublicShell>
  );
}
