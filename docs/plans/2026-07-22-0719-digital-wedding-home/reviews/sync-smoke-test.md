# Packet 13 live smoke test: sync-gallery-storage.mjs + sync-gallery-catalog.mjs

## Verdict: SYNC_TOOL_WORKS

No functional bug found in the sync tool. All 7 checks (dry-run plan, real upload,
real catalog upsert, database verification, storage verification, idempotent
retry, cleanup with zero residue) passed cleanly against the real, shared
Supabase project PrizmLounge (`rnfvmqflktghriqefatc`), using only synthetic
fixture data. One non-bug observation is documented below (content-type on
non-JPEG originals) because it is worth knowing before the real archive sync,
even though it does not apply to the real 1,721-photo archive.

Cleanup was executed and independently re-verified: zero synthetic residue
remains in any table or bucket (final query at the bottom of this report).

## Scope and isolation

- Target: real Supabase project PrizmLounge, `rnfvmqflktghriqefatc`, using
  `.env.cloud` for credentials (file used as a path only; its contents were
  never read into this report).
- Data: 3 synthetic photo rows built from real files already in
  `tests/fixtures/shared/` (`synthetic-1-tiny.jpg`, `synthetic-2-tiny.png`,
  `synthetic-3-tiny.webp`), 707 / 640 / 206 bytes. `imageDataHash` values used
  the requested obviously-synthetic, greppable pattern:
  `00000000000000000000000000000e01/e02/e03` (32 hex chars, matches the
  `^[0-9a-f]{32,64}$` column regex).
  `fileSha256` values are the real, computed sha256 of those three files
  (verified independently with `shasum -a 256` against
  `tests/fixtures/shared/manifest.json` before use).
- A full 1,721-photo archive import was running concurrently on this machine
  (pid 15527, writing into `metadata/import/derivatives/`) for the entire
  duration of this test. It was left untouched: `SYNC_DEFAULTS.resumeStatePath`,
  `.reportPath`, and `.derivativeRoot` (all default under `metadata/import/`)
  were never used. Every run passed explicit `--resume-state`, `--report`, and
  `--derivatives` pointing at an isolated scratch tree,
  `tests/fixtures/sync-smoke/{state,report,scratch}/`, which has since been
  deleted (see Cleanup). `metadata/import/full-import-run.log` and
  `metadata/import/gallery-sync-report.json` mtimes were checked before and
  after this test and were never touched by any command in this report.
- `sync-contracts.ts`, `sync-state.ts`, and the two CLI scripts were read in
  full but never modified.

## Synthetic catalog

Built at `tests/fixtures/sync-smoke/synthetic-catalog.json` (deleted after the
test, see Cleanup), following `tests/fixtures/catalog.json`'s shape. 3 photos,
1 synthetic event (`sync-smoke-test`), 0 people, empty `previewObjects` on
every photo (originals-only run: generating matching local derivative files
for a 3-photo smoke test was judged disproportionate per the task's own
allowance to trim previews when that's the case). Validated directly against
the real `parseSyncCatalog()` before any network call:

```
$ node -e '... m.parseSyncCatalog(raw) ...'
VALID. photos: 3 events: 1 people: 0
 - 00000000000000000000000000000e01 originals/00000000000000000000000000000e01/a616153f41ae6e17-sync-smoke-1-tiny.jpg
 - 00000000000000000000000000000e02 originals/00000000000000000000000000000e02/5641687a5beb6779-sync-smoke-2-tiny.png
 - 00000000000000000000000000000e03 originals/00000000000000000000000000000e03/ab8f0f4bef06fd87-sync-smoke-3-tiny.webp
```

Baseline check before touching anything: `rachandzach_photos`,
`rachandzach_events`, `rachandzach_people`, `rachandzach_photo_previews`,
`rachandzach_photo_people`, `rachandzach_photo_keywords` were all empty (0
rows) on PrizmLounge before this test started.

## Step 1: storage dry-run (zero network)

First attempt omitted `--derivatives`, and the normalized options silently
fell back to `SYNC_DEFAULTS.derivativeRoot` (`metadata/import/derivatives`,
the live directory). Because `previewObjects` was empty this never actually
touched a file there (the derivative loop only runs per preview object), but
it was still the wrong path to have resolved, given the packet's own
isolation rule. Corrected by passing `--derivatives
tests/fixtures/sync-smoke/scratch` explicitly and rerunning before any real
write. Command actually used for every subsequent step:

```
$ node scripts/sync-gallery-storage.mjs \
    --catalog tests/fixtures/sync-smoke/synthetic-catalog.json \
    --source tests/fixtures/shared \
    --derivatives tests/fixtures/sync-smoke/scratch \
    --resume-state tests/fixtures/sync-smoke/state/gallery-sync-state.json \
    --report tests/fixtures/sync-smoke/report/gallery-sync-report.json \
    --dry-run

[dry-run] PUT  rachandzach-originals/originals/00000000000000000000000000000e01/a616153f41ae6e17-sync-smoke-1-tiny.jpg (707 bytes)
[dry-run] PUT  rachandzach-originals/originals/00000000000000000000000000000e02/5641687a5beb6779-sync-smoke-2-tiny.png (640 bytes)
[dry-run] PUT  rachandzach-originals/originals/00000000000000000000000000000e03/ab8f0f4bef06fd87-sync-smoke-3-tiny.webp (206 bytes)
dry-run: 3 planned operations, 0 network writes, 0 skipped, 0 source hash mismatches, 0 failures. Resumable: 0 verified, 3 remaining.
Exit code: 0
```

Report's `derivativeRoot` field confirmed isolated after the fix:
`/Users/zsoskin/Downloads/rachandzach-gallery/tests/fixtures/sync-smoke/scratch`.

Also ran `sync-gallery-catalog.mjs --dry-run` at this point (no state file
existed yet): it correctly reported all 3 photos gated by the storage gate
("run sync-gallery-storage first") and 0 database writes, exit code 1 (gated
photos count as failures in a dry run with no prior checkpoint): this is the
expected gating behavior, not a bug.

## Step 2: real storage execute

```
$ node scripts/sync-gallery-storage.mjs \
    --catalog tests/fixtures/sync-smoke/synthetic-catalog.json \
    --source tests/fixtures/shared \
    --derivatives tests/fixtures/sync-smoke/scratch \
    --resume-state tests/fixtures/sync-smoke/state/gallery-sync-state.json \
    --report tests/fixtures/sync-smoke/report/gallery-sync-report.json \
    --execute --project-ref rnfvmqflktghriqefatc --allowlist rnfvmqflktghriqefatc \
    --env-file /Users/zsoskin/Downloads/rachandzach-gallery/.env.cloud

execute: 3 planned operations, 3 network writes, 0 skipped, 0 source hash mismatches, 0 failures. Resumable: 0 verified, 3 remaining.
Exit code: 0
```

## Step 3: real catalog execute

```
$ node scripts/sync-gallery-catalog.mjs \
    --catalog tests/fixtures/sync-smoke/synthetic-catalog.json \
    --resume-state tests/fixtures/sync-smoke/state/gallery-sync-state.json \
    --report tests/fixtures/sync-smoke/report/gallery-sync-report.json \
    --execute --project-ref rnfvmqflktghriqefatc --allowlist rnfvmqflktghriqefatc \
    --env-file /Users/zsoskin/Downloads/rachandzach-gallery/.env.cloud

execute: 7 planned rows, 7 upserted, 0 gated photos, 0 failures.
Exit code: 0
```

Report's `verification` block (batch requery + sampled joins + recomputed
counts, all from the tool's own report, not just my SQL):

```json
"verification": {
  "batches": [{ "batch": 0, "photos": 3, "verified": true }],
  "peopleCounts": {},
  "eventCounts": { "sync-smoke-test": 3 }
}
```

`eventCounts.sync-smoke-test` (3) matched the catalog's declared
`events[0].photoCount` (3), so the verify-counts stage passed with 0
failures.

## Step 4: verification via Supabase MCP (execute_sql)

Photo rows exactly match the synthetic catalog:

```sql
select image_data_hash, file_sha256, original_bucket, original_object,
       original_filename, original_bytes, width, height, source, status
from rachandzach_photos
where image_data_hash like '00000000000000000000000000000e%'
order by image_data_hash;
```
```
00000000000000000000000000000e01 | a616153f...470283 | rachandzach-originals | originals/00000000000000000000000000000e01/a616153f41ae6e17-sync-smoke-1-tiny.jpg | sync-smoke-1-tiny.jpg | 707 | 64 | 64 | master | published
00000000000000000000000000000e02 | 5641687a...df7f    | rachandzach-originals | originals/00000000000000000000000000000e02/5641687a5beb6779-sync-smoke-2-tiny.png | sync-smoke-2-tiny.png | 640 | 64 | 64 | master | published
00000000000000000000000000000e03 | ab8f0f4b...bcdcb4  | rachandzach-originals | originals/00000000000000000000000000000e03/ab8f0f4bef06fd87-sync-smoke-3-tiny.webp | sync-smoke-3-tiny.webp | 206 | 64 | 64 | master | published
```

Event row: `sync-smoke-test / Sync Smoke Test / sort_order 0`, present, 1 row.

`storage.objects` matches (size + 200 status for all 3):

```sql
select bucket_id, name, metadata->>'size', metadata->'httpStatusCode'
from storage.objects
where name like 'originals/00000000000000000000000000000e%'
order by name;
```
All 3 rows present in `rachandzach-originals`, sizes 707/640/206, httpStatusCode 200 each.

Trigger / count sanity: `rachandzach_photo_previews` 0, `rachandzach_photo_people`
0, `rachandzach_people` 0 (all correct given the catalog used empty
`previewObjects`/`peopleSlugs`); `rachandzach_photo_keywords` = 3, one
`"sync-smoke-test"` keyword per photo, as planned.

### Observation (not a bug): original content-type is hardcoded to image/jpeg

`ORIGINAL_CONTENT_TYPE = "image/jpeg"` in `sync-contracts.ts` is applied to
every original regardless of the source file's actual format. My synthetic
catalog intentionally mixed real formats from `tests/fixtures/shared/`
(jpg/png/webp) to exercise different files, so `storage.objects.metadata.mimetype`
came back `"image/jpeg"` for the PNG and WebP entries too. I checked whether
this is a real defect: `GalleryPhotoRecord.fileSha256` in
`src/types/gallery.ts` is explicitly documented as "SHA-256 of the complete
current source **JPEG** bytes". That is, the packet 02 clean-master importer's
contract guarantees every real original is an actual JPEG, so the hardcoded
content type is correct for the real 1,721-photo archive. This is a fixture
artifact from my synthetic catalog choosing non-JPEG files, not a defect in
the sync tool. Flagging only because if a future catalog ever legitimately
carries a non-JPEG original, the stored mimetype would silently be wrong.

## Step 5: idempotency (rerun both scripts, identical args)

```
$ node scripts/sync-gallery-storage.mjs ...(same args, --execute)...
execute: 3 planned operations, 0 network writes, 3 skipped, 0 source hash mismatches, 0 failures. Resumable: 3 verified, 0 remaining.
Exit code: 0

$ node scripts/sync-gallery-catalog.mjs ...(same args, --execute)...
execute: 7 planned rows, 7 upserted, 0 gated photos, 0 failures.
Exit code: 0
```

Storage retry: 0 network writes (all 3 served from checkpoint, never even
hit the remote 409-collision path). Catalog retry: upserts on stable keys
(image_data_hash / slug), so counts stayed identical.

Requeried row/object counts after the retry, no duplication:

```sql
select
  (select count(*) from rachandzach_photos where image_data_hash like '00000000000000000000000000000e%') as photo_rows,
  (select count(*) from rachandzach_events where slug = 'sync-smoke-test') as event_rows,
  (select count(*) from rachandzach_photo_keywords where keyword = 'sync-smoke-test') as keyword_rows,
  (select count(*) from storage.objects where name like 'originals/00000000000000000000000000000e%') as storage_object_rows;
```
Result: `photo_rows: 3, event_rows: 1, keyword_rows: 3, storage_object_rows: 3`, identical to after the first run. Retry safety confirmed.

## Step 6: cleanup (verified, not assumed)

1. Database rows deleted via SQL (cascade covers previews/people/keywords):
   ```sql
   delete from rachandzach_photos where image_data_hash like '00000000000000000000000000000e%';
   delete from rachandzach_events where slug = 'sync-smoke-test'
     and not exists (select 1 from rachandzach_photos p where p.event_id = rachandzach_events.id);
   ```
   Requeried immediately after: `photo_rows: 0, event_rows: 0, keyword_rows: 0, preview_rows: 0, photo_people_rows: 0`.

2. Storage objects deleted via the storage API's `remove()` method (a
   legitimate deletion operation, distinct from the blocked UPDATE-based
   overwrite/rename path), using a small standalone cleanup script written to
   the (now-deleted) scratch directory. It only imported the existing,
   unmodified `readCredentialsFromEnvFile` / `assertExecutionAllowed` /
   `ORIGINALS_BUCKET` from `sync-contracts.ts` and called
   `client.storage.from(ORIGINALS_BUCKET).remove([...3 object paths...])`.
   All 3 objects confirmed removed (API returned the 3 deleted object
   records with matching sizes/hashes in `user_metadata`).

3. No synthetic person or event row was left with dangling references (the
   event delete used a `not exists` guard against `rachandzach_photos`, and
   by the time it ran all 3 photo rows referencing it were already gone; 0
   people rows existed at any point in this test).

4. Local scratch directory `tests/fixtures/sync-smoke/` was deleted entirely
   (state file, report file, cleanup script, and the synthetic catalog). I
   chose to delete rather than keep it: the checkpoint state file's whole
   purpose is to record verified-remote-object claims, and after cleanup it
   would describe objects that no longer exist, which is a worse trap to
   leave lying around than the cost of regenerating a 3-line catalog next
   time. If a reusable smoke fixture is wanted going forward, it's cheap to
   recreate from this report's catalog JSON.

### Final zero-residue query (after cleanup, independently re-run)

```sql
select
  (select count(*) from rachandzach_photos where image_data_hash like '00000000000000000000000000000e%') as photo_rows,
  (select count(*) from rachandzach_events where slug = 'sync-smoke-test') as event_rows,
  (select count(*) from rachandzach_people) as people_rows,
  (select count(*) from rachandzach_photo_keywords where keyword = 'sync-smoke-test') as keyword_rows,
  (select count(*) from rachandzach_photo_previews) as preview_rows,
  (select count(*) from rachandzach_photo_people) as photo_people_rows,
  (select count(*) from storage.objects where bucket_id = 'rachandzach-originals' and name like '%00000000000000000000000000000e%') as originals_objects,
  (select count(*) from storage.objects where bucket_id = 'rachandzach-previews' and name like '%00000000000000000000000000000e%') as previews_objects,
  (select count(*) from rachandzach_photos) as total_photo_rows_in_table,
  (select count(*) from rachandzach_events) as total_event_rows_in_table;
```

```
photo_rows: 0
event_rows: 0
people_rows: 0
keyword_rows: 0
preview_rows: 0
photo_people_rows: 0
originals_objects: 0
previews_objects: 0
total_photo_rows_in_table: 0
total_event_rows_in_table: 0
```

Zero synthetic residue confirmed. Every `rachandzach_*` table is back to the
same empty baseline it was in before this test started.

## Step 7: nothing outside rachandzach objects touched

Only `rachandzach_*` tables and the `rachandzach-originals` /
`rachandzach-previews` buckets were queried or written. `metadata/import/`
(the live concurrent import's working directory) was never written to by any
command in this test; its files' mtimes moved forward during this session
only because the separate, still-running import process (pid 15527) kept
writing them, not because of anything run here. `.env.cloud` was used only as
a `--env-file` path argument and was never `cat`'d, read, or echoed into any
command output captured in this report.

## Summary for Zach

The packet 13 sync tool works correctly end-to-end against the real
PrizmLounge project: dry-run planning, real upload, real catalog upsert,
checkpoint-based idempotent retry (zero duplicate rows/objects on rerun), and
the storage-gate/verify-batch/recount logic in the catalog script all behaved
as designed. No bug like the earlier ambiguous-column issue turned up. The
one thing worth knowing before the real run: original content type is always
written as `image/jpeg`, which is correct because the real archive's
originals are guaranteed genuine JPEG bytes by the packet 02 import contract,
but would be wrong if a future catalog ever legitimately included a
non-JPEG original.
