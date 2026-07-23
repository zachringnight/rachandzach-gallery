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
    <section className="mx-auto max-w-7xl px-4 pt-8 pb-16 sm:px-6">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-wider text-muted">Just for you</p>
        <h1 className="mt-1 font-display text-3xl text-ink sm:text-4xl">My Weekend</h1>
        <p className="mt-3 text-ink/70">
          Tell us who you are and we will gather every photo of {siteConfig.names.primary}{" "}
          and {siteConfig.names.secondary}&rsquo;s weekend that includes you.
        </p>
      </header>

      <div className="mt-8">
        <MyWeekendClient people={facets.people} />
      </div>

      {featureFlags.momentSearch ? (
        <div className="mt-16 border-t border-wheat pt-10">
          <p className="text-xs uppercase tracking-wider text-muted">Beta</p>
          <h2 className="mt-1 font-display text-2xl text-ink">Search for a moment</h2>
          <div className="mt-4">
            <MomentSearch events={facets.events} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
