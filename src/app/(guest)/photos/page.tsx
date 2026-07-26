import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import {
  GalleryQueryError,
  MAX_GALLERY_SEARCH_LENGTH,
  getGalleryFacets,
  getGalleryPage,
  parseGalleryQuery,
} from "@/lib/gallery/query";
import { serializeGalleryPage } from "@/lib/gallery/serialize";
import {
  GALLERY_SEARCH_URL_PARAM,
  type GalleryFilterState,
} from "@/lib/gallery/client-types";
import { GalleryShell } from "@/components/gallery/GalleryShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The Archive | Rach & Zach",
  description: "Search, select, download, and save the original photos.",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function filterStateFromParams(params: SearchParams): GalleryFilterState {
  const rawQuery =
    first(params[GALLERY_SEARCH_URL_PARAM])?.trim().replace(/\s+/g, " ") ?? "";
  const orientation = first(params.orientation);
  const source = first(params.source);
  const sort = first(params.sort);
  return {
    q:
      rawQuery.length <= MAX_GALLERY_SEARCH_LENGTH
        ? rawQuery
        : "",
    person: first(params.person),
    event: first(params.event),
    orientation:
      orientation === "portrait" ||
      orientation === "landscape" ||
      orientation === "square"
        ? orientation
        : null,
    source: source === "photographer" || source === "guest" ? source : null,
    sort: sort === "newest" ? "newest" : "weekend",
  };
}

export default async function PhotosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const client = createAdminClient();
  const source = createSupabaseGalleryDataSource(client);

  const input = parseGalleryQuery({
    ...params,
    q: params[GALLERY_SEARCH_URL_PARAM],
  });
  let page;
  let facets;
  try {
    [page, facets] = await Promise.all([
      getGalleryPage(input, source),
      getGalleryFacets(source),
    ]);
  } catch (error) {
    if (error instanceof GalleryQueryError) {
      // A hand-edited/invalid filter URL falls back to the full gallery.
      [page, facets] = await Promise.all([
        getGalleryPage({}, source),
        getGalleryFacets(source),
      ]);
    } else {
      throw error;
    }
  }

  const initialPage = await serializeGalleryPage(page, client);

  return (
    <section className="atlas-guest-page atlas-photos-page">
      <GalleryShell
        heading="The archive"
        initialPage={initialPage}
        facets={facets}
        initialFilters={filterStateFromParams(params)}
        initialPhotoId={first(params.photo)}
      />
    </section>
  );
}
