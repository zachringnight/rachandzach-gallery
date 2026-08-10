#!/usr/bin/env node
// Narrow, additive live sync for the tracked seating roster and visually
// reviewed saved-face tags.
//
// Default is a read-only plan. --execute performs only:
//   1. rachandzach_add_person RPCs for missing seated attendees, and
//   2. confirmed manual rachandzach_photo_people upserts for reviewed pairs.
//
// It never deletes or renames identities/tags, never touches storage, and
// writes a local ignored pre-state backup before the first mutation. Tracked
// person merges are reported as pending but are never executed by this
// additive-only command.

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import envPkg from "@next/env";
import { planLiveCatalogSync } from "./lib/catalog-sync-plan.mjs";

const { loadEnvConfig } = envPkg;
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
loadEnvConfig(repoRoot, false);

const execute = process.argv.includes("--execute");
const unknown = process.argv.slice(2).filter((arg) => arg !== "--execute");
if (unknown.length > 0) {
  console.error(`Unknown argument: ${unknown[0]}`);
  process.exit(2);
}

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error(
    "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const client = createClient(url, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const [attendance, reviewedTags, personMerges] = await Promise.all([
  fs
    .readFile(join(repoRoot, "metadata", "wedding-attendees.json"), "utf8")
    .then((value) => JSON.parse(value)),
  fs
    .readFile(
      join(repoRoot, "metadata", "reviewed-face-tag-additions.json"),
      "utf8",
    )
    .then((value) => JSON.parse(value)),
  fs
    .readFile(join(repoRoot, "metadata", "person-merges.json"), "utf8")
    .then((value) => JSON.parse(value)),
]);

async function allRows(table, columns, orderColumns = ["id"]) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = client.from(table).select(columns);
    for (const column of orderColumns) {
      query = query.order(column, { ascending: true });
    }
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) {
      throw new Error(`${table} read failed: ${error.message}`);
    }
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return rows;
  }
}

async function readLiveState() {
  const [people, overrides, photos, joins] = await Promise.all([
    allRows(
      "rachandzach_people",
      "id, slug, display_name, photo_count",
      ["slug"],
    ),
    allRows(
      "rachandzach_person_overrides",
      "person_slug, display_name, hidden, added, face_photo_id, updated_at, updated_by",
      ["person_slug"],
    ),
    allRows(
      "rachandzach_photos",
      "id, image_data_hash, status",
      ["image_data_hash"],
    ),
    allRows(
      "rachandzach_photo_people",
      "photo_id, person_id, source, confidence",
      ["photo_id", "person_id"],
    ),
  ]);
  return { people, overrides, photos, joins };
}

async function writeBackup(state, plan) {
  const directory = join(repoRoot, "metadata", "faces", "sync-backups");
  await fs.mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(directory, `${timestamp}-catalog-overlays-before.json`);
  const relevantPersonSlugs = new Set([
    ...attendance.attendees.map((row) => row.personSlug),
    ...reviewedTags.additions.map((row) => row.personSlug),
    ...personMerges.merges.flatMap((row) => [row.fromSlug, row.intoSlug]),
  ]);
  const candidateHashes = new Set(
    reviewedTags.additions.map((row) => row.photoId),
  );
  const candidatePhotoIds = new Set(
    state.photos
      .filter((row) => candidateHashes.has(row.image_data_hash))
      .map((row) => row.id),
  );
  const snapshot = {
    capturedAt: new Date().toISOString(),
    mode: "additive-only",
    plan,
    peopleBefore: state.people.filter((row) =>
      relevantPersonSlugs.has(row.slug),
    ),
    overridesBefore: state.overrides.filter((row) =>
      relevantPersonSlugs.has(row.person_slug),
    ),
    candidateJoinsBefore: state.joins.filter((row) =>
      candidatePhotoIds.has(row.photo_id),
    ),
  };
  await fs.writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return path;
}

let state = await readLiveState();
let plan = planLiveCatalogSync(state, {
  attendance,
  reviewedTags,
  personMerges,
});
const dryRunSummary = {
  mode: execute ? "execute" : "dry-run",
  ...plan.liveCounts,
  seatedAttendees: attendance.attendees.length,
  peopleToAdd: plan.peopleToAdd.length,
  effectiveNameOverrides: plan.effectiveNameOverrides.length,
  hiddenNameOverrides: plan.hiddenNameOverrides.length,
  personMergesPending: plan.personMergesPending.length,
  pendingPersonMerges: plan.personMergesPending,
  reviewedTags: reviewedTags.additions.length,
  tagsToAdd: plan.tagsToAdd.length,
  tagsAlreadyPresent: plan.tagsAlreadyPresent.length,
};

if (!execute) {
  console.log(JSON.stringify(dryRunSummary, null, 2));
  process.exit(0);
}

const backupPath = await writeBackup(state, plan);
const actor = "codex/expand-saved-face-tags";
for (const person of plan.peopleToAdd) {
  const { data, error } = await client.rpc("rachandzach_add_person", {
    p_slug: person.slug,
    p_display_name: person.displayName,
    p_actor: actor,
  });
  if (error || data !== "added") {
    throw new Error(
      `Could not add ${person.slug}: ${error?.message ?? String(data)}`,
    );
  }
}

// Re-read after identity creation so tag rows always use authoritative ids.
state = await readLiveState();
plan = planLiveCatalogSync(state, { attendance, reviewedTags, personMerges });
for (let index = 0; index < plan.tagsToAdd.length; index += 100) {
  const batch = plan.tagsToAdd.slice(index, index + 100);
  const { error } = await client.from("rachandzach_photo_people").upsert(
    batch.map((row) => ({
      photo_id: row.photo_id,
      person_id: row.person_id,
      source: "manual",
      confidence: "confirmed",
    })),
    { onConflict: "photo_id,person_id" },
  );
  if (error) {
    throw new Error(`Reviewed tag batch failed: ${error.message}`);
  }
}

const verifiedState = await readLiveState();
const verifiedPlan = planLiveCatalogSync(verifiedState, {
  attendance,
  reviewedTags,
  personMerges,
});
if (
  verifiedPlan.peopleToAdd.length !== 0 ||
  verifiedPlan.tagsToAdd.length !== 0
) {
  throw new Error(
    `Live verification failed: ${verifiedPlan.peopleToAdd.length} people and ` +
      `${verifiedPlan.tagsToAdd.length} tags still missing`,
  );
}

console.log(
  JSON.stringify(
    {
      ...dryRunSummary,
      mode: "executed-and-verified-additive-only",
      backupPath,
      peopleAdded: dryRunSummary.peopleToAdd,
      // plan was recomputed after the people adds and immediately before the
      // tag write, so this is the exact number of new join rows attempted.
      tagsAdded: plan.tagsToAdd.length,
      verifiedPeopleTotal: verifiedState.people.length,
      verifiedPhotoPeopleTotal: verifiedState.joins.length,
    },
    null,
    2,
  ),
);
