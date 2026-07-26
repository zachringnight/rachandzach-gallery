import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PersonGalleryClient } from "@/components/personalization/PersonGalleryClient";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Identity resolves from the catalog (rachandzach_people), not from the
 * facet set: a catalog person with zero confirmed photos -- an admin-added
 * guest who has not been tagged yet -- still owns their page (it renders
 * the gallery's empty state until tags land). An admin rename override
 * shadows the catalog display name here exactly as it does in pickers.
 * Hidden people deliberately keep the route; hiding only affects pickers.
 */
const confirmedPerson = cache(async (personSlug: string) => {
  const client = createAdminClient();
  const [personResult, overrideResult] = await Promise.all([
    client
      .from("rachandzach_people")
      .select("slug, display_name")
      .eq("slug", personSlug)
      .maybeSingle(),
    client
      .from("rachandzach_person_overrides")
      .select("display_name")
      .eq("person_slug", personSlug)
      .maybeSingle(),
  ]);
  if (personResult.error) {
    throw new Error(
      `Person route query failed: ${personResult.error.message}`,
    );
  }
  if (overrideResult.error) {
    throw new Error(
      `Person route override query failed: ${overrideResult.error.message}`,
    );
  }
  if (!personResult.data) return null;
  return {
    slug: personResult.data.slug,
    displayName:
      overrideResult.data?.display_name ?? personResult.data.display_name,
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
