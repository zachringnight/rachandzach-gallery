# Wave 2 review: packet 13 catalog and private-media sync

Static, adversarial review. No commands run, no network, no builds. Target: the
landed packet 13 code only.

Files reviewed:
- scripts/sync-gallery-storage.mjs
- scripts/sync-gallery-catalog.mjs
- src/lib/import/sync-contracts.ts
- src/lib/import/sync-state.ts
- tests/import/storage-sync.test.mjs
- tests/import/catalog-sync.test.mjs
- tests/fixtures/sync/mock-clients.mjs, tests/fixtures/catalog.json
- metadata/import/gallery-sync-report.json
Cross-checked against: supabase/migrations/202607220001_gallery_core.sql,
src/lib/supabase/schema.ts, src/types/gallery.ts, and the verified API contract
in spikes/platform-apis.md.

## Verdict

This is solid, defensively written code. Dry-run purity, the execution gate,
upload integrity, retry keying, secret hygiene, and the storage-before-catalog
gate all hold up under adversarial reading. The real names line up with the
landed shared-project schema (rachandzach_ tables, rachandzach- buckets,
column names, check constraints). No critical defect found. The findings below
are one genuine atomicity gap (Medium), a spec-vs-implementation counting
semantics gap (Low-Medium), and several Low/robustness items.

---

## Findings (ranked)

### 1. MEDIUM: photo rows are published before their preview and join rows in the same non-transactional batch

scripts/sync-gallery-catalog.mjs:352-424 (`upsertPhotoBatch`).

The batch upserts `rachandzach_photos` first with `status: "published"`
(CATALOG_TO_DB_STATUS maps approved -> published, line 364), and only afterward
upserts `rachandzach_photo_previews`, `rachandzach_photo_people`, and
`rachandzach_photo_keywords` (lines 366-424). supabase-js has no client
transaction, which the header comment acknowledges, so these are four separate
HTTP round-trips.

The packet's own ordering rule is "Upload original and required previews before
inserting or updating the photo row" and the whole storage gate exists so a
visible catalog row never precedes its media. Inserting the photo as `published`
and only then inserting the preview rows defeats that guarantee at the row
level: the photo is discoverable and marked published the instant the photos
upsert commits, but the rows a reader needs to render a thumbnail
(photo_previews) land one round-trip later.

Failure scenario: the previews upsert fails (transient network error, or a
degenerate `bytes = 0` derivative tripping the `bytes > 0` check on
rachandzach_photo_previews). `fail()` returns false, the run stops, and
`recordCatalogRow` was never reached, so nothing is checkpointed. But the
photos upsert already committed, so the database now holds a `published`,
preview-less, people-less photo until an operator reruns. Any concurrent reader
in that window (packet 06 gallery / packet 09 downloads) sees a broken tile.
For a pre-launch admin import the blast radius is small, but it is a real
violation of the "media in place before the row is visible" contract.

Minimal fix: insert photos in the batch as a non-visible status (e.g.
`hidden` or `pending`), land previews/joins/keywords, then flip the batch to
`published` as the last write before `recordCatalogRow`. That keeps a photo
invisible until all of its render dependencies exist, and a mid-batch failure
leaves only hidden rows.

### 2. LOW-MEDIUM: denormalized count recompute does not restrict to approved rows, diverging from the packet spec (and answers the double-count question)

scripts/sync-gallery-catalog.mjs:461-483.

Double counting: there is none. The DB trigger
`rachandzach_photo_people_bump_photo_count`
(202607220001_gallery_core.sql:286-305) increments photo_count on every
photo_people INSERT and decrements on DELETE. The catalog sync then
recomputes with an absolute overwrite:
`update rachandzach_people set photo_count = <live count of photo_people>`
(lines 462-470). Because it is an authoritative overwrite, not an increment, it
supersedes whatever the trigger accumulated, so the final value equals the true
join count regardless of trigger firings. On retry the join upsert conflicts and
takes the ON CONFLICT DO UPDATE path (AFTER UPDATE, which the trigger does not
watch), so no extra bump occurs either. The interaction is safe.

The real issue is the spec gap. Packet step: "Recompute people.photo_count and
per-event photo counts from approved rows." The recompute counts ALL
photo_people rows for a person with no status filter (lines 463-466); the event
count filters `source = 'master'` but not `status = 'published'` (lines
477-481). In this packet's master-only import every photo is published, so the
fixture coincidences hold (rachel 2, zach 2; ceremony 2, dancing 1). But once
hidden/rejected master photos or guest-photo joins exist, both denormalized
numbers will include non-approved rows and drift from the "approved" definition
the spec asks for. The recompute is also fully redundant with the DB trigger for
the master path, so the coupling is load-bearing but under-specified.

Minimal fix: count joins through published photos only, e.g. count
photo_people joined to rachandzach_photos where status = 'published' (and
source-scope as intended), and apply the same status filter to the event count
so the two denormalizations agree with each other and with the spec.

### 3. LOW: preview readiness gate checks existence only, originals check sha256

scripts/sync-gallery-catalog.mjs:129-135.

The original is gated with `hasVerifiedObject(..., photo.fileSha256)` (sha
compared), but each preview is gated with a bare presence test
`state?.objects?.[objectKey(PREVIEWS_BUCKET, preview.objectPath)]` and
`if (!record)` (line 133-134), never comparing the recorded sha. Previews are
content-addressed by imageDataHash+width+format and immutable, so in practice
the recorded object is the right one, but the asymmetry means a stale or
tampered checkpoint entry for a preview would pass the gate where the same
tamper on an original would not. Low impact; worth making the two paths
symmetric for defense in depth (the state record already carries fileSha256).

### 4. LOW: CLI imports .ts from .mjs and relies on Node native type-stripping with no version floor

scripts/sync-gallery-storage.mjs:36-56, scripts/sync-gallery-catalog.mjs:29-47;
package.json has no `engines` and no `"type"`, and .nvmrc is empty.

Both `#!/usr/bin/env node` scripts import `../src/lib/import/sync-contracts.ts`
and `sync-state.ts` with explicit `.ts` specifiers, which only works when Node
strips types on import (default on Node >= 23.6 / >= 22.18, otherwise behind a
flag). The current machine is Node 26, so the committed dry-run report proves it
runs here, and vitest handles the test path independently. But the packet's
done-check is `node scripts/sync-gallery-storage.mjs ...` with no flag in the
shebang and no pinned Node version, so on an older Node or a different CI runner
the done-check fails at import with an unknown-extension / unsupported-syntax
error rather than a logic failure. Add an `engines.node` floor (and/or an
`.nvmrc`) documenting the requirement.

### 5. LOW: env-file parser does not handle `export KEY=VALUE` lines

src/lib/import/sync-contracts.ts:329-343.

`readCredentialsFromEnvFile` splits each line on the first `=` and takes the
left side verbatim as the key. A `.env.cloud` that uses `export SUPABASE_URL=...`
(common when a file doubles as a shell source) yields key
`"export SUPABASE_URL"`, so the lookup on line 344 misses and the function
throws the misleading "Env file ... must define SUPABASE_URL". Values are handled
correctly (split on first `=`, so JWT/base64 values with later `=` survive; quote
stripping is fine). Since real execution feeds credentials only through this
path, a stray `export` prefix would block a legitimate run with a confusing
message. Trim a leading `export ` before the key split.

### 6. LOW: duplicate (width, format) in a photo's previewObjects would fail the previews upsert

scripts/sync-gallery-catalog.mjs:388-419; onConflict "photo_id,width,format".

If packet 02 ever emits two preview entries with the same width and format for
one photo, both become previewRows with the same conflict target inside a single
upsert payload, which PostgREST rejects ("ON CONFLICT DO UPDATE command cannot
affect row a second time"), failing the whole batch. The zod schema
(sync-contracts.ts:142-171) validates each preview object but does not dedupe
the array. Importer-controlled, so low, but a cheap guard (reject or dedupe
duplicate width+format per photo during catalog validation) would turn a hard
batch failure into a clear up-front error.

### 7. LOW (cosmetic): report double-counts rerun rows and dry-run resume view can mislead

- Catalog rerun counts the same photos in both `skippedExisting`
  (sync-gallery-catalog.mjs:213-215) and `catalogRowsUpserted` (they are still
  re-upserted in the batch loop, lines 289-307); the retry test asserts
  skippedExisting 3 and catalogRowsUpserted 29 for the same 3 photos. Harmless
  for the DB (idempotent) but the report reads as if 32 photo-operations
  happened.
- Storage dry-run without `--project-ref` discards a prior execute checkpoint
  (sync-gallery-storage.mjs:326-336, because `state.projectRef !== null`), so
  the "resumable / remaining" numbers show everything pending even when uploads
  already succeeded. Pass `--project-ref` to a dry-run to get an accurate resume
  view; a one-line note in `--help` would prevent confusion.

---

## Clean areas (verified, no action)

- Dry-run purity: neither script constructs a client, reads credentials, calls
  `assertExecutionAllowed`, writes checkpoint state, or reaches
  `detectRemoteOrphans` outside the `if (options.execute)` branch
  (storage lines 368-516, catalog lines 223-308). Dry-run touches disk (catalog
  read, sha256 streaming, report/log) only. Confirmed clean.
- Execution gate: assertExecutionAllowed (sync-contracts.ts:377-425) fails
  closed on missing project-ref, empty/missing runtime allowlist, ref not in
  allowlist, missing env-file, env-file SUPABASE_PROJECT_REF mismatch, and
  host != `<ref>.supabase.co` (or non-loopback under --local). Runs before any
  client exists; tests confirm zero storage/db calls on every refusal.
- Upload integrity: sha256 is re-verified from bytes immediately before upload
  (storage lines 428-440); upsert:false everywhere (line 446); the 409 path
  proves remote identity via info() size + fileSha256 metadata with no download
  and never overwrites (lines 460-492), matching the verified spike contract
  (platform-apis.md sections B2/B3, error.status === 409 number).
- Retry keying: photos upsert onConflict image_data_hash against a UNIQUE column
  (migration line 91-92); a retry can never create a second photo. Children use
  their composite PKs. Verified against schema.
- Ordering: storage plan groups per photo so the original precedes its previews
  (storage lines 401-409, buildStoragePlan test); catalog upserts events then
  people then photos then children (catalog lines 243-424); the storage gate
  (partitionByStorageReadiness) blocks any photo whose original or a preview is
  not checkpoint-verified before it can be cataloged.
- Failure and resume: checkpoint written after every 10 storage ops and after
  each catalog batch; recordCatalogRow only after a batch fully verifies; a
  failed batch stops the run and checkpoints nothing (test-confirmed);
  corrupt/foreign state is refused (sync-state.ts loadSyncState throws on bad
  JSON, sanitizeSyncState drops unknown keys); concurrency is clamped to an
  integer 1..8 (storage lines 128-138); no secrets or signed URLs enter state,
  the report, or logs (sync-state allowlist rebuild; committed report scanned
  clean); orphans are reported, never deleted (storage lines 273-308).
- Counts refresh: no double counting. The recompute is an absolute overwrite
  that supersedes the DB trigger, and retry join upserts take the UPDATE path
  the trigger ignores. See finding 2 for the only caveat (approved-row filter).
- Naming: ORIGINALS_BUCKET / PREVIEWS_BUCKET equal STORAGE_BUCKETS.originals /
  .previews with a compile-time `satisfies` check; every table and column the
  catalog writes exists in 202607220001_gallery_core.sql; originalObjectPath
  embeds file_sha256[0:16] satisfying the
  rachandzach_photos_original_object_content_hash constraint.

## Note on the real target

Execution against the shared project rnfvmqflktghriqefatc remains fully gated:
it requires --execute plus a matching --project-ref, a runtime --allowlist
containing that ref, and an --env-file whose host resolves to
`<ref>.supabase.co`. Nothing defaults to a personal or Panini project, and the
committed run is dry-run with projectRef null. Not exercised live in this review.
