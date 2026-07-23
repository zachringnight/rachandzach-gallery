import type { Metadata } from "next";
import Link from "next/link";

import { PublicShell } from "@/components/site/PublicShell";
import { StoryChapter } from "@/components/site/StoryChapter";
import { WeekendTimeline } from "@/components/site/WeekendTimeline";
import { siteConfig } from "@/content/site";
import { storyPhotos } from "@/content/story-photos";

export const metadata: Metadata = {
  title: "The Weekend | Rach & Zach",
  description:
    "Welcome party, wedding, after party, and Sunday hang: the full story of Rachel and Zach's Santa Barbara wedding weekend, July 18 to 20, 2025.",
};

/**
 * The chronological visual story of July 18-20, 2025. The timeline carries
 * the schedule facts as memory context; the chapters walk the days in order.
 * The #travel and #faq sections keep the old site's legacy anchors alive.
 */
export default function WeekendPage() {
  const { chapters } = storyPhotos;
  return (
    <PublicShell>
      <header className="atlas-page-hero atlas-weekend-hero">
        <p className="atlas-kicker">
          July 18-20, 2025 · Santa Barbara, CA
        </p>
        <h1>The Weekend</h1>
        <p>
          Three days by the water with everyone we love. Here is how it went,
          in order.
        </p>
        <div className="atlas-page-hero-index" aria-hidden="true">
          <span>03</span>
          <small>days together</small>
        </div>
      </header>

      <section aria-labelledby="glance-title" className="atlas-timeline-section">
        <div className="atlas-section-heading">
          <div>
            <p className="atlas-kicker">Friday to Sunday</p>
            <h2 id="glance-title">The weekend at a glance.</h2>
          </div>
          <p className="atlas-section-intro">
            Every address, every handoff, and the way the celebration kept finding
            one more place to go.
          </p>
        </div>
        <WeekendTimeline events={siteConfig.weekend} />
      </section>

      <StoryChapter
        id="friday"
        number="01"
        kicker="Friday, July 18 · Hotel Californian"
        title="Easing in by the water"
        body="Dinner, drinks, and the weekend finding its feet by the coast, with the best part still a day away."
        photo={chapters.coast}
      />
      <StoryChapter
        id="ceremony"
        number="02"
        kicker="Saturday, 4:30 PM · Rincon Pergola"
        title="The ceremony"
        body="Outdoors, with Santa Barbara views in every direction, exactly as promised."
        photo={chapters.ceremony}
        reverse
      />
      <StoryChapter
        id="dinner"
        number="03"
        kicker="Saturday evening"
        title="Dinner"
        body="Cocktail hour rolled into dinner as the light went golden, and the party ran to 10:00 PM."
        photo={chapters.dinner}
      />
      <StoryChapter
        id="dancing"
        number="04"
        kicker="Saturday night"
        title="The dance floor"
        body="The reception danced until Santa Barbara said it was time, and the night was nowhere near done."
        photo={chapters.dancing}
        reverse
      />
      <StoryChapter
        id="after-party"
        number="05"
        kicker="Saturday, 10:30 PM · Studio Sound Room"
        title="The after party"
        body="The Funk Zone took it from there, and nobody was watching the clock."
        photo={chapters["after-party"]}
      />
      <StoryChapter
        id="sunday"
        number="06"
        kicker="Sunday, 9:00 AM · Municipal Winemakers"
        title="One last hang"
        body="One more coffee, one more pour, and the slow goodbyes before everyone headed home."
      />

      <section
        id="travel"
        aria-labelledby="travel-title"
        className="atlas-info-section atlas-travel-section"
      >
        <div>
          <p className="atlas-kicker">The way there</p>
          <h2 id="travel-title">Getting to Santa Barbara</h2>
        </div>
        <div className="atlas-info-copy">
            <p>
              Everyone made the journey: flights into Santa Barbara Municipal
              Airport or LAX, the two-hour drive up (stunning if you took the
              Pacific Coast Highway), or Amtrak in about two and a half hours.
              We appreciated every mile of it.
            </p>
            <p>
              Most of the weekend lived near the water, around Harbour View Inn
              and Hotel Californian, which sit across the street from one
              another, with everything walkable or a short shuttle away.
            </p>
            <p>
              If you ever get back to Santa Barbara: Dart Coffee Co, Handlebar
              Coffee Roasters, Oat Bakery, Helena Avenue Bakery, Broad Street
              Oyster Company, and Rudy&apos;s are still some of our favorite
              spots, and we 100% recommend sipping wine at the Funk Zone
              tasting rooms.
            </p>
        </div>
      </section>

      <section id="faq" aria-labelledby="faq-title" className="atlas-info-section atlas-faq-section">
        <div>
          <p className="atlas-kicker">For the record</p>
          <h2 id="faq-title">Questions we kept hearing</h2>
        </div>
        <dl className="atlas-faq-list">
            <div>
              <dt>How did everyone get to the wedding?</dt>
              <dd>
                Shuttles, from the Santa Barbara Visitors Center at 120 State
                Street. Everyone rode them, and the views were worth it, just
                like we promised.
              </dd>
            </div>
            <div>
              <dt>What was Santa Barbara cocktail?</dt>
              <dd>
                Light suits, fun dresses, jumpsuits, bow ties, and personality.
                Everyone understood the assignment.
              </dd>
            </div>
            <div>
              <dt>What was the weather plan?</dt>
              <dd>
                The ceremony and reception were outdoors rain or shine, with a
                backup ready and fingers crossed it would not be needed.
              </dd>
            </div>
        </dl>
      </section>

      <section className="atlas-page-cta">
        <div>
          <p>
            {siteConfig.voice.galleryIntro}
          </p>
          <Link
            href="/photos"
            className="atlas-primary-link"
          >
            Find your photos
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
