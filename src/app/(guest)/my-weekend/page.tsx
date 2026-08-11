import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import { getGalleryFacets } from "@/lib/gallery/query";
import { featureFlags } from "@/content/features";
import { MyWeekendClient } from "@/components/personalization/MyWeekendClient";
import {
  buildFaceDirectory,
  loadPersonOverrides,
  personIdentities,
  surfacePeople,
} from "@/lib/people/overrides";
import { MomentSearch } from "@/components/search/MomentSearch";

/*
 * Faces are resolved here, in an authenticated server component, and passed
 * down as props: importing the committed face manifest inside the
 * "use client" PersonPicker compiled every guest's name slug and confidence
 * score into a /_next/static chunk, and src/proxy.ts serves that path without
 * authentication. Guest identities must only travel through gated data.
 * buildFaceDirectory adds one photo query and ONE signing batch (~132 paths)
 * on top of the facet read, so this page's load does not regress.
 */

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
  const [facets, overrides] = await Promise.all([
    getGalleryFacets(source),
    loadPersonOverrides(client),
  ]);
  // Hidden people drop out, renames apply, admin-added people join.
  const people = surfacePeople(facets.people, overrides);
  // Hiding is picker-only: a guest who already selected themselves must
  // still resolve to their real name, so identities include hidden people.
  const identities = personIdentities(facets.people, overrides);
  const faces = await buildFaceDirectory(client, people, overrides);

  return (
    <section className="atlas-guest-page">
      <header className="atlas-page-bar">
        <h1>Find me</h1>
        <p className="atlas-page-bar-note">
          Choose your name to open the photos you are in. Your selection
          stays private on this device.
        </p>
      </header>

      {/*
       * Moment Search sits ABOVE the face wall, not below it. The wall is 186
       * faces and roughly 4,000px tall, and semantic search was parked under
       * all of it, so the most distinctive feature on the site was the least
       * discoverable thing on the page. Nothing about the feature changed;
       * only where it sits in the document.
       */}
      {featureFlags.momentSearch ? (
        <div className="atlas-guest-feature">
          <p className="atlas-kicker">Beta</p>
          <h2>Search for a moment</h2>
          <div>
            <MomentSearch events={facets.events} />
          </div>
        </div>
      ) : null}

      <div className="atlas-guest-body">
        <MyWeekendClient people={people} identities={identities} faces={faces} />
      </div>
    </section>
  );
}
