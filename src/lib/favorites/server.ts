/**
 * Server-side favorites persistence (Favorites v2). Pure functions over an
 * injected Supabase client, following the same pattern as
 * src/lib/downloads/sign-originals.ts: the /api/favorites route constructs
 * the service-role client and passes it in, and tests pass a fake. No
 * "server-only" import here so the vitest node project can exercise this
 * module directly; nothing in this file reads env or cookies.
 *
 * Owner model (see supabase/migrations/202607220005_guest_favorites.sql):
 * rows are keyed by (owner_kind, owner_key). The key is derived server-side:
 * the session id always comes from the verified rz_gallery_session cookie
 * (never from the request body), and a client-supplied person slug counts
 * only if it matches a real rachandzach_people row; anything else falls back
 * to session keying.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { FavoriteOwnerKind } from "@/lib/supabase/schema";
import { isValidPersonSlug } from "@/lib/personalization/my-weekend";

export interface FavoriteOwner {
  kind: FavoriteOwnerKind;
  key: string;
}

/** Cap per request body. The local store is unbounded, but a wedding gallery
 *  favorite list beyond this is not a realistic guest; extra ids are dropped
 *  silently rather than erroring (background sync must never surface UI). */
export const FAVORITES_SYNC_MAX = 500;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A storage read/write failed. The route maps this to a plain 500; the
 *  client treats any non-ok response as "catch up next load". */
export class FavoritesPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FavoritesPersistenceError";
  }
}

/**
 * Normalizes a client-supplied photo id list: strings that look like UUIDs
 * (rachandzach_photos ids), deduplicated, capped at FAVORITES_SYNC_MAX.
 * Anything else in the array is dropped silently -- local stores can carry
 * stale or hand-edited junk and the sync layer must shrug it off.
 */
export function sanitizePhotoIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of input) {
    if (ids.length >= FAVORITES_SYNC_MAX) break;
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

/**
 * Derives the caller's owner key. The person slug is accepted from the
 * client but validated against rachandzach_people via the (service-role)
 * client; an unknown or malformed slug falls back to keying by the verified
 * session id. The session id itself is never accepted from the client.
 *
 * A slug that is gone from the catalog but already OWNS person-keyed
 * favorite rows stays resolvable. Reachability of stored favorites is
 * anchored to the favorites table itself, so no identity deletion (however
 * it interleaves with an in-flight favorite write; the favorites table has
 * no FK to rachandzach_people to serialize against) can strand a guest's
 * shortlist. This cannot mint new person keys: a slug with no catalog row
 * and no existing rows still falls back to session keying, and in this
 * password-gated context claiming an existing person's rows was already
 * accepted behavior.
 */
export async function resolveFavoriteOwner(
  client: SupabaseClient<Database>,
  sessionId: string,
  personSlugRaw: unknown,
): Promise<FavoriteOwner> {
  if (isValidPersonSlug(personSlugRaw)) {
    const { data, error } = await client
      .from("rachandzach_people")
      .select("slug")
      .eq("slug", personSlugRaw)
      .maybeSingle();
    if (!error && data?.slug === personSlugRaw) {
      return { kind: "person", key: personSlugRaw };
    }
    const existing = await client
      .from("rachandzach_guest_favorites")
      .select("photo_id")
      .eq("owner_kind", "person")
      .eq("owner_key", personSlugRaw)
      .limit(1);
    if (!existing.error && (existing.data?.length ?? 0) > 0) {
      return { kind: "person", key: personSlugRaw };
    }
  }
  return { kind: "session", key: sessionId };
}

/** Lists one owner's favorite photo ids, oldest first (photo_id breaks
 *  created_at ties so the order is deterministic). */
export async function listFavoritePhotoIds(
  client: SupabaseClient<Database>,
  owner: FavoriteOwner,
): Promise<string[]> {
  const { data, error } = await client
    .from("rachandzach_guest_favorites")
    .select("photo_id")
    .eq("owner_kind", owner.kind)
    .eq("owner_key", owner.key)
    .order("created_at", { ascending: true })
    .order("photo_id", { ascending: true });
  if (error || !data) {
    throw new FavoritesPersistenceError("Could not list favorites.");
  }
  return data.map((row) => row.photo_id);
}

/**
 * Drops ids that do not correspond to an existing photo row. Existence (not
 * status) is the bar: the FK requires a real photo, and a favorite row
 * reveals nothing the caller did not already supply -- every read surface
 * (gallery, downloads) applies its own approved-status filter.
 */
async function filterToExistingPhotoIds(
  client: SupabaseClient<Database>,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from("rachandzach_photos")
    .select("id")
    .in("id", ids);
  if (error || !data) {
    throw new FavoritesPersistenceError("Could not validate photo ids.");
  }
  const known = new Set(data.map((row) => row.id));
  return ids.filter((id) => known.has(id));
}

async function insertFavorites(
  client: SupabaseClient<Database>,
  owner: FavoriteOwner,
  photoIds: string[],
): Promise<void> {
  if (photoIds.length === 0) return;
  const rows = photoIds.map((photoId) => ({
    owner_kind: owner.kind,
    owner_key: owner.key,
    photo_id: photoId,
  }));
  const { error } = await client
    .from("rachandzach_guest_favorites")
    .upsert(rows, {
      onConflict: "owner_kind,owner_key,photo_id",
      ignoreDuplicates: true,
    });
  if (error) {
    throw new FavoritesPersistenceError("Could not save favorites.");
  }
}

/**
 * Replace semantics: after this call the owner's server row set matches
 * `photoIds` (minus ids that are not real photos). Removals propagate --
 * un-hearting on one device un-hearts everywhere the same owner key loads.
 * Rows that already exist keep their created_at (favorite order survives).
 */
export async function replaceFavorites(
  client: SupabaseClient<Database>,
  owner: FavoriteOwner,
  photoIds: string[],
): Promise<string[]> {
  const target = await filterToExistingPhotoIds(client, photoIds);
  const existing = await listFavoritePhotoIds(client, owner);

  const targetSet = new Set(target);
  const removed = existing.filter((id) => !targetSet.has(id));
  if (removed.length > 0) {
    const { error } = await client
      .from("rachandzach_guest_favorites")
      .delete()
      .eq("owner_kind", owner.kind)
      .eq("owner_key", owner.key)
      .in("photo_id", removed);
    if (error) {
      throw new FavoritesPersistenceError("Could not remove favorites.");
    }
  }

  const existingSet = new Set(existing);
  await insertFavorites(
    client,
    owner,
    target.filter((id) => !existingSet.has(id)),
  );

  return listFavoritePhotoIds(client, owner);
}

/**
 * The My Weekend hand-off: unions the caller's session-keyed rows (and the
 * request's local list) into the person key, then deletes the session rows.
 * Union, never replace -- the person key may already carry favorites from
 * another device or another guest who claimed the same person, and claiming
 * a person must never wipe what is already there. Session rows are deleted
 * only after the union insert succeeds, so a failed merge loses nothing.
 */
export async function mergeSessionFavoritesIntoPerson(
  client: SupabaseClient<Database>,
  sessionId: string,
  personOwner: FavoriteOwner,
  photoIds: string[],
): Promise<string[]> {
  const sessionOwner: FavoriteOwner = { kind: "session", key: sessionId };
  const sessionIds = await listFavoritePhotoIds(client, sessionOwner);
  const personIds = await listFavoritePhotoIds(client, personOwner);
  const incoming = await filterToExistingPhotoIds(client, photoIds);

  const personSet = new Set(personIds);
  const toAdd: string[] = [];
  for (const id of [...sessionIds, ...incoming]) {
    if (!personSet.has(id)) {
      personSet.add(id);
      toAdd.push(id);
    }
  }
  await insertFavorites(client, personOwner, toAdd);

  const { error } = await client
    .from("rachandzach_guest_favorites")
    .delete()
    .eq("owner_kind", sessionOwner.kind)
    .eq("owner_key", sessionOwner.key);
  if (error) {
    // The union landed; a failed session cleanup only leaves orphaned
    // session rows behind (retried implicitly on the next migrate call).
    throw new FavoritesPersistenceError("Could not clear session favorites.");
  }

  return listFavoritePhotoIds(client, personOwner);
}
