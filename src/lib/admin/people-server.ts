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
 * auth itself.
 *
 * Presentation state (face crop, rename, hidden flag) lives in
 * rachandzach_person_overrides. Identity lives in rachandzach_people:
 * "add" creates a real catalog row (so the person is taggable everywhere)
 * plus an override row carrying the added = true provenance marker -- both
 * written atomically by the rachandzach_add_person RPC -- and "remove"
 * deletes that identity ONLY while nothing durable references it: the
 * moment a person has photo tags OR person-keyed guest favorites, remove
 * degrades to the soft hidden flag and destroys nothing. Both decisions are
 * made atomically inside their rachandzach_* RPCs (see the migration
 * headers), never as a client-side statement pair that a concurrent tag
 * write can interleave. Photos and photo-person links are never deleted
 * from this module. See the migration headers for the crop scheme and the
 * added-people invariant.
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

  // Everyone: the full catalog (even people with zero confirmed photos).
  // Admin-added people have catalog rows too, so they arrive through this
  // loop; the override's added flag rides along as provenance.
  const people: AdminRosterPerson[] = [];
  for (const [slug, catalogName] of catalogNames) {
    const override = overrides.get(slug);
    people.push({
      slug,
      displayName: override?.displayName ?? catalogName,
      catalogName,
      count: counts.get(slug) ?? 0,
      hidden: override?.hidden ?? false,
      added: override?.added ?? false,
      faceKind: "none",
      hasCommittedFace: false,
      updatedAt: override?.updatedAt ?? null,
    });
  }
  // Anomaly recovery only: an added override without a catalog row cannot be
  // created any more (addPerson writes both rows in one transaction, and the
  // backfill migration upgraded history), but if one ever appears it must
  // stay visible here so the admin can remove it rather than having it
  // silently vanish from the manager while still surfacing to guests.
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
        photoId: face.photoId,
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

async function getCatalogPerson(
  client: Db,
  slug: string,
): Promise<{ id: string } | null> {
  const { data, error } = await client
    .from("rachandzach_people")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    throw new Error(`Catalog person read failed: ${error.message}`);
  }
  return data ?? null;
}

async function isCatalogPerson(client: Db, slug: string): Promise<boolean> {
  return (await getCatalogPerson(client, slug)) !== null;
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

/**
 * Add a person as a real catalog identity: a rachandzach_people row (so they
 * can be tagged into photographs, filtered on, and given a personalized
 * route) plus an override row whose added = true records that they came from
 * this screen. photo_count stays 0 -- the catalog trigger maintains it as
 * tags are written.
 *
 * Both rows are written by ONE atomic rachandzach_add_person RPC (see its
 * migration header): the person either exists fully (catalog row + added
 * override) or not at all. The previous shape -- catalog insert, then
 * override insert, then a compensating client-side delete on failure -- ran
 * in three transactions, and during the gap /admin/catalog could tag the
 * new person; the unconditional compensation then cascade-destroyed the
 * committed tag (rachandzach_photo_people.person_id is ON DELETE CASCADE),
 * or, when the override commit's response was merely lost, deleted the
 * catalog row out from under a real override. No delete of
 * rachandzach_people appears anywhere in this path any more. A duplicate
 * slug surfaces as the same 409 the friendlier pre-check produces; the
 * unique index and the override primary key stay the authoritative
 * collision checks inside the RPC.
 */
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

  const { data, error } = await client.rpc("rachandzach_add_person", {
    p_slug: slug,
    p_display_name: displayName,
    p_actor: actorEmail,
  });
  if (error) {
    throw new Error(`Person add failed: ${error.message}`);
  }
  if (data === "duplicate") {
    // The RPC rolled back both inserts; nothing partial exists.
    throw new PersonAdminError(
      "Someone already uses that slug. Pick a different one.",
      409,
    );
  }
}

/**
 * Remove a person. Semantics, in order of preference for safety:
 *
 * - A person the pipeline matched (not added here) is NEVER deleted:
 *   removing sets the soft hidden flag. Their photo tags, favorites, and
 *   /{slug} personalized route all keep working; they simply stop being
 *   offered in pickers. Fully reversible from the Hidden filter.
 * - An added person is deleted outright (catalog row and override row) only
 *   while nothing durable references the identity: zero photo-person links
 *   (any source or confidence) AND zero person-keyed guest favorites.
 *   Favorites gate the delete because a guest who claimed this person on
 *   Find me stores their shortlist under the slug, independent of tags;
 *   deleting the catalog row would strand that shortlist forever.
 * - Any reference degrades to the same soft hide as a catalog person.
 *   Deleting the rachandzach_people row would cascade-delete confirmed tags
 *   (rachandzach_photo_people.person_id is ON DELETE CASCADE), which must
 *   never happen implicitly. Untag them first if a full delete is really
 *   wanted; the UI says so before confirming.
 *
 * The reference checks and the conditional delete run as ONE atomic
 * rachandzach_remove_added_person RPC, which locks the catalog row FOR
 * UPDATE before checking. A tag insert interleaved with this call either
 * commits first (the RPC sees it and keeps the person) or blocks on the
 * lock and fails its FK after the delete; a check-then-delete in two
 * statements cannot promise that, which is why no delete of
 * rachandzach_people appears in this branch at all.
 */
export async function removePerson(
  slug: string,
  actorEmail: string,
  client: Db = createAdminClient(),
): Promise<"deleted" | "hidden"> {
  const [catalogPerson, override] = await Promise.all([
    getCatalogPerson(client, slug),
    getOverrideRow(client, slug),
  ]);
  if (override?.added && !catalogPerson) {
    // Anomaly recovery: an added override with no catalog row predates the
    // backfill migration (or was hand-inserted). Nothing references it:
    // tags need a catalog id, and person-keyed favorites can only ever be
    // written for a slug that resolves in rachandzach_people.
    const { error } = await client
      .from("rachandzach_person_overrides")
      .delete()
      .eq("person_slug", slug);
    if (error) {
      throw new Error(`Person delete failed: ${error.message}`);
    }
    return "deleted";
  }
  if (!catalogPerson) {
    throw new PersonAdminError("That person does not exist.", 404);
  }

  if (override?.added) {
    const { data, error } = await client.rpc(
      "rachandzach_remove_added_person",
      { p_slug: slug },
    );
    if (error) {
      throw new Error(`Person delete failed: ${error.message}`);
    }
    if (data === "deleted") return "deleted";
    if (data === "missing") {
      // The catalog row existed a moment ago; a concurrent remove finished
      // first. The end state is exactly what this call promised.
      return "deleted";
    }
    // "kept": something durable references the identity; fall through to
    // the soft hide so nothing a guest did is destroyed or stranded.
  }

  await patchPerson(slug, { hidden: true }, actorEmail, client);
  return "hidden";
}
