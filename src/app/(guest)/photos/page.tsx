import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import {
  GalleryQueryError,
  getGalleryFacets,
  getGalleryPage,
  parseGalleryQuery,
} from "@/lib/gallery/query";
import { serializeGalleryPage } from "@/lib/gallery/serialize";
import type { GalleryFilterState } from "@/lib/gallery/client-types";
import { GalleryShell } from "@/components/gallery/GalleryShell";
import { siteConfig } from "@/content/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Photos | Rach & Zach",
  description: "Every photo from the wedding weekend.",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function filterStateFromParams(params: SearchParams): GalleryFilterState {
  const orientation = first(params.orientation);
  const source = first(params.source);
  const sort = first(params.sort);
  return {
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

  const input = parseGalleryQuery(params);
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
    <section className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-wider text-muted">
          The gallery
        </p>
        <h1 className="mt-1 font-display text-3xl text-ink sm:text-4xl">
          Photos
        </h1>
        <p className="mt-3 text-ink/70">{siteConfig.voice.galleryIntro}</p>
      </header>

      <GalleryShell
        initialPage={initialPage}
        facets={facets}
        initialFilters={filterStateFromParams(params)}
        initialPhotoId={first(params.photo)}
      />
    </section>
  );
}
