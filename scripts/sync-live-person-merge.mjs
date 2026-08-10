#!/usr/bin/env node
/**
 * Apply one already-reviewed metadata/person-merges.json rule to production.
 *
 * This command is deliberately separate from the local catalog merge tool:
 * local/catalog writes can be rebuilt, while live photo tags, favorites, and
 * memories need a recoverable insert-verify-delete sequence.
 *
 * Dry run by default:
 *   node scripts/sync-live-person-merge.mjs old-slug canonical-slug
 *   node scripts/sync-live-person-merge.mjs old-slug canonical-slug --execute
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import envPkg from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = envPkg;
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
loadEnvConfig(repoRoot, false);

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--execute");
if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);
const [fromSlug, intoSlug, extra] = args.filter((arg) => !arg.startsWith("--"));
const execute = args.includes("--execute");
if (!fromSlug || !intoSlug || extra) {
  throw new Error(
    "Usage: sync-live-person-merge.mjs <from-slug> <into-slug> [--execute]",
  );
}
if (fromSlug === intoSlug) throw new Error("Source and target slugs are identical");

const manifest = JSON.parse(
  await fs.readFile(join(repoRoot, "metadata", "person-merges.json"), "utf8"),
);
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.merges)) {
  throw new Error("metadata/person-merges.json has an unsupported shape");
}
const trackedRule = manifest.merges.find(
  (row) => row.fromSlug === fromSlug && row.intoSlug === intoSlug,
);
if (!trackedRule) {
  throw new Error(
    `Refusing an untracked live merge: ${fromSlug} -> ${intoSlug} is not in metadata/person-merges.json`,
  );
}

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error(
    "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY",
  );
}
const client = createClient(url, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

async function rows(label, query) {
  const { data, error } = await query;
  if (error) throw new Error(`${label} read failed: ${error.message}`);
  return data ?? [];
}

async function readState() {
  const people = await rows(
    "people",
    client
      .from("rachandzach_people")
      .select("id,slug,display_name,aliases,photo_count,created_at,updated_at")
      .in("slug", [fromSlug, intoSlug])
      .order("slug"),
  );
  const source = people.find((row) => row.slug === fromSlug) ?? null;
  const target = people.find((row) => row.slug === intoSlug) ?? null;
  if (!target) throw new Error(`Target identity ${intoSlug} is missing live`);

  const personIds = people.map((row) => row.id);
  const joins = personIds.length
    ? await rows(
        "photo_people",
        client
          .from("rachandzach_photo_people")
          .select("photo_id,person_id,source,confidence,created_at")
          .in("person_id", personIds)
          .order("person_id")
          .order("photo_id"),
      )
    : [];
  const [overrides, favorites, memories] = await Promise.all([
    rows(
      "person_overrides",
      client
        .from("rachandzach_person_overrides")
        .select(
          "person_slug,display_name,hidden,added,face_photo_id,face_crop_x,face_crop_y,face_crop_size,created_at,updated_at,updated_by",
        )
        .in("person_slug", [fromSlug, intoSlug])
        .order("person_slug"),
    ),
    rows(
      "guest_favorites",
      client
        .from("rachandzach_guest_favorites")
        .select("owner_kind,owner_key,photo_id,created_at")
        .eq("owner_kind", "person")
        .in("owner_key", [fromSlug, intoSlug])
        .order("owner_key")
        .order("photo_id"),
    ),
    rows(
      "photo_memories",
      client
        .from("rachandzach_photo_memories")
        .select(
          "id,photo_id,owner_kind,owner_key,display_name,body,status,created_at,reviewed_at",
        )
        .eq("owner_kind", "person")
        .in("owner_key", [fromSlug, intoSlug])
        .order("owner_key")
        .order("id"),
    ),
  ]);
  const { count: photoPeopleTotal, error: countError } = await client
    .from("rachandzach_photo_people")
    .select("*", { count: "exact", head: true });
  if (countError) throw new Error(`photo_people count failed: ${countError.message}`);

  return {
    capturedAt: new Date().toISOString(),
    people,
    source,
    target,
    joins,
    overrides,
    favorites,
    memories,
    photoPeopleTotal,
  };
}

function summarize(state) {
  const sourceJoins = state.source
    ? state.joins.filter((row) => row.person_id === state.source.id)
    : [];
  const targetJoins = state.joins.filter((row) => row.person_id === state.target.id);
  const targetPhotoIds = new Set(targetJoins.map((row) => row.photo_id));
  const sourceFavorites = state.favorites.filter((row) => row.owner_key === fromSlug);
  const targetFavorites = state.favorites.filter((row) => row.owner_key === intoSlug);
  const targetFavoriteIds = new Set(targetFavorites.map((row) => row.photo_id));
  const sourceMemories = state.memories.filter((row) => row.owner_key === fromSlug);
  return {
    sourcePresent: Boolean(state.source),
    targetPresent: true,
    sourcePhotoCount: state.source?.photo_count ?? 0,
    targetPhotoCount: state.target.photo_count,
    sourceJoins: sourceJoins.length,
    targetJoins: targetJoins.length,
    overlappingJoins: sourceJoins.filter((row) => targetPhotoIds.has(row.photo_id)).length,
    joinsToCopy: sourceJoins.filter((row) => !targetPhotoIds.has(row.photo_id)).length,
    sourceFavorites: sourceFavorites.length,
    favoritesToCopy: sourceFavorites.filter(
      (row) => !targetFavoriteIds.has(row.photo_id),
    ).length,
    sourceMemories: sourceMemories.length,
    sourceOverride: state.overrides.some((row) => row.person_slug === fromSlug),
    targetOverride: state.overrides.some((row) => row.person_slug === intoSlug),
    photoPeopleTotal: state.photoPeopleTotal,
  };
}

async function writeBackup(state, plan) {
  const directory = join(repoRoot, "metadata", "faces", "sync-backups");
  await fs.mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(directory, `${timestamp}-${fromSlug}-to-${intoSlug}-before.json`);
  await fs.writeFile(
    path,
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        operation: "live-person-merge",
        rule: trackedRule,
        plan,
        peopleBefore: state.people,
        joinsBefore: state.joins,
        overridesBefore: state.overrides,
        favoritesBefore: state.favorites,
        memoriesBefore: state.memories,
        photoPeopleTotalBefore: state.photoPeopleTotal,
      },
      null,
      2,
    )}\n`,
  );
  return path;
}

async function copyVerifyDeleteJoins(sourceId, targetId) {
  for (let pass = 0; pass < 5; pass += 1) {
    const sourceRows = await rows(
      "source photo_people",
      client
        .from("rachandzach_photo_people")
        .select("photo_id,person_id,source,confidence,created_at")
        .eq("person_id", sourceId)
        .order("photo_id"),
    );
    if (sourceRows.length === 0) return;

    for (const row of sourceRows) {
      const { error: copyError } = await client.from("rachandzach_photo_people").upsert(
        {
          photo_id: row.photo_id,
          person_id: targetId,
          source: row.source,
          confidence: row.confidence,
          created_at: row.created_at,
        },
        { onConflict: "photo_id,person_id", ignoreDuplicates: true },
      );
      if (copyError) {
        throw new Error(
          `Could not copy a source photo tag (${copyError.message}); nothing was deleted for that tag`,
        );
      }
      const { count: landed, error: verifyError } = await client
        .from("rachandzach_photo_people")
        .select("*", { count: "exact", head: true })
        .eq("photo_id", row.photo_id)
        .eq("person_id", targetId);
      if (verifyError || landed !== 1) {
        throw new Error(
          `Target photo-tag readback failed; the source tag was preserved (${verifyError?.message ?? `count ${landed}`})`,
        );
      }
      const { error: deleteError } = await client
        .from("rachandzach_photo_people")
        .delete()
        .eq("photo_id", row.photo_id)
        .eq("person_id", sourceId);
      if (deleteError) {
        throw new Error(
          `Target tag is safe, but the duplicate source tag could not be removed: ${deleteError.message}`,
        );
      }
    }
  }
  throw new Error("Source photo tags kept changing; stopped before retiring the identity");
}

async function copyVerifyDeleteFavorites() {
  for (let pass = 0; pass < 5; pass += 1) {
    const sourceRows = await rows(
      "source favorites",
      client
        .from("rachandzach_guest_favorites")
        .select("owner_kind,owner_key,photo_id,created_at")
        .eq("owner_kind", "person")
        .eq("owner_key", fromSlug)
        .order("photo_id"),
    );
    if (sourceRows.length === 0) return;

    for (const row of sourceRows) {
      const { error: copyError } = await client.from("rachandzach_guest_favorites").upsert(
        {
          owner_kind: "person",
          owner_key: intoSlug,
          photo_id: row.photo_id,
          created_at: row.created_at,
        },
        { onConflict: "owner_kind,owner_key,photo_id", ignoreDuplicates: true },
      );
      if (copyError) {
        throw new Error(
          `Could not copy a favorite (${copyError.message}); the source favorite was preserved`,
        );
      }
      const { count: landed, error: verifyError } = await client
        .from("rachandzach_guest_favorites")
        .select("*", { count: "exact", head: true })
        .eq("owner_kind", "person")
        .eq("owner_key", intoSlug)
        .eq("photo_id", row.photo_id);
      if (verifyError || landed !== 1) {
        throw new Error(
          `Target favorite readback failed; the source favorite was preserved (${verifyError?.message ?? `count ${landed}`})`,
        );
      }
      const { error: deleteError } = await client
        .from("rachandzach_guest_favorites")
        .delete()
        .eq("owner_kind", "person")
        .eq("owner_key", fromSlug)
        .eq("photo_id", row.photo_id);
      if (deleteError) {
        throw new Error(
          `Target favorite is safe, but the source favorite could not be removed: ${deleteError.message}`,
        );
      }
    }
  }
  throw new Error("Source favorites kept changing; stopped before retiring the identity");
}

async function moveAndVerifyMemories() {
  for (let pass = 0; pass < 5; pass += 1) {
    const sourceRows = await rows(
      "source memories",
      client
        .from("rachandzach_photo_memories")
        .select("id")
        .eq("owner_kind", "person")
        .eq("owner_key", fromSlug)
        .order("id"),
    );
    if (sourceRows.length === 0) return;
    const ids = sourceRows.map((row) => row.id);
    const { error: moveError } = await client
      .from("rachandzach_photo_memories")
      .update({ owner_key: intoSlug })
      .eq("owner_kind", "person")
      .eq("owner_key", fromSlug)
      .in("id", ids);
    if (moveError) {
      throw new Error(`Could not move source memory ownership: ${moveError.message}`);
    }
    const moved = await rows(
      "moved memories",
      client
        .from("rachandzach_photo_memories")
        .select("id")
        .eq("owner_kind", "person")
        .eq("owner_key", intoSlug)
        .in("id", ids),
    );
    if (moved.length !== ids.length) {
      throw new Error(
        `Memory ownership readback failed: expected ${ids.length}, found ${moved.length}`,
      );
    }
  }
  throw new Error("Source memories kept changing; stopped before retiring the identity");
}

async function assertNoSourceReferences(sourceId) {
  const [joins, favorites, memories] = await Promise.all([
    rows(
      "remaining source photo_people",
      client.from("rachandzach_photo_people").select("photo_id").eq("person_id", sourceId),
    ),
    rows(
      "remaining source favorites",
      client
        .from("rachandzach_guest_favorites")
        .select("photo_id")
        .eq("owner_kind", "person")
        .eq("owner_key", fromSlug),
    ),
    rows(
      "remaining source memories",
      client
        .from("rachandzach_photo_memories")
        .select("id")
        .eq("owner_kind", "person")
        .eq("owner_key", fromSlug),
    ),
  ]);
  if (joins.length || favorites.length || memories.length) {
    throw new Error(
      `Source still has ${joins.length} tags, ${favorites.length} favorites, and ${memories.length} memories; identity was not retired`,
    );
  }
}

async function retireSourceAtomically(source) {
  await assertNoSourceReferences(source.id);

  // The existing RPC is the production-safe deletion primitive: it locks the
  // person row and rechecks photo tags/favorites in the same transaction, so
  // a concurrent tag cannot be cascade-deleted. A hidden temporary override
  // marks this reviewed duplicate as removable; the RPC deletes that marker
  // and the catalog row together.
  const { error: markerError } = await client.from("rachandzach_person_overrides").upsert(
    {
      person_slug: fromSlug,
      display_name: source.display_name,
      hidden: true,
      added: true,
      updated_by: "codex/live-person-merge",
    },
    { onConflict: "person_slug" },
  );
  if (markerError) throw new Error(`Could not create safe-removal marker: ${markerError.message}`);

  const { data, error } = await client.rpc("rachandzach_remove_added_person", {
    p_slug: fromSlug,
  });
  if (error) throw new Error(`Atomic identity retirement failed: ${error.message}`);
  if (data !== "deleted" && data !== "missing") {
    throw new Error(
      `Atomic identity retirement returned ${String(data)}; the source remains hidden and recoverable`,
    );
  }
}

const before = await readState();
const beforePlan = summarize(before);
if (!execute) {
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        fromSlug,
        intoSlug,
        ...beforePlan,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const backupPath = await writeBackup(before, beforePlan);
if (before.source) {
  await copyVerifyDeleteJoins(before.source.id, before.target.id);
}
await copyVerifyDeleteFavorites();
await moveAndVerifyMemories();
if (before.source) {
  await retireSourceAtomically(before.source);
}

// Close the no-FK owner-key race described in the removal RPC: if a favorite
// or memory landed under the old slug during retirement, move it now that no
// new photo tag can reference the deleted person row.
await copyVerifyDeleteFavorites();
await moveAndVerifyMemories();

const staleOverride = await rows(
  "stale source override",
  client
    .from("rachandzach_person_overrides")
    .select("person_slug")
    .eq("person_slug", fromSlug),
);
if (staleOverride.length > 0) {
  const { error } = await client
    .from("rachandzach_person_overrides")
    .delete()
    .eq("person_slug", fromSlug);
  if (error) throw new Error(`Could not clear stale source override: ${error.message}`);
}

const after = await readState();
const afterPlan = summarize(after);
if (
  after.source ||
  afterPlan.sourceJoins !== 0 ||
  afterPlan.sourceFavorites !== 0 ||
  afterPlan.sourceMemories !== 0 ||
  afterPlan.sourceOverride
) {
  throw new Error("Final readback found source identity data; merge is incomplete but backed up");
}
const expectedTotal = before.photoPeopleTotal - beforePlan.overlappingJoins;
if (after.photoPeopleTotal !== expectedTotal) {
  throw new Error(
    `Unexpected photo_people total after merge: ${after.photoPeopleTotal} != ${expectedTotal}`,
  );
}

console.log(
  JSON.stringify(
    {
      mode: "executed-and-verified",
      fromSlug,
      intoSlug,
      backupPath,
      before: beforePlan,
      after: afterPlan,
      expectedPhotoPeopleTotal: expectedTotal,
    },
    null,
    2,
  ),
);
