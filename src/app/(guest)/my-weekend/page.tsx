import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import { getGalleryFacets } from "@/lib/gallery/query";
import { featureFlags } from "@/content/features";
import { MyWeekendClient } from "@/components/personalization/MyWeekendClient";
import { MomentSearch } from "@/components/search/MomentSearch";

// Reads the live facet set (people confirmed in the catalog); never static.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Find Me | Rach & Zach",
  description: "Choose your name to open your private photo collection.",
};

/**
 * Both of this packet's discovery modes live on one route. Task 01's landed
 * navigation (src/content/site.ts, not owned by this packet) already points
 * "My Weekend" at /my-weekend and has no separate entry for Moment Search, so
 * Moment Search is surfaced here as a second section on the same page rather
 * than inventing an unlisted route.
 */
export default async function MyWeekendPage() {
  const client = createAdminClient();
  const source = createSupabaseGalleryDataSource(client);
  const facets = await getGalleryFacets(source);

  return (
    <section className="atlas-guest-page">
      <header className="atlas-guest-header">
        <div>
          <p className="atlas-kicker">Find me</p>
          <h1>Your photos</h1>
        </div>
        <p>
          Choose your name to open the confirmed photographs you are in. Your
          selection stays private and is ready whenever you return.
        </p>
        <span aria-hidden="true">One private collection</span>
      </header>

      <div className="atlas-guest-body">
        <MyWeekendClient people={facets.people} />
      </div>

      {featureFlags.momentSearch ? (
        <div className="atlas-guest-feature">
          <p className="atlas-kicker">Beta</p>
          <h2>Search for a moment</h2>
          <div>
            <MomentSearch events={facets.events} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
