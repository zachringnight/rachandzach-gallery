/**
 * Live regression suite for the two guest-deletion data-loss paths fixed in
 * rachandzach_remove_added_person (migration 20260726213000):
 *
 *   1. FAVORITES: removing an added person whose slug holds person-keyed
 *      rachandzach_guest_favorites must degrade to a soft hide, and the
 *      shortlist must stay reachable through resolveFavoriteOwner.
 *   2. RACE: a rachandzach_photo_people insert interleaved with the remove
 *      must never be cascade-destroyed; either the person is kept or the
 *      insert fails its FK. This is exercised with genuinely concurrent
 *      requests (Promise.all) repeated across iterations.
 *
 * Follows the tests/database/schema.test.ts live-layer convention: gated on
 * SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY,
 * skips loudly otherwise, and cleans up every row it creates (all rows are
 * namespaced under the zz-live-remove- slug prefix). It never touches
 * rachandzach_photos beyond reading one existing photo id.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";

// people-server.ts is a server-only module; mock the marker exactly as
// tests/admin/people-server.test.ts does.
vi.mock("server-only", () => ({}));

import type { Database } from "@/lib/supabase/database.types";
import { addPerson, removePerson } from "@/lib/admin/people-server";
import {
  listFavoritePhotoIds,
  resolveFavoriteOwner,
} from "@/lib/favorites/server";

const liveUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const liveServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const serviceReady = Boolean(liveUrl && liveServiceKey);

if (!serviceReady) {
  process.stderr.write(
    [
      "",
      "==========================================================================",
      "  REMOVE-PERSON LIVE SUITE SKIPPED",
      "  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set; the atomic-delete",
      "  semantics were not exercised against a real database in this run.",
      "==========================================================================",
      "",
    ].join("\n"),
  );
}

const ACTOR = "wedding@rachandzach.com";
const SLUG_PREFIX = "zz-live-remove";
const SESSION_ID = "00000000-0000-4000-8000-00000000dead";

function uniqueSlug(label: string): string {
  return `${SLUG_PREFIX}-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

describe.skipIf(!serviceReady)("live: removePerson keeps its promises", () => {
  const service = () =>
    createClient<Database>(liveUrl!, liveServiceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  afterAll(async () => {
    // Belt-and-suspenders cleanup for anything a failed assertion left
    // behind; every row this suite creates is namespaced by SLUG_PREFIX.
    const client = service();
    const people = await client
      .from("rachandzach_people")
      .select("id, slug")
      .like("slug", `${SLUG_PREFIX}-%`);
    for (const person of people.data ?? []) {
      await client
        .from("rachandzach_photo_people")
        .delete()
        .eq("person_id", person.id);
    }
    await client
      .from("rachandzach_guest_favorites")
      .delete()
      .eq("owner_kind", "person")
      .like("owner_key", `${SLUG_PREFIX}-%`);
    await client
      .from("rachandzach_person_overrides")
      .delete()
      .like("person_slug", `${SLUG_PREFIX}-%`);
    await client
      .from("rachandzach_people")
      .delete()
      .like("slug", `${SLUG_PREFIX}-%`);
  });

  async function anyPhotoId(): Promise<string> {
    const { data, error } = await service()
      .from("rachandzach_photos")
      .select("id")
      .limit(1);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    return data![0].id;
  }

  it(
    "soft-hides an added person whose slug holds favorites, and the shortlist stays reachable",
    { timeout: 60_000 },
    async () => {
      const client = service();
      const slug = uniqueSlug("fav");
      const photoId = await anyPhotoId();

      await addPerson(slug, "Live Favorites Probe", ACTOR, client);
      const favInsert = await client.from("rachandzach_guest_favorites").insert({
        owner_kind: "person",
        owner_key: slug,
        photo_id: photoId,
      });
      expect(favInsert.error).toBeNull();

      // Zero photo tags, but a guest shortlist exists: must hide, not delete.
      const outcome = await removePerson(slug, ACTOR, client);
      expect(outcome).toBe("hidden");

      const person = await client
        .from("rachandzach_people")
        .select("slug")
        .eq("slug", slug)
        .maybeSingle();
      expect(person.data?.slug).toBe(slug);

      const owner = await resolveFavoriteOwner(client, SESSION_ID, slug);
      expect(owner).toEqual({ kind: "person", key: slug });
      expect(await listFavoritePhotoIds(client, owner)).toEqual([photoId]);

      // Once the shortlist is gone, the same call really deletes.
      const favDelete = await client
        .from("rachandzach_guest_favorites")
        .delete()
        .eq("owner_kind", "person")
        .eq("owner_key", slug);
      expect(favDelete.error).toBeNull();
      // The soft hide above wrote hidden = true; removing again must now
      // hard-delete both rows (the hidden flag is presentation, not a
      // reference).
      const second = await removePerson(slug, ACTOR, client);
      expect(second).toBe("deleted");
      const gone = await client
        .from("rachandzach_people")
        .select("slug")
        .eq("slug", slug)
        .maybeSingle();
      expect(gone.data).toBeNull();
      const overrideGone = await client
        .from("rachandzach_person_overrides")
        .select("person_slug")
        .eq("person_slug", slug)
        .maybeSingle();
      expect(overrideGone.data).toBeNull();
    },
  );

  it(
    "keeps an orphaned shortlist reachable even without a catalog row",
    { timeout: 60_000 },
    async () => {
      const client = service();
      const slug = uniqueSlug("orphan");
      const photoId = await anyPhotoId();

      // Simulate the historical bug: person-keyed rows whose catalog row is
      // already gone (or a favorite written in flight during a delete).
      const favInsert = await client.from("rachandzach_guest_favorites").insert({
        owner_kind: "person",
        owner_key: slug,
        photo_id: photoId,
      });
      expect(favInsert.error).toBeNull();

      const owner = await resolveFavoriteOwner(client, SESSION_ID, slug);
      expect(owner).toEqual({ kind: "person", key: slug });
      expect(await listFavoritePhotoIds(client, owner)).toEqual([photoId]);

      await client
        .from("rachandzach_guest_favorites")
        .delete()
        .eq("owner_kind", "person")
        .eq("owner_key", slug);
    },
  );

  it(
    "never destroys a committed tag when a tag insert races the remove",
    { timeout: 180_000 },
    async () => {
      const client = service();
      const photoId = await anyPhotoId();
      const iterations = 12;
      let observedKeeps = 0;
      let observedDeletes = 0;

      for (let i = 0; i < iterations; i += 1) {
        const slug = uniqueSlug(`race${i}`);
        await addPerson(slug, "Live Race Probe", ACTOR, client);
        const personRow = await client
          .from("rachandzach_people")
          .select("id")
          .eq("slug", slug)
          .single();
        expect(personRow.error).toBeNull();
        const personId = personRow.data!.id;

        // Genuinely concurrent: the tagger and the remover race.
        const [tag, outcome] = await Promise.all([
          client.from("rachandzach_photo_people").insert({
            photo_id: photoId,
            person_id: personId,
            source: "manual",
            confidence: "confirmed",
          }),
          removePerson(slug, ACTOR, client),
        ]);

        const tagRows = await client
          .from("rachandzach_photo_people")
          .select("photo_id")
          .eq("person_id", personId);
        const personAfter = await client
          .from("rachandzach_people")
          .select("id")
          .eq("id", personId)
          .maybeSingle();

        if (tag.error === null) {
          // THE invariant of bug 2: a tag whose insert succeeded may never
          // be cascade-destroyed by the remove. The person must have been
          // kept (outcome hidden) and the tag must still exist.
          expect(outcome).toBe("hidden");
          expect(personAfter.data?.id).toBe(personId);
          expect(tagRows.data?.length).toBe(1);
          observedKeeps += 1;
        } else {
          // The remove won: the insert must have failed its FK, and no tag
          // row may exist anywhere for the deleted person.
          expect(outcome).toBe("deleted");
          expect(personAfter.data).toBeNull();
          expect(tagRows.data?.length ?? 0).toBe(0);
          observedDeletes += 1;
        }

        // Per-iteration cleanup (afterAll sweeps stragglers).
        await client
          .from("rachandzach_photo_people")
          .delete()
          .eq("person_id", personId);
        await client
          .from("rachandzach_person_overrides")
          .delete()
          .eq("person_slug", slug);
        await client.from("rachandzach_people").delete().eq("id", personId);
      }

      // Both interleavings are legal; the loop only proves neither loses
      // data. Log the split so a fully one-sided run is visible.
      process.stderr.write(
        `\nremove-person race: ${observedKeeps} kept / ${observedDeletes} deleted over ${iterations} iterations\n`,
      );
    },
  );
});
