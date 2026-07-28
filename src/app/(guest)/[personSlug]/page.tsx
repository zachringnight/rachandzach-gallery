import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { PersonGalleryClient } from "@/components/personalization/PersonGalleryClient";
import { compactPersonSlug } from "@/lib/people/person-href";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Identity resolves from the catalog (rachandzach_people), not from the
 * facet set: a catalog person with zero confirmed photos -- an admin-added
 * guest who has not been tagged yet -- still owns their page (it renders
 * the gallery's empty state until tags land). An admin rename override
 * shadows the catalog display name here exactly as it does in pickers.
 * Hidden people deliberately keep the route; hiding only affects pickers.
 *
 * Both URL spellings resolve: the catalog slug (`/phil-campbell`, which is
 * what older shared links and the face files use) and the hyphen-free form
 * (`/philcampbell`, which is what guests are handed now). The exact match is
 * tried first; only a miss pays for the compact scan, and the catalog is
 * small enough (189 rows) that scanning it costs less than maintaining a
 * second indexed column.
 */
const confirmedPerson = cache(async (personSlug: string) => {
  const client = createAdminClient();
  const exact = await client
    .from("rachandzach_people")
    .select("slug, display_name")
    .eq("slug", personSlug)
    .maybeSingle();
  if (exact.error) {
    throw new Error(`Person route query failed: ${exact.error.message}`);
  }

  let person = exact.data;
  if (!person) {
    const compact = compactPersonSlug(personSlug);
    // An empty compact form would match nothing anyway, and scanning for it
    // is pure waste on the many non-person 404s this dynamic segment catches.
    if (compact.length === 0) return null;
    const all = await client
      .from("rachandzach_people")
      .select("slug, display_name");
    if (all.error) {
      throw new Error(`Person route scan failed: ${all.error.message}`);
    }
    person =
      (all.data ?? []).find((row) => compactPersonSlug(row.slug) === compact) ??
      null;
  }
  if (!person) return null;

  const override = await client
    .from("rachandzach_person_overrides")
    .select("display_name")
    .eq("person_slug", person.slug)
    .maybeSingle();
  if (override.error) {
    throw new Error(
      `Person route override query failed: ${override.error.message}`,
    );
  }
  return {
    slug: person.slug,
    displayName: override.data?.display_name ?? person.display_name,
  };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ personSlug: string }>;
}): Promise<Metadata> {
  const { personSlug } = await params;
  const person = await confirmedPerson(personSlug);
  return {
    title: person ? `${person.displayName}'s Photos | Rach & Zach` : "Your Photos | Rach & Zach",
    description: "A private collection of confirmed photos that include you.",
    robots: { index: false, follow: false },
  };
}

/**
 * A private, human-readable guest keepsake at /{catalog-person-slug}.
 * Static routes win before this dynamic segment, and a slug with no
 * rachandzach_people row is a plain 404. The route remains inside the guest
 * layout, so every visit must pass the shared-password gate.
 */
export default async function PersonGalleryPage({
  params,
}: {
  params: Promise<{ personSlug: string }>;
}) {
  const { personSlug } = await params;
  const person = await confirmedPerson(personSlug);
  if (!person) notFound();

  // One canonical spelling per guest. Reaching here by the hyphenated catalog
  // slug (an older shared link) bounces to the hyphen-free URL, so the page a
  // guest bookmarks or forwards is always the one we would hand them.
  const canonical = compactPersonSlug(person.slug);
  if (personSlug !== canonical) redirect(`/${canonical}`);

  return (
    <section className="atlas-guest-page atlas-person-route">
      <header className="atlas-page-bar">
        <h1>{person.displayName}</h1>
        <p className="atlas-page-bar-note">
          Every confirmed photo that includes you, gathered in one private
          place and ready to favorite, download, or save.
        </p>
      </header>

      <div className="atlas-guest-body">
        <PersonGalleryClient
          personSlug={person.slug}
          personName={person.displayName}
        />
      </div>
    </section>
  );
}
