import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import { getGalleryFacets } from "@/lib/gallery/query";
import { featureFlags } from "@/content/features";
import { MyWeekendClient } from "@/components/personalization/MyWeekendClient";
import faceThumbnails from "@/generated/face-thumbnails.json";
import { MomentSearch } from "@/components/search/MomentSearch";

/*
 * Which guests have a built face crop. Read here, in an authenticated server
 * component, and passed down as props: importing the manifest inside the
 * "use client" PersonPicker compiled every guest's name slug and confidence
 * score into a /_next/static chunk, and src/proxy.ts serves that path without
 * authentication. Guest identities must only travel through gated data.
 */
const FACE_SLUGS: readonly string[] = Object.keys(faceThumbnails.people);

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
      <header className="atlas-page-bar">
        <h1>Find me</h1>
        <p className="atlas-page-bar-note">
          Choose your name to open the photos you are in. Your selection
          stays private on this device.
        </p>
      </header>

      <div className="atlas-guest-body">
        <MyWeekendClient
          people={facets.people}
          faceSlugs={FACE_SLUGS}
        />
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
