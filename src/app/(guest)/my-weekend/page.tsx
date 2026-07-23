import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import { getGalleryFacets } from "@/lib/gallery/query";
import { featureFlags } from "@/content/features";
import { siteConfig } from "@/content/site";
import { MyWeekendClient } from "@/components/personalization/MyWeekendClient";
import { MomentSearch } from "@/components/search/MomentSearch";

// Reads the live facet set (people confirmed in the catalog); never static.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My Weekend | Rach & Zach",
  description: "Find your own photos from the wedding weekend, and search for a moment.",
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
          <p className="atlas-kicker">Just for you</p>
          <h1>My Weekend</h1>
        </div>
        <p>
          Tell us who you are and we will gather every photo of {siteConfig.names.primary}{" "}
          and {siteConfig.names.secondary}&rsquo;s weekend that includes you.
        </p>
        <span aria-hidden="true">Find your way back</span>
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
