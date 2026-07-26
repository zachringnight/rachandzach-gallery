import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PersonGalleryClient } from "@/components/personalization/PersonGalleryClient";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import { getGalleryFacets } from "@/lib/gallery/query";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const confirmedPerson = cache(async (personSlug: string) => {
  const client = createAdminClient();
  const source = createSupabaseGalleryDataSource(client);
  const facets = await getGalleryFacets(source);
  return (
    facets.people.find((person) => person.slug === personSlug) ?? null
  );
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
    description: "A private collection of confirmed photographs that include you.",
    robots: { index: false, follow: false },
  };
}

/**
 * A private, human-readable guest keepsake at /{confirmed-person-slug}.
 * Static routes win before this dynamic segment, and an unknown or
 * non-confirmed identity is a plain 404. The route remains inside the guest
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
          Every confirmed photograph that includes you, gathered in one private
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
