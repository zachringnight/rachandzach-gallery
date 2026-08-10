import type { Metadata } from "next";

import {
  CatalogTagger,
  type CatalogViewMode,
} from "@/components/admin/CatalogTagger";
import {
  type CatalogOption,
  parseAdminCatalogFilters,
} from "@/lib/admin/catalog";
import { loadAdminCatalogPage } from "@/lib/admin/catalog-server";
import { requireAdmin } from "@/lib/auth/admin-session";
import { loadPersonOverrides } from "@/lib/people/overrides";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Catalog tags | 0719 + co. Admin",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminCatalogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const filters = parseAdminCatalogFilters(params);
  const initialView: CatalogViewMode =
    first(params.view) === "table" ? "table" : "grid";
  const db = createAdminClient();
  const [initialPage, eventResult, peopleResult, overrides] = await Promise.all([
    loadAdminCatalogPage(filters, null, db),
    db
      .from("rachandzach_events")
      .select("slug, name")
      .order("sort_order", { ascending: true }),
    db
      .from("rachandzach_people")
      .select("slug, display_name")
      .order("display_name", { ascending: true }),
    loadPersonOverrides(db),
  ]);
  if (eventResult.error || peopleResult.error) {
    throw new Error("Could not load the catalog tag options.");
  }

  const events: CatalogOption[] = (eventResult.data ?? []).map((event) => ({
    slug: event.slug,
    name: event.name,
  }));
  const people: CatalogOption[] = (peopleResult.data ?? [])
    .map((person) => ({
      slug: person.slug,
      name: overrides.get(person.slug)?.displayName ?? person.display_name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en-US"));

  return (
    <CatalogTagger
      initialPage={initialPage}
      initialFilters={filters}
      initialView={initialView}
      events={events}
      people={people}
    />
  );
}
