#!/usr/bin/env node
// Export Rachel's /admin/faces decisions back to version-controlled source.
//
// THE ROUND TRIP (how a web decision becomes committed source):
//   1. Rachel picks a photo and frames a square crop at /admin/faces.
//      That writes rachandzach_person_overrides in Supabase: the photo's id
//      plus a normalized crop (x = left/width, y = top/height,
//      size = side/min(width, height) -- fractions of the photo's pixel
//      grid, documented in the table's migration).
//   2. The deployed site renders those overrides live by CSS-cropping the
//      signed preview (no file writes; Vercel's filesystem is read-only).
//   3. On Zach's Mac, THIS script pulls the override rows and writes
//      metadata/faces/face-overrides.json, translating each photo's
//      database id to its imageDataHash (the directory name under
//      metadata/import/derivatives/previews/, taken from the photo's
//      preview object path).
//   4. `node scripts/build-face-thumbnails.mjs` reads that file and
//      regenerates the committed crops in public/faces/ (and the
//      src/generated/face-thumbnails.json manifest) from the local
//      derivatives -- see its header for the override contract.
//   5. Commit the regenerated crops + manifest. (metadata/faces/ itself is
//      gitignored AND vercelignored on purpose -- it stays on this Mac --
//      but public/faces/*.webp and src/generated/face-thumbnails.json are
//      committed, so Rachel's choices become version-controlled source and
//      survive even if the database rows are ever lost.)
//
// Renames, hidden flags, and added people are runtime concerns (applied
// straight from Supabase); they are exported here too, under "names",
// "hidden", and "added", so the decisions are version-controlled.
// build-face-thumbnails.mjs only consumes the "people" section.
//
// The default output is src/generated/, which is TRACKED, alongside
// gallery-v2.json (which already carries every guest name) and
// face-thumbnails.json. It used to default under metadata/faces/, which
// .gitignore excludes -- so nothing this script wrote was ever committed and
// the "version-controlled" claim above was false: lose the database and the
// renames, hidden flags and added people went with it. Commit the output.
//
// Requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and
// SUPABASE_SERVICE_ROLE_KEY in the environment / .env.local. Read-only
// against the database; writes only the --out file.
//
// Usage: node scripts/export-face-overrides.mjs [--out src/generated/person-overrides.json]
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import envPkg from "@next/env";

const { loadEnvConfig } = envPkg;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(repoRoot, false);

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 || i === process.argv.length - 1 ? fallback : process.argv[i + 1];
}

const OUT_PATH = resolve(
  repoRoot,
  argValue("--out", "src/generated/person-overrides.json"),
);

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error(
    "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const client = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const { data, error } = await client
  .from("rachandzach_person_overrides")
  .select(
    "person_slug, display_name, hidden, added, face_crop_x, face_crop_y, face_crop_size, updated_at, photo:rachandzach_photos!rachandzach_person_overrides_face_photo_id_fkey ( image_data_hash )",
  )
  .order("person_slug", { ascending: true });
if (error) {
  console.error(`Override query failed: ${error.message}`);
  process.exit(1);
}

const people = {};
const names = {};
const hidden = [];
const added = {};
for (const row of data ?? []) {
  const hash = row.photo?.image_data_hash ?? null;
  if (
    hash &&
    row.face_crop_x !== null &&
    row.face_crop_y !== null &&
    row.face_crop_size !== null
  ) {
    people[row.person_slug] = {
      photoId: hash,
      crop: { x: row.face_crop_x, y: row.face_crop_y, size: row.face_crop_size },
    };
  }
  if (row.display_name && !row.added) names[row.person_slug] = row.display_name;
  if (row.hidden) hidden.push(row.person_slug);
  if (row.added) added[row.person_slug] = row.display_name ?? row.person_slug;
}

await fs.mkdir(dirname(OUT_PATH), { recursive: true });
await fs.writeFile(
  OUT_PATH,
  `${JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      people,
      names,
      hidden,
      added,
    },
    null,
    2,
  )}\n`,
);

console.log(`wrote ${OUT_PATH}`);
console.log(
  `face crops: ${Object.keys(people).length}, renames: ${Object.keys(names).length}, hidden: ${hidden.length}, added: ${Object.keys(added).length}`,
);
console.log(
  "next: node scripts/build-face-thumbnails.mjs  (regenerates the committed public/faces crops from these choices)",
);
