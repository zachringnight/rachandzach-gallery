# Task 13: Catalog and private-media sync

**Wave:** 2
**Depends on:** 02, 03

## Objective

Bridge the read-only clean-master importer and Supabase. Build a resumable, idempotent sync that uploads byte-identical originals and immutable derivatives to private buckets, then upserts the catalog. Default mode is dry-run.

## Files

- Create: scripts/sync-gallery-storage.mjs
- Create: scripts/sync-gallery-catalog.mjs
- Create: src/lib/import/sync-contracts.ts
- Create: src/lib/import/sync-state.ts
- Create: metadata/import/gallery-sync-report.json
- Test: tests/import/storage-sync.test.mjs
- Test: tests/import/catalog-sync.test.mjs

## Interfaces

- Consumes: GalleryCatalog, GalleryPhotoRecord, and DerivativePlan from task 02.
- Consumes: Database, createAdminClient(), table constraints, and bucket names from task 03.
- Produces: SyncOptions
  - execute: boolean, default false
  - catalogPath: string
  - sourceRoot: string
  - derivativeRoot: string
  - concurrency: number, default 3, maximum 8
  - resumeStatePath: string
  - projectRef: string | null
- Produces: SyncResult
  - planned: number
  - uploadedOriginals: number
  - uploadedPreviews: number
  - skippedExisting: number
  - catalogRowsUpserted: number
  - failed: SyncFailure[]
  - sourceHashMismatches: number
- Produces: syncGalleryStorage(options: SyncOptions) -> Promise<SyncResult>.
- Produces: syncGalleryCatalog(options: SyncOptions) -> Promise<SyncResult>.

## Object and ordering rules

- Original object: originals/{imageDataHash}/{sanitizedOriginalFilename}
- Preview object: previews/{imageDataHash}/{width}.{format}
- Check fileSha256 and imageDataHash immediately before upload.
- Upload with upsert false.
- When an object already exists, verify remote size and the fileSha256 metadata written by the sync before skipping.
- Upload original and required previews before inserting or updating the photo row.
- Catalog upserts use image_data_hash and stable slugs. Never create a second photo for a retry.
- Do not delete remote objects during sync. Orphans are reported only.

## Steps

- [ ] Write fixture tests for first sync, retry, partial prior upload, checksum mismatch, duplicate ID, remote collision, and catalog transaction failure.
- [ ] Build a dry-run planner that lists exact object and row operations without network writes.
- [ ] Add a local Supabase execution mode using synthetic images.
- [ ] Stream source files from disk. Do not load a full original into memory when the SDK supports streams.
- [ ] Set original content type and private cache metadata. Set immutable cache control on content-hashed previews.
- [ ] Persist checkpoint state after every successful object or row batch. The state contains hashes and object paths, not secrets.
- [ ] Upsert events and people first, then photos, previews, people joins, and keywords in bounded transactions.
- [ ] Requery counts and sampled joins after each catalog batch.
- [ ] Recompute people.photo_count and per-event photo counts from approved rows after each catalog batch, so denormalized admin-facing counts always match the catalog. Guest-facing facets come from task 06's live group-by.
- [ ] Emit a report with planned bytes, uploaded bytes, skips, failures, remote orphans, and source hash verification.
- [ ] Require both --execute and an explicit --project-ref for any cloud write.
- [ ] Refuse an unknown project ref. The allowlist is supplied at execution time and must not default to an existing personal or Panini project.
- [ ] Do not run against real media or cloud storage in this packet without Zach's explicit approval.
- [ ] Report status. Do not delete, overwrite, publish, or change bucket privacy.

## Done-check

Run: npm run test -- tests/import/storage-sync.test.mjs tests/import/catalog-sync.test.mjs && node scripts/sync-gallery-storage.mjs --catalog tests/fixtures/catalog.json --source tests/fixtures/photos --dry-run

Expected: tests pass. Dry-run lists deterministic private object paths, zero writes, zero source hash changes, and a resumable operation count.

## Report

Report DONE when the local synthetic sync is idempotent and real execution remains gated. Report BLOCKED if the storage SDK cannot prove remote object identity without downloading it.
