import type { CSSProperties } from "react";
import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import {
  GalleryQueryError,
  MAX_GALLERY_SEARCH_LENGTH,
  VISIBLE_PHOTO_STATUS,
  getGalleryFacets,
  getGalleryPage,
  parseGalleryQuery,
  type GalleryDataSource,
  type GalleryPhotoSource,
} from "@/lib/gallery/query";
import { serializeGalleryPage } from "@/lib/gallery/serialize";
import { signPreviewUrls } from "@/lib/gallery/signed-previews";
import {
  GALLERY_SEARCH_URL_PARAM,
  type GalleryFilterState,
} from "@/lib/gallery/client-types";
import {
  buildFaceDirectory,
  loadPersonOverrides,
  surfaceGalleryFacets,
  surfacePeople,
  type PersonOverride,
} from "@/lib/people/overrides";
import { faceCropCss } from "@/lib/people/face-types";
import { GalleryShell } from "@/components/gallery/GalleryShell";
import {
  BrowseLanding,
  type BrowseEvent,
  type BrowseFace,
} from "@/components/gallery/BrowseLanding";

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

/**
 * Any of these in the URL means the guest has already chosen how to enter the
 * archive (a chapter, a person, a search, a deep-linked photo, a restored
 * scroll position), so the full grid renders exactly as it always has. The
 * browse landing is strictly the no-parameter state.
 */
const GRID_PARAM_KEYS = [
  GALLERY_SEARCH_URL_PARAM,
  // Plain `q` is Moment Search's param: keyword chips in the viewer deep-link
  // to /photos?q=..., and the browse landing would swallow that query.
  "q",
  "person",
  "event",
  "orientation",
  "source",
  "sort",
  "photo",
  "ids",
  "cursor",
] as const;

/** "?all=1", "?all", "?all=true" open everything; "?all=0" does not. */
function isTruthyFlag(value: string | null): boolean {
  if (value === null) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return true;
  return normalized !== "0" && normalized !== "false" && normalized !== "no";
}

function wantsFullGrid(params: SearchParams): boolean {
  if (isTruthyFlag(first(params.all))) return true;
  return GRID_PARAM_KEYS.some(
    (key) => (first(params[key]) ?? "").trim().length > 0,
  );
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

// ---------------------------------------------------------------------------
// Browse landing data
// ---------------------------------------------------------------------------

/** Widths the cover srcset offers; the grid never renders a card wider. */
const COVER_TARGET_WIDTHS = [480, 960] as const;
/** Faces shown in the "By person" door. Decoration, never a roster. */
const FACE_STRIP_SIZE = 12;
/**
 * Candidates handed to buildFaceDirectory. Larger than the strip because a
 * guest with no resolved face falls through to initials, which this strip
 * does not render -- oversampling keeps the row full for one extra query of
 * nothing (buildFaceDirectory batches the whole list into one read).
 */
const FACE_CANDIDATE_POOL = 30;

/**
 * getGalleryFacets reads the whole catalog, and the cover picker needs the
 * same rows. Memoizing listPhotos keeps the landing to ONE catalog read
 * rather than two.
 */
function memoizePhotos(source: GalleryDataSource): GalleryDataSource {
  let photos: Promise<GalleryPhotoSource[]> | null = null;
  return {
    listPhotos: () => (photos ??= source.listPhotos()),
    listEvents: () => source.listEvents(),
    listPeople: () => source.listPeople(),
  };
}

function compareChronologically(
  a: GalleryPhotoSource,
  b: GalleryPhotoSource,
): number {
  if (a.capturedAt !== b.capturedAt) {
    if (a.capturedAt === null) return 1;
    if (b.capturedAt === null) return -1;
    return a.capturedAt < b.capturedAt ? -1 : 1;
  }
  if (a.originalFilename !== b.originalFilename) {
    return a.originalFilename < b.originalFilename ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * A chapter's cover. Deliberately deterministic rather than random: the same
 * chapter shows the same photograph on every visit, so the landing reads as a
 * printed contact sheet rather than a slot machine. Landscape frames win
 * because the card is landscape, and the pick sits a little past the start of
 * the chapter, where the setup frames have given way to the event itself.
 */
function pickCoverPhoto(
  photos: GalleryPhotoSource[],
): GalleryPhotoSource | null {
  if (photos.length === 0) return null;
  const ordered = [...photos].sort(compareChronologically);
  const landscape = ordered.filter((p) => p.orientation === "landscape");
  const pool = landscape.length > 0 ? landscape : ordered;
  const index = Math.min(pool.length - 1, Math.floor(pool.length * 0.42));
  return pool[index] ?? null;
}

interface CoverPreview {
  objectPath: string;
  bucket: string;
  width: number;
  height: number;
}

/** Smallest preview at or above each target width; webp for broad support. */
function coverPreviewsOf(photo: GalleryPhotoSource): CoverPreview[] {
  const webp = photo.previews.filter((preview) => preview.format === "webp");
  const pool = [...(webp.length > 0 ? webp : photo.previews)].sort(
    (a, b) => a.width - b.width,
  );
  if (pool.length === 0) return [];
  const chosen: typeof pool = [];
  for (const target of COVER_TARGET_WIDTHS) {
    const pick =
      pool.find((preview) => preview.width >= target) ?? pool[pool.length - 1];
    if (pick && !chosen.includes(pick)) chosen.push(pick);
  }
  return chosen.map((preview) => ({
    objectPath: preview.objectPath,
    bucket: preview.bucket,
    width: preview.width,
    height:
      photo.width > 0
        ? Math.round((preview.width * photo.height) / photo.width)
        : preview.width,
  }));
}

/** Evenly spread `want` items across `items`, preserving order. */
function spreadSample<T>(items: readonly T[], want: number): T[] {
  if (items.length <= want) return [...items];
  const step = items.length / want;
  const out: T[] = [];
  for (let i = 0; i < want; i += 1) out.push(items[Math.floor(i * step)]);
  return out;
}

/**
 * The face strip is sampled ALPHABETICALLY, never by photo count. Ranking
 * guests by how often they appear is exactly the comparison the archive
 * refuses to invite (see PersonPicker), and an evenly spread alphabetical
 * sample is stable, cheap, and carries no implicit league table.
 */
async function buildFaceStrip(
  client: SupabaseClient<Database>,
  people: readonly { slug: string; displayName: string; count: number }[],
  overrides: ReadonlyMap<string, PersonOverride>,
): Promise<BrowseFace[]> {
  if (people.length === 0) return [];
  const alphabetical = [...people].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, "en-US"),
  );
  const candidates = spreadSample(alphabetical, FACE_CANDIDATE_POOL);
  const directory = await buildFaceDirectory(client, candidates, overrides);

  const faces: BrowseFace[] = [];
  for (const person of candidates) {
    if (faces.length >= FACE_STRIP_SIZE) break;
    const face = directory[person.slug];
    if (!face) continue;
    if (face.kind === "crop") {
      faces.push({
        key: person.slug,
        src: face.url,
        crop: {
          position: "absolute",
          maxWidth: "none",
          ...faceCropCss(face.crop, face.aspectRatio),
        } as CSSProperties,
      });
    } else {
      faces.push({ key: person.slug, src: `/faces/${person.slug}.webp` });
    }
  }
  return faces;
}

async function renderBrowseLanding(
  client: SupabaseClient<Database>,
  source: GalleryDataSource,
) {
  const [facets, overrides] = await Promise.all([
    getGalleryFacets(source),
    loadPersonOverrides(client),
  ]);
  // Already resolved: getGalleryFacets pulled it through the memo above.
  const photos = await source.listPhotos();
  const published = photos.filter(
    (photo) => photo.status === VISIBLE_PHOTO_STATUS,
  );

  const byEvent = new Map<string, GalleryPhotoSource[]>();
  for (const photo of published) {
    const list = byEvent.get(photo.eventSlug);
    if (list) list.push(photo);
    else byEvent.set(photo.eventSlug, [photo]);
  }

  // A photo with no event would facet under an empty slug and produce a card
  // that filters to nothing; chapters need a real slug to link to.
  const eventFacets = facets.events.filter((event) => event.slug.length > 0);
  const covers = new Map<string, CoverPreview[]>();
  for (const event of eventFacets) {
    const cover = pickCoverPhoto(byEvent.get(event.slug) ?? []);
    if (cover) covers.set(event.slug, coverPreviewsOf(cover));
  }

  // Hidden people drop out and renames apply, exactly as on /my-weekend.
  const roster = surfacePeople(facets.people, overrides);

  const [{ urls }, faces] = await Promise.all([
    signPreviewUrls(
      client,
      [...covers.values()].flat().map((preview) => ({
        bucket: preview.bucket,
        objectPath: preview.objectPath,
      })),
    ),
    buildFaceStrip(client, roster, overrides),
  ]);

  const events: BrowseEvent[] = eventFacets.map((event) => {
    const signed = (covers.get(event.slug) ?? [])
      .map((preview) => ({ preview, url: urls.get(preview.objectPath) }))
      .filter(
        (entry): entry is { preview: CoverPreview; url: string } =>
          entry.url !== undefined,
      );
    const largest = signed[signed.length - 1];
    return {
      slug: event.slug,
      name: event.name,
      count: event.count,
      cover: largest
        ? {
            src: largest.url,
            srcSet: signed
              .map((entry) => `${entry.url} ${entry.preview.width}w`)
              .join(", "),
            width: largest.preview.width,
            height: largest.preview.height,
          }
        : null,
    };
  });

  const totalPhotos = published.length;

  return (
    <section className="atlas-guest-page atlas-photos-page">
      <header className="atlas-page-bar">
        <h1>The archive</h1>
        <p className="atlas-page-bar-count">
          <strong>{totalPhotos.toLocaleString()}</strong>
          {totalPhotos === 1 ? " photo" : " photos"}
        </p>
        <p className="atlas-page-bar-note">
          Pick a way in. Nothing loads until you choose one.
        </p>
      </header>

      <BrowseLanding
        totalPhotos={totalPhotos}
        events={events}
        faces={faces}
        taggedPeople={roster.length}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export default async function PhotosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const client = createAdminClient();
  const source = memoizePhotos(createSupabaseGalleryDataSource(client));

  // No filter, no deep link, no "see everything": offer the doors instead of
  // 1,721 photographs. Every other URL falls through to the real grid.
  if (!wantsFullGrid(params)) {
    return renderBrowseLanding(client, source);
  }

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

  const [initialPage, overrides] = await Promise.all([
    serializeGalleryPage(page, client),
    loadPersonOverrides(client),
  ]);

  return (
    <section className="atlas-guest-page atlas-photos-page">
      <GalleryShell
        heading="The archive"
        initialPage={initialPage}
        facets={surfaceGalleryFacets(facets, overrides)}
        initialFilters={filterStateFromParams(params)}
        initialPhotoId={first(params.photo)}
      />
    </section>
  );
}
