# Task 02: Read-only media import pipeline

**Wave:** 1
**Depends on:** none

## Objective

Replace the stale static gallery build with a deterministic, read-only importer for the clean master. Preserve originals byte for byte, generate immutable display derivatives, and emit a catalog other packets can consume.

## Files

- Create: scripts/build-gallery-v2.mjs
- Create: scripts/lib/clean-master-manifest.mjs
- Create: scripts/lib/image-derivatives.mjs
- Modify: src/types/gallery.ts
- Create: src/generated/gallery-v2.json
- Create: metadata/import/gallery-import-report.json
- Create: tests/import/clean-master-manifest.test.mjs
- Create: tests/import/derivative-policy.test.mjs
- Deprecate after parity: scripts/build-gallery.mjs

## Inputs

- Root: /Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean
- Manifest: /Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean/_Metadata/photo-manifest.csv
- Stable identity: image_data_hash
- Event order: Day 1, Getting Ready, First Look, Ceremony Details, Ceremony, Friends & Family, Cocktail Hour, Reception Details, Reception, Dancing, Sunset, After Party, Sneak Peek, Film
- capturedAt and keywords are not CSV columns. Read them from each source JPEG's embedded EXIF/XMP with exifr, read-only. Missing values stay null or empty. Never infer or fabricate.

## Interfaces

- Produces: GalleryPhotoRecord
  - id: string
  - imageDataHash: string
  - fileSha256: string
  - originalRelativePath: string
  - originalFilename: string
  - originalBytes: number
  - width: number
  - height: number
  - orientation: "portrait" | "landscape" | "square"
  - eventSlug: string
  - capturedAt: string | null
  - peopleSlugs: string[]
  - keywords: string[]
  - previewObjects: PreviewObject[]
  - source: "photographer" | "guest"
  - status: "approved"
- Produces: GalleryCatalog
  - generatedAt: string
  - sourceRoot: string
  - photos: GalleryPhotoRecord[]
  - people: GalleryPersonRecord[]
  - events: GalleryEventRecord[]
  - stats: ImportStats
- Produces: loadCleanMasterManifest(path: string) -> Promise<GalleryCatalog>
- Produces: buildDerivativePlan(photo: GalleryPhotoRecord) -> DerivativePlan[]
- Consumes: only filesystem input. It must not modify source files.

## Derivative policy

- Generate widths 480, 960, 1600, and 2400 only when smaller than the source width.
- Emit AVIF and WebP for 480, 960, and 1600. Emit high-quality JPEG at 2400 for broad compatibility.
- Preserve orientation and embedded ICC intent in derivatives.
- Object path: previews/{imageDataHash}/{width}.{format}
- Cache-Control: public,max-age=31536000,immutable
- The word "original" means the source JPEG, never a 2200 px derivative.

## Steps

- [ ] Write a fixture test that includes valid photos, _Review, _Metadata, By Person symlinks, a duplicate hash, a missing path, and a malformed people list.
- [ ] Confirm the fixture test fails because loadCleanMasterManifest does not exist.
- [ ] Parse the canonical CSV with an explicit schema. Never crawl By Person.
- [ ] Determine how image_data_hash was originally computed by reading the existing scripts in scripts/. If the algorithm is reproducible, verify it. If not, treat the CSV value as an opaque stable identity and verify source integrity through fileSha256 only. Record the decision in the import report.
- [ ] Extract capturedAt (EXIF DateTimeOriginal plus offset when present) and keywords (XMP/IPTC keyword lists) from each source JPEG via exifr without opening the file for writing.
- [ ] Reject duplicate imageDataHash rows. Report missing files, bad dimensions, and bad hashes without mutating anything.
- [ ] Normalize person display names and slugs without changing authoritative labels.
- [ ] Plan derivatives from source dimensions. Do not upscale.
- [ ] Generate derivatives into a task-specific temporary directory first. Atomic rename only after each output decodes and matches its planned dimensions.
- [ ] Compute fileSha256 from the complete current JPEG bytes. Verify both fileSha256 and imageDataHash before and after derivative generation. Any change aborts the run.
- [ ] Emit gallery-v2.json and a report with counts, bytes, exclusions, errors, and source-hash verification.
- [ ] Keep current public/gallery-assets untouched until packet 12 approves cutover.
- [ ] Report status. Do not commit.

## Done-check

Run: npm run test -- tests/import/clean-master-manifest.test.mjs tests/import/derivative-policy.test.mjs && npm run gallery:import -- --verify-only

Expected: tests pass. Verify-only reports 1,721 unique primary photos for the current snapshot, zero source writes, zero duplicate IDs, and zero source hash changes. If the live count differs, stop with DONE_WITH_CONCERNS and include the explained delta.

## Report

Report DONE only when the importer is deterministic and source integrity is proven. Report BLOCKED if the canonical manifest is missing or internally inconsistent.
