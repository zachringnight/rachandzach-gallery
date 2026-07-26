import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import { getGalleryFacets } from "@/lib/gallery/query";
import {
  buildFaceDirectory,
  hasCommittedFace,
  loadPersonOverrides,
} from "@/lib/people/overrides";
import { normalizeFaceCrop, type FaceCrop } from "@/lib/people/face-types";
import {
  isValidPersonSlug,
  type AdminRoster,
  type AdminRosterPerson,
} from "@/lib/admin/people";

/**
 * Server operations behind /admin/faces and /api/admin/people. Every entry
 * point here is reached only after requireAdmin(); this module never checks
 * auth itself. Writes touch ONLY rachandzach_person_overrides -- the guest
 * catalog (people, photos, tags) is read, never mutated: "remove" is a soft
 * hidden flag, "add" is an override-only row, and "revert" clears the face
 * columns. See the migration header for the crop scheme.
 */

type Db = SupabaseClient<Database>;

export class PersonAdminError extends Error {
  readonly status: 404 | 409 | 422;

  constructor(message: string, status: 404 | 409 | 422 = 422) {
    super(message);
    this.name = "PersonAdminError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export async function loadGuestRoster(
  client: Db = createAdminClient(),
): Promise<AdminRoster> {
  const source = createSupabaseGalleryDataSource(client);
  const [facets, overrides, catalogResult] = await Promise.all([
    getGalleryFacets(source),
    loadPersonOverrides(client),
    client.from("rachandzach_people").select("slug, display_name"),
  ]);
  if (catalogResult.error) {
    throw new Error(
      `Guest roster people query failed: ${catalogResult.error.message}`,
    );
  }
  const catalogNames = new Map(
    (catalogResult.data ?? []).map((row) => [row.slug, row.display_name]),
  );
  const counts = new Map(
    facets.people.map((person) => [person.slug, person.count]),
  );

  // Everyone: the full catalog (even people with zero confirmed photos),
  // plus override-only additions.
  const people: AdminRosterPerson[] = [];
  for (const [slug, catalogName] of catalogNames) {
    const override = overrides.get(slug);
    people.push({
      slug,
      displayName: override?.displayName ?? catalogName,
      catalogName,
      count: counts.get(slug) ?? 0,
      hidden: override?.hidden ?? false,
      added: false,
      faceKind: "none",
      hasCommittedFace: false,
      updatedAt: override?.updatedAt ?? null,
    });
  }
  for (const override of overrides.values()) {
    if (!override.added || catalogNames.has(override.personSlug)) continue;
    people.push({
      slug: override.personSlug,
      displayName: override.displayName ?? override.personSlug,
      catalogName: null,
      count: counts.get(override.personSlug) ?? 0,
      hidden: override.hidden,
      added: true,
      faceKind: "none",
      hasCommittedFace: false,
      updatedAt: override.updatedAt,
    });
  }

  // Resolve each person's current face exactly the way the guest picker
  // will: override crop, else committed automatic crop, else initials.
  const directory = await buildFaceDirectory(client, people, overrides);
  for (const person of people) {
    const face = directory[person.slug];
    // committedFaceSlugs is the manifest itself, so this is the fact rather
    // than a guess -- true even when an override is currently shown on top.
    person.hasCommittedFace = hasCommittedFace(person.slug);
    if (face?.kind === "crop") {
      person.faceKind = "override";
      person.face = {
        url: face.url,
        aspectRatio: face.aspectRatio,
        crop: face.crop,
      };
    } else if (face?.kind === "committed") {
      person.faceKind = "committed";
    }
  }

  // The 24 faceless guests are the work queue: surface them first, then
  // everyone with a face, hidden people last. Alphabetical within groups.
  const bucket = (person: AdminRosterPerson): number => {
    if (person.hidden) return 2;
    return person.faceKind === "none" ? 0 : 1;
  };
  people.sort(
    (a, b) =>
      bucket(a) - bucket(b) ||
      a.displayName.localeCompare(b.displayName, "en-US"),
  );

  const surfaced = people.filter((person) => !person.hidden);
  return {
    people,
    surfacedCount: surfaced.length,
    withFaceCount: surfaced.filter((person) => person.faceKind !== "none")
      .length,
  };
}

// ---------------------------------------------------------------------------
// Mutations (rachandzach_person_overrides only)
// ---------------------------------------------------------------------------

interface OverrideRow {
  person_slug: string;
  display_name: string | null;
  hidden: boolean;
  added: boolean;
  face_photo_id: string | null;
}

async function getOverrideRow(
  client: Db,
  slug: string,
): Promise<OverrideRow | null> {
  const { data, error } = await client
    .from("rachandzach_person_overrides")
    .select("person_slug, display_name, hidden, added, face_photo_id")
    .eq("person_slug", slug)
    .maybeSingle();
  if (error) {
    throw new Error(`Person override read failed: ${error.message}`);
  }
  return data ?? null;
}

async function isCatalogPerson(client: Db, slug: string): Promise<boolean> {
  const { data, error } = await client
    .from("rachandzach_people")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    throw new Error(`Catalog person read failed: ${error.message}`);
  }
  return data !== null;
}

/**
 * Deletes an override row that no longer changes anything, so the table
 * stays a list of real decisions rather than accumulated no-ops.
 */
async function dropOverrideIfEmpty(client: Db, slug: string): Promise<void> {
  const row = await getOverrideRow(client, slug);
  if (!row) return;
  if (row.display_name || row.hidden || row.added || row.face_photo_id) return;
  const { error } = await client
    .from("rachandzach_person_overrides")
    .delete()
    .eq("person_slug", slug);
  if (error) {
    throw new Error(`Person override cleanup failed: ${error.message}`);
  }
}

/** Hand-pick a face: photo + normalized square crop (see crop scheme). */
export async function savePersonFace(
  slug: string,
  photoId: string,
  crop: FaceCrop,
  actorEmail: string,
  client: Db = createAdminClient(),
): Promise<void> {
  if (!isValidPersonSlug(slug)) {
    throw new PersonAdminError("That person slug is not valid.");
  }
  const [inCatalog, override] = await Promise.all([
    isCatalogPerson(client, slug),
    getOverrideRow(client, slug),
  ]);
  if (!inCatalog && !override?.added) {
    throw new PersonAdminError("That person does not exist.", 404);
  }

  const { data: photo, error } = await client
    .from("rachandzach_photos")
    .select("id, status, width, height")
    .eq("id", photoId)
    .maybeSingle();
  if (error) {
    throw new Error(`Face photo read failed: ${error.message}`);
  }
  if (!photo || photo.status !== "published") {
    throw new PersonAdminError(
      "That photo is not available for a face crop.",
      404,
    );
  }
  const aspectRatio =
    photo.width && photo.height && photo.width > 0 && photo.height > 0
      ? photo.width / photo.height
      : 1;
  const normalized = normalizeFaceCrop(crop, aspectRatio);
  if (!normalized || normalized.size < 0.02) {
    throw new PersonAdminError("That crop is out of range.");
  }

  const { error: upsertError } = await client
    .from("rachandzach_person_overrides")
    .upsert(
      {
        person_slug: slug,
        face_photo_id: photo.id,
        face_crop_x: normalized.x,
        face_crop_y: normalized.y,
        face_crop_size: normalized.size,
        updated_by: actorEmail,
      },
      { onConflict: "person_slug" },
    );
  if (upsertError) {
    throw new Error(`Face override write failed: ${upsertError.message}`);
  }
}

/** Revert to the automatic committed crop (or initials). */
export async function clearPersonFace(
  slug: string,
  actorEmail: string,
  client: Db = createAdminClient(),
): Promise<void> {
  const override = await getOverrideRow(client, slug);
  if (!override) return; // already automatic
  const { error } = await client
    .from("rachandzach_person_overrides")
    .update({
      face_photo_id: null,
      face_crop_x: null,
      face_crop_y: null,
      face_crop_size: null,
      updated_by: actorEmail,
    })
    .eq("person_slug", slug);
  if (error) {
    throw new Error(`Face override clear failed: ${error.message}`);
  }
  await dropOverrideIfEmpty(client, slug);
}

/** Rename (displayName), clear a rename (null), or toggle hidden. */
export async function patchPerson(
  slug: string,
  patch: { displayName?: string | null; hidden?: boolean },
  actorEmail: string,
  client: Db = createAdminClient(),
): Promise<void> {
  const [inCatalog, override] = await Promise.all([
    isCatalogPerson(client, slug),
    getOverrideRow(client, slug),
  ]);
  if (!inCatalog && !override?.added) {
    throw new PersonAdminError("That person does not exist.", 404);
  }
  if (override?.added && patch.displayName === null) {
    throw new PersonAdminError(
      "An added person needs a name; edit it instead of clearing it.",
    );
  }

  const update: Database["public"]["Tables"]["rachandzach_person_overrides"]["Insert"] =
    { person_slug: slug, updated_by: actorEmail };
  if (patch.displayName !== undefined) update.display_name = patch.displayName;
  if (patch.hidden !== undefined) update.hidden = patch.hidden;

  const { error } = await client
    .from("rachandzach_person_overrides")
    .upsert(update, { onConflict: "person_slug" });
  if (error) {
    throw new Error(`Person override write failed: ${error.message}`);
  }
  await dropOverrideIfEmpty(client, slug);
}

/** Add a person who is not in the catalog (override-only row). */
export async function addPerson(
  slug: string,
  displayName: string,
  actorEmail: string,
  client: Db = createAdminClient(),
): Promise<void> {
  if (!isValidPersonSlug(slug)) {
    throw new PersonAdminError("That slug is not valid.");
  }
  const [inCatalog, override] = await Promise.all([
    isCatalogPerson(client, slug),
    getOverrideRow(client, slug),
  ]);
  if (inCatalog || override) {
    throw new PersonAdminError(
      "Someone already uses that slug. Pick a different one.",
      409,
    );
  }
  const { error } = await client.from("rachandzach_person_overrides").insert({
    person_slug: slug,
    display_name: displayName,
    added: true,
    updated_by: actorEmail,
  });
  if (error) {
    throw new Error(`Person add failed: ${error.message}`);
  }
}

/**
 * Remove a person from guest-facing pickers. For an added person the
 * override row is deleted outright (it was the only thing defining them).
 * For a catalog person this sets the soft hidden flag: their photo tags,
 * favorites, and /{slug} personalized route all keep working; they simply
 * stop being offered. Nothing in the catalog is deleted or changed.
 */
export async function removePerson(
  slug: string,
  actorEmail: string,
  client: Db = createAdminClient(),
): Promise<"deleted" | "hidden"> {
  const [inCatalog, override] = await Promise.all([
    isCatalogPerson(client, slug),
    getOverrideRow(client, slug),
  ]);
  if (override?.added && !inCatalog) {
    const { error } = await client
      .from("rachandzach_person_overrides")
      .delete()
      .eq("person_slug", slug);
    if (error) {
      throw new Error(`Person delete failed: ${error.message}`);
    }
    return "deleted";
  }
  if (!inCatalog) {
    throw new PersonAdminError("That person does not exist.", 404);
  }
  await patchPerson(slug, { hidden: true }, actorEmail, client);
  return "hidden";
}
