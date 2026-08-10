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
  // A filename is not a person. Every catalog slug is [a-z0-9-]+, so anything
  // carrying a dot cannot match one, and this segment catches every unclaimed
  // path in the guest tree -- including /favicon.ico, which browsers request
  // on their own on essentially every navigation. Without this the request
  // paid for an exact lookup, a speculative override lookup and a full
  // 189-row scan before 404ing, over and over.
  if (personSlug.includes(".")) return null;

  const client = createAdminClient();
  const overrideFor = (slug: string) =>
    client
      .from("rachandzach_person_overrides")
      .select("display_name")
      .eq("person_slug", slug)
      .maybeSingle();

  // Override rows are keyed by the catalog slug, and on the exact-match path
  // that slug IS the requested one, so the override lookup does not actually
  // depend on the people query. Firing both together collapses the common
  // case (a guest following the link they were handed) from two round trips
  // to one. allSettled rather than all: on a miss the speculative override
  // is discarded unread, failures included, because a nonexistent slug must
  // still be a plain 404 exactly as it was when the override query never ran
  // at all. allSettled also keeps both rejections subscribed, so neither
  // branch can surface as an unhandled rejection while the other settles.
  const [exactSettled, speculativeSettled] = await Promise.allSettled([
    client
      .from("rachandzach_people")
      .select("slug, display_name")
      .eq("slug", personSlug)
      .maybeSingle(),
    overrideFor(personSlug),
  ]);
  if (exactSettled.status === "rejected") throw exactSettled.reason;
  const exact = exactSettled.value;
  if (exact.error) {
    throw new Error(`Person route query failed: ${exact.error.message}`);
  }

  if (exact.data) {
    if (speculativeSettled.status === "rejected") {
      throw speculativeSettled.reason;
    }
    const override = speculativeSettled.value;
    if (override.error) {
      throw new Error(
        `Person route override query failed: ${override.error.message}`,
      );
    }
    return {
      slug: exact.data.slug,
      displayName: override.data?.display_name ?? exact.data.display_name,
    };
  }

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
  const person =
    (all.data ?? []).find((row) => compactPersonSlug(row.slug) === compact) ??
    null;
  if (!person) return null;

  // The scanned slug differs from the requested spelling (its exact form
  // would have matched above), so the speculative override cannot apply and
  // the real one has to wait for the scan: a genuine data dependency, left
  // sequential on purpose.
  const override = await overrideFor(person.slug);
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
