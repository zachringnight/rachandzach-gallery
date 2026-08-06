#!/usr/bin/env node
/**
 * Merge one guest identity into another, everywhere it exists.
 *
 * Different from a rename (scripts/rename-person-in-master.py, which changes
 * the spelling of ONE identity). This is for the case where the same person
 * was recorded twice under two names, usually a maiden and a married name,
 * and the two records have to become one without losing a single tag.
 *
 * Four layers, and all four have to agree or the guest sees one name on the
 * site and a different one in the photograph's own metadata twenty years from
 * now:
 *
 *   1. metadata/reviewed-face-tag-additions.json   the reviewed overlay
 *   2. src/generated/gallery-v2.json               the local catalog
 *   3. the clean master's embedded XMP/IPTC names  (delegated, see below)
 *   4. the live database                           what guests actually read
 *
 * Layer 3 is deliberately NOT done here: rename-person-in-master.py already
 * does it with an ImageDataHash check proving no pixel moved, and duplicating
 * that logic badly is how originals get damaged. This prints the exact
 * command instead.
 *
 * Dry run by default.
 *
 *   node scripts/face/merge-person.mjs joan-soskin joan-auwerter
 *   node scripts/face/merge-person.mjs joan-soskin joan-auwerter --write
 */
import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ADDITIONS = join(repoRoot, "metadata/reviewed-face-tag-additions.json");
const CATALOG = join(repoRoot, "src/generated/gallery-v2.json");

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

/** Temp file, then rename: a half-written catalog is worse than none. */
async function writeJson(path, value) {
  const temp = `${path}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 1)}\n`);
  await fs.rename(temp, path);
}

async function main() {
  const [from, into] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const write = process.argv.includes("--write");
  if (!from || !into) throw new Error("usage: merge-person.mjs <from-slug> <into-slug>");
  if (from === into) throw new Error("those are the same person");

  const [additions, catalog] = await Promise.all([readJson(ADDITIONS), readJson(CATALOG)]);

  const fromPerson = catalog.people.find((person) => person.slug === from);
  const intoPerson = catalog.people.find((person) => person.slug === into);
  if (!fromPerson) throw new Error(`${from} is not in the catalog`);
  if (!intoPerson) throw new Error(`${into} is not in the catalog`);

  console.log(write ? "WRITING" : "DRY RUN, nothing will be written");
  console.log(`\n  ${fromPerson.name} (${from})  ->  ${intoPerson.name} (${into})\n`);

  // 1. reviewed additions
  const overlayRows = additions.additions.filter((row) => row.personSlug === from);
  for (const row of overlayRows) {
    row.personSlug = into;
    row.displayName = intoPerson.name;
  }
  console.log(`  reviewed overlay:  ${overlayRows.length} rows`);

  // 2. local catalog. Union rather than replace: a photograph that somehow
  // carries both names must end with one, not a duplicate.
  const touched = [];
  for (const photo of catalog.photos) {
    const slugs = photo.peopleSlugs ?? [];
    if (!slugs.includes(from)) continue;
    const next = slugs.filter((slug) => slug !== from);
    if (!next.includes(into)) next.push(into);
    photo.peopleSlugs = next.sort();
    touched.push(photo.originalRelativePath);
  }
  console.log(`  local catalog:     ${touched.length} photographs`);
  for (const path of touched) console.log(`      ${path}`);

  catalog.people = catalog.people.filter((person) => person.slug !== from);
  console.log(`  catalog people:    ${from} removed, ${catalog.people.length} remain`);

  // 4. live database
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let liveRows = null;
  if (url && key) {
    const client = createClient(url, key);
    const { data: people } = await client
      .from("rachandzach_people")
      .select("id,slug,display_name")
      .in("slug", [from, into]);
    const fromLive = people?.find((person) => person.slug === from);
    const intoLive = people?.find((person) => person.slug === into);
    if (fromLive && intoLive) {
      const { data: rows } = await client
        .from("rachandzach_photo_people")
        .select("photo_id")
        .eq("person_id", fromLive.id);
      liveRows = rows ?? [];
      console.log(`  live database:     ${liveRows.length} photo_people rows to move`);
      if (write) {
        for (const row of liveRows) {
          // Insert first, then delete, and DO NOT delete unless the insert is
          // confirmed present. The first version of this wrote a column that
          // does not exist ("status" instead of "confidence"), ignored the
          // error, and deleted anyway, which destroyed three live tags. The
          // ordering was never the protection; checking the result is.
          const { error: insertError } = await client
            .from("rachandzach_photo_people")
            .upsert(
              {
                photo_id: row.photo_id,
                person_id: intoLive.id,
                source: "manual",
                confidence: "confirmed",
              },
              { onConflict: "photo_id,person_id" },
            );
          if (insertError) {
            throw new Error(
              `refusing to continue: could not give ${into} photo ${row.photo_id} ` +
                `(${insertError.message}). Nothing was deleted.`,
            );
          }
          const { count: landed } = await client
            .from("rachandzach_photo_people")
            .select("*", { count: "exact", head: true })
            .eq("photo_id", row.photo_id)
            .eq("person_id", intoLive.id);
          if (!landed) {
            throw new Error(
              `refusing to continue: ${into} still has no row for photo ${row.photo_id} ` +
                `after the write. Nothing was deleted.`,
            );
          }
          const { error: deleteError } = await client
            .from("rachandzach_photo_people")
            .delete()
            .eq("photo_id", row.photo_id)
            .eq("person_id", fromLive.id);
          if (deleteError) {
            throw new Error(
              `${into} now has photo ${row.photo_id} but ${from} could not be ` +
                `cleared (${deleteError.message}). The tag exists twice; fix by hand.`,
            );
          }
        }
        const { count } = await client
          .from("rachandzach_photo_people")
          .select("*", { count: "exact", head: true })
          .eq("person_id", intoLive.id);
        console.log(`  live verified:     ${into} now has ${count} rows`);
      }
    } else {
      console.log("  live database:     one of the two slugs is not live, skipped");
    }
  } else {
    console.log("  live database:     no credentials in the environment, skipped");
  }

  if (write) {
    await writeJson(ADDITIONS, additions);
    await writeJson(CATALOG, catalog);
    console.log("\nWritten. Still to do, for the photographs' own metadata:");
    console.log(
      `  python3 scripts/rename-person-in-master.py "${fromPerson.name}" "${intoPerson.name}" --write`,
    );
    console.log("  python3 scripts/sync-manifest-after-write.py");
  } else {
    console.log("\nRe-run with --write to apply.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
