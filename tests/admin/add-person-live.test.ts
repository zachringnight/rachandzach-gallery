/**
 * Live regression suite for the guest-creation data-loss window fixed in
 * rachandzach_add_person (migration 20260726233000):
 *
 *   1. RACE: the old addPerson committed the rachandzach_people row in its
 *      own transaction, and a failed override insert triggered a
 *      compensating unconditional delete in a THIRD transaction. A
 *      rachandzach_photo_people tag committed in the window between them
 *      was silently cascade-destroyed (person_id is ON DELETE CASCADE).
 *      With the atomic RPC, a person a tagger can see is always fully
 *      created and nothing in the add path can ever delete it.
 *   2. LOST RESPONSE / DUPLICATE: any unique violation inside the RPC rolls
 *      back BOTH inserts, so no half-created person (catalog row without
 *      override, or the reverse) can escape, and no compensating delete
 *      exists to orphan a committed override.
 *
 * The race is exercised with genuinely concurrent requests (Promise.all): a
 * tagger polls for the person row and tags the instant it becomes visible,
 * repeated across iterations covering both interleavings (add commits and
 * the tag must survive; add rolls back and the person must never have been
 * visible).
 *
 * Follows the tests/admin/remove-person-live.test.ts convention: gated on
 * SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY,
 * skips loudly otherwise, and cleans up every row it creates (all rows are
 * namespaced under the zz-live-add- slug prefix). It never touches
 * rachandzach_photos beyond reading one existing photo id.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";

// people-server.ts is a server-only module; mock the marker exactly as
// tests/admin/people-server.test.ts does.
vi.mock("server-only", () => ({}));

import type { Database } from "@/lib/supabase/database.types";
import { addPerson } from "@/lib/admin/people-server";

const liveUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const liveServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const serviceReady = Boolean(liveUrl && liveServiceKey);

if (!serviceReady) {
  process.stderr.write(
    [
      "",
      "==========================================================================",
      "  ADD-PERSON LIVE SUITE SKIPPED",
      "  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set; the atomic-add",
      "  semantics were not exercised against a real database in this run.",
      "==========================================================================",
      "",
    ].join("\n"),
  );
}

const ACTOR = "wedding@rachandzach.com";
const SLUG_PREFIX = "zz-live-add";

function uniqueSlug(label: string): string {
  return `${SLUG_PREFIX}-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

describe.skipIf(!serviceReady)("live: addPerson keeps its promises", () => {
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
    "creates both rows together; a duplicate 409s and touches nothing",
    { timeout: 60_000 },
    async () => {
      const client = service();
      const slug = uniqueSlug("pair");

      await addPerson(slug, "Live Add Probe", ACTOR, client);

      const person = await client
        .from("rachandzach_people")
        .select("slug, display_name, photo_count")
        .eq("slug", slug)
        .maybeSingle();
      expect(person.data).toMatchObject({
        slug,
        display_name: "Live Add Probe",
        // The trigger owns photo_count; the RPC must not set it.
        photo_count: 0,
      });
      const override = await client
        .from("rachandzach_person_overrides")
        .select("person_slug, display_name, added, updated_by")
        .eq("person_slug", slug)
        .maybeSingle();
      expect(override.data).toMatchObject({
        person_slug: slug,
        display_name: "Live Add Probe",
        added: true,
        updated_by: ACTOR,
      });

      await expect(
        addPerson(slug, "Second Attempt", ACTOR, client),
      ).rejects.toMatchObject({ name: "PersonAdminError", status: 409 });
      const after = await client
        .from("rachandzach_people")
        .select("display_name")
        .eq("slug", slug);
      expect(after.data).toEqual([{ display_name: "Live Add Probe" }]);

      // Cleanup (afterAll sweeps stragglers).
      await client
        .from("rachandzach_person_overrides")
        .delete()
        .eq("person_slug", slug);
      await client.from("rachandzach_people").delete().eq("slug", slug);
    },
  );

  it(
    "rolls the catalog row back too when the override slot is already claimed",
    { timeout: 60_000 },
    async () => {
      const client = service();
      const slug = uniqueSlug("orphan");

      // A pre-backfill orphan: an added override with no catalog row. This
      // is the natural way the OLD code's second insert failed; back then
      // the catalog row had already committed and the compensation had to
      // delete it in a third transaction. Now the same conflict rolls the
      // catalog insert back inside the function -- prove it directly at the
      // RPC level, below the server's friendlier pre-check.
      const plant = await client.from("rachandzach_person_overrides").insert({
        person_slug: slug,
        display_name: "Orphan Override",
        added: true,
        updated_by: ACTOR,
      });
      expect(plant.error).toBeNull();

      const { data, error } = await client.rpc("rachandzach_add_person", {
        p_slug: slug,
        p_display_name: "Live Orphan Probe",
        p_actor: ACTOR,
      });
      expect(error).toBeNull();
      expect(data).toBe("duplicate");

      // The catalog insert succeeded inside the function, then rolled back
      // with the override conflict: no window, no partial state.
      const person = await client
        .from("rachandzach_people")
        .select("slug")
        .eq("slug", slug)
        .maybeSingle();
      expect(person.data).toBeNull();
      const override = await client
        .from("rachandzach_person_overrides")
        .select("display_name")
        .eq("person_slug", slug)
        .maybeSingle();
      expect(override.data).toEqual({ display_name: "Orphan Override" });

      await client
        .from("rachandzach_person_overrides")
        .delete()
        .eq("person_slug", slug);
    },
  );

  it(
    "never exposes a person a tagger can tag unless the add fully committed",
    { timeout: 180_000 },
    async () => {
      const client = service();
      const photoId = await anyPhotoId();
      const iterations = 12;
      let taggedCommittedAdds = 0;
      let invisibleRolledBackAdds = 0;

      // The tagger from the original bug report: /admin/catalog reads the
      // new person the moment it is visible and writes a tag. Polls hard so
      // it lands inside what used to be the compensation window.
      async function tagAsSoonAsVisible(slug: string, deadlineMs: number) {
        const tagger = service();
        const deadline = Date.now() + deadlineMs;
        while (Date.now() < deadline) {
          const { data } = await tagger
            .from("rachandzach_people")
            .select("id")
            .eq("slug", slug)
            .maybeSingle();
          if (data?.id) {
            const tag = await tagger.from("rachandzach_photo_people").insert({
              photo_id: photoId,
              person_id: data.id,
              source: "manual",
              confidence: "confirmed",
            });
            return { sawPerson: true, personId: data.id, tagError: tag.error };
          }
        }
        return { sawPerson: false, personId: null, tagError: null };
      }

      for (let i = 0; i < iterations; i += 1) {
        const slug = uniqueSlug(`race${i}`);
        // Odd iterations force the rollback interleaving: the override slot
        // is already claimed, so the RPC must undo its catalog insert. Even
        // iterations are clean adds.
        const conflicted = i % 2 === 1;
        if (conflicted) {
          const plant = await client
            .from("rachandzach_person_overrides")
            .insert({
              person_slug: slug,
              display_name: "Race Conflict",
              added: true,
              updated_by: ACTOR,
            });
          expect(plant.error).toBeNull();
        }

        // Genuinely concurrent: the add and the tagger race.
        const [rpc, tagger] = await Promise.all([
          client.rpc("rachandzach_add_person", {
            p_slug: slug,
            p_display_name: "Live Race Probe",
            p_actor: ACTOR,
          }),
          tagAsSoonAsVisible(slug, conflicted ? 1_500 : 10_000),
        ]);
        expect(rpc.error).toBeNull();

        const personAfter = await client
          .from("rachandzach_people")
          .select("id")
          .eq("slug", slug)
          .maybeSingle();
        const overrideAfter = await client
          .from("rachandzach_person_overrides")
          .select("display_name, added")
          .eq("person_slug", slug)
          .maybeSingle();

        if (rpc.data === "added") {
          // THE invariant of the fix: once anyone can see the person, both
          // rows are committed and nothing in the add path will ever delete
          // them -- so a tag written at first visibility must survive.
          expect(conflicted).toBe(false);
          expect(personAfter.data?.id).toBeTruthy();
          expect(overrideAfter.data).toMatchObject({
            display_name: "Live Race Probe",
            added: true,
          });
          expect(tagger.sawPerson).toBe(true);
          expect(tagger.tagError).toBeNull();
          const tagRows = await client
            .from("rachandzach_photo_people")
            .select("photo_id")
            .eq("person_id", personAfter.data!.id);
          expect(tagRows.data?.length).toBe(1);
          taggedCommittedAdds += 1;
        } else {
          // Rolled back: the person may NEVER have become visible, so the
          // tagger cannot have tagged anything that later vanished. This is
          // the interleaving that used to destroy data.
          expect(rpc.data).toBe("duplicate");
          expect(conflicted).toBe(true);
          expect(personAfter.data).toBeNull();
          expect(tagger.sawPerson).toBe(false);
          expect(tagger.tagError).toBeNull();
          invisibleRolledBackAdds += 1;
        }

        // Per-iteration cleanup (afterAll sweeps stragglers).
        if (personAfter.data?.id) {
          await client
            .from("rachandzach_photo_people")
            .delete()
            .eq("person_id", personAfter.data.id);
        }
        await client
          .from("rachandzach_person_overrides")
          .delete()
          .eq("person_slug", slug);
        await client.from("rachandzach_people").delete().eq("slug", slug);
      }

      // Both interleavings must actually have been exercised.
      expect(taggedCommittedAdds).toBeGreaterThan(0);
      expect(invisibleRolledBackAdds).toBeGreaterThan(0);
      process.stderr.write(
        `\nadd-person race: ${taggedCommittedAdds} tagged committed adds / ${invisibleRolledBackAdds} invisible rolled-back adds over ${iterations} iterations\n`,
      );
    },
  );
});
