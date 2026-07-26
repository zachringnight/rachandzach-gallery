import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { GalleryFacets } from "@/lib/gallery/query";
import { signPreviewUrls } from "@/lib/gallery/signed-previews";
import type {
  ClientFaceDirectory,
  ClientPersonFace,
  FaceCrop,
} from "@/lib/people/face-types";
import faceThumbnails from "@/generated/face-thumbnails.json";

/**
 * Person presentation overrides (rachandzach_person_overrides).
 *
 * The catalog stays the source of truth for who is tagged in photos; this
 * layer only decides who is SURFACED on guest-facing pickers and how. It is
 * consumed in three places:
 *   1. surfacePeople(): the people list offered by pickers (Find me, the
 *      photos filter) -- hidden people drop out, added people join, renames
 *      apply. Personalized routes and existing tags are untouched: a hidden
 *      person's /{slug} page, favorites, and photo tags all keep working.
 *   2. buildFaceDirectory(): how each surfaced person's face is drawn --
 *      a hand-picked CSS crop over a signed preview beats the committed
 *      automatic crop, which beats initials.
 *   3. The admin manager at /admin/faces, which writes these rows.
 *
 * Everything here is server-only. Guest identities must never reach a
 * static chunk; the committed face manifest is imported here (server) and
 * results travel as authenticated, per-request props.
 */

type Db = SupabaseClient<Database>;

export interface PersonOverride {
  personSlug: string;
  /** Corrected display name; null keeps the catalog name. */
  displayName: string | null;
  hidden: boolean;
  /** True when this person exists only here, not in the catalog. */
  added: boolean;
  facePhotoId: string | null;
  faceCrop: FaceCrop | null;
  updatedAt: string;
  updatedBy: string;
}

/** Committed automatic face crops, keyed by slug (built at import time). */
const COMMITTED_FACE_SLUGS: ReadonlySet<string> = new Set(
  Object.keys(faceThumbnails.people),
);

export function hasCommittedFace(slug: string): boolean {
  return COMMITTED_FACE_SLUGS.has(slug);
}

function rowToOverride(
  row: Database["public"]["Tables"]["rachandzach_person_overrides"]["Row"],
): PersonOverride {
  const crop =
    row.face_photo_id !== null &&
    row.face_crop_x !== null &&
    row.face_crop_y !== null &&
    row.face_crop_size !== null
      ? { x: row.face_crop_x, y: row.face_crop_y, size: row.face_crop_size }
      : null;
  return {
    personSlug: row.person_slug,
    displayName: row.display_name,
    hidden: row.hidden,
    added: row.added,
    facePhotoId: crop ? row.face_photo_id : null,
    faceCrop: crop,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/** All override rows, keyed by person slug. Fails closed on query errors. */
export async function loadPersonOverrides(
  client: Db,
): Promise<Map<string, PersonOverride>> {
  const { data, error } = await client
    .from("rachandzach_person_overrides")
    .select(
      "person_slug, display_name, hidden, added, face_photo_id, face_crop_x, face_crop_y, face_crop_size, created_at, updated_at, updated_by",
    );
  if (error) {
    throw new Error(`Person override query failed: ${error.message}`);
  }
  return new Map(
    (data ?? []).map((row) => [row.person_slug, rowToOverride(row)]),
  );
}

export interface SurfacedPerson {
  slug: string;
  displayName: string;
  count: number;
}

/**
 * The guest-facing roster: catalog facet people minus hidden, with renames
 * applied, plus admin-added people (count 0, appended alphabetically). This
 * feeds pickers only -- filtering photos by a hidden person's slug and their
 * personalized route continue to work.
 *
 * Added people are full catalog identities (addPerson creates their
 * rachandzach_people row; a backfill migration upgraded older additions),
 * but facets only carry people with at least one confirmed photo, so an
 * added person who has not been tagged yet arrives through the appended
 * branch. Once their first tag lands they flow through the facets like
 * everyone else, and the catalog-slug check keeps them from appearing
 * twice. Every surfaced person resolves at /{slug}.
 */
export function surfacePeople(
  people: readonly SurfacedPerson[],
  overrides: ReadonlyMap<string, PersonOverride>,
): SurfacedPerson[] {
  const catalogSlugs = new Set(people.map((person) => person.slug));
  const surfaced: SurfacedPerson[] = [];
  for (const person of people) {
    const override = overrides.get(person.slug);
    if (override?.hidden) continue;
    surfaced.push(
      override?.displayName
        ? { ...person, displayName: override.displayName }
        : person,
    );
  }
  const additions = [...overrides.values()]
    .filter(
      (override) =>
        override.added &&
        !override.hidden &&
        !catalogSlugs.has(override.personSlug) &&
        override.displayName,
    )
    .map((override) => ({
      slug: override.personSlug,
      displayName: override.displayName as string,
      count: 0,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "en-US"));
  return [...surfaced, ...additions];
}

/** Convenience: facets with the people list surfaced for pickers. */
export function surfaceGalleryFacets(
  facets: GalleryFacets,
  overrides: ReadonlyMap<string, PersonOverride>,
): GalleryFacets {
  return { ...facets, people: surfacePeople(facets.people, overrides) };
}

/** The preview width the face tiles crop from; tiles render well under it. */
const FACE_PREVIEW_WIDTH = 480;

interface FacePhotoRow {
  id: string;
  status: string;
  width: number | null;
  height: number | null;
  previews:
    | { object_path: string; bucket: string; width: number; format: string }[]
    | null;
}

/**
 * How to draw each surfaced person's face: a hand-picked override (signed
 * preview URL + normalized crop) beats the committed automatic crop, which
 * beats initials (absent entry). One photo query and one signing batch for
 * the whole roster (~132 people), so the pages that call this stay cheap.
 */
export async function buildFaceDirectory(
  client: Db,
  surfaced: readonly SurfacedPerson[],
  overrides: ReadonlyMap<string, PersonOverride>,
): Promise<ClientFaceDirectory> {
  const directory: ClientFaceDirectory = {};
  const cropWanted = new Map<string, PersonOverride>();
  for (const person of surfaced) {
    const override = overrides.get(person.slug);
    if (override?.facePhotoId && override.faceCrop) {
      cropWanted.set(person.slug, override);
    } else if (hasCommittedFace(person.slug)) {
      directory[person.slug] = { kind: "committed" };
    }
  }
  if (cropWanted.size === 0) return directory;

  const photoIds = [
    ...new Set([...cropWanted.values()].map((o) => o.facePhotoId as string)),
  ];
  const { data, error } = await client
    .from("rachandzach_photos")
    .select(
      "id, status, width, height, previews:rachandzach_photo_previews ( object_path, bucket, width, format )",
    )
    .in("id", photoIds);
  if (error) {
    throw new Error(`Face override photo query failed: ${error.message}`);
  }
  const photos = new Map(
    ((data ?? []) as unknown as FacePhotoRow[]).map((row) => [row.id, row]),
  );

  const chosen = new Map<
    string,
    {
      photoId: string;
      objectPath: string;
      bucket: string;
      aspectRatio: number;
      crop: FaceCrop;
    }
  >();
  for (const [slug, override] of cropWanted) {
    const photo = photos.get(override.facePhotoId as string);
    // A face photo that vanished or lost publication falls back to the
    // committed crop / initials rather than leaking a non-published image.
    if (!photo || photo.status !== "published") {
      if (hasCommittedFace(slug)) directory[slug] = { kind: "committed" };
      continue;
    }
    const preview = pickFacePreview(photo.previews ?? []);
    if (!preview) {
      if (hasCommittedFace(slug)) directory[slug] = { kind: "committed" };
      continue;
    }
    const width = photo.width ?? 0;
    const height = photo.height ?? 0;
    chosen.set(slug, {
      photoId: photo.id,
      objectPath: preview.object_path,
      bucket: preview.bucket,
      aspectRatio: width > 0 && height > 0 ? width / height : 1,
      crop: override.faceCrop as FaceCrop,
    });
  }
  if (chosen.size === 0) return directory;

  const { urls } = await signPreviewUrls(
    client,
    [...chosen.values()].map((entry) => ({
      bucket: entry.bucket,
      objectPath: entry.objectPath,
    })),
  );
  for (const [slug, entry] of chosen) {
    const url = urls.get(entry.objectPath);
    if (!url) {
      if (hasCommittedFace(slug)) directory[slug] = { kind: "committed" };
      continue;
    }
    const face: ClientPersonFace = {
      kind: "crop",
      photoId: entry.photoId,
      url,
      aspectRatio: entry.aspectRatio,
      crop: entry.crop,
    };
    directory[slug] = face;
  }
  return directory;
}

function pickFacePreview(
  previews: { object_path: string; bucket: string; width: number; format: string }[],
): { object_path: string; bucket: string } | null {
  // Smallest webp at or above the face width; webp for broad <img> support.
  const webp = previews
    .filter((p) => p.format === "webp")
    .sort((a, b) => a.width - b.width);
  const atLeast = webp.find((p) => p.width >= FACE_PREVIEW_WIDTH);
  const pick = atLeast ?? webp[webp.length - 1] ?? null;
  if (pick) return pick;
  const any = [...previews].sort((a, b) => a.width - b.width);
  const anyAtLeast = any.find((p) => p.width >= FACE_PREVIEW_WIDTH);
  return anyAtLeast ?? any[any.length - 1] ?? null;
}
