# Task 09: Originals, favorites, ZIP, and slideshow

**Wave:** 4
**Depends on:** 02, 03, 04, 06

## Objective

Make full-resolution ownership real. Guests can download one byte-identical original, collect favorites, stream a multi-photo ZIP on their device, run a slideshow, and export a shortlist for a future printed album.

## Files

- Create: src/app/api/downloads/photo/[photoId]/route.ts
- Create: src/app/api/downloads/selection/route.ts
- Create: src/app/(guest)/favorites/page.tsx
- Create: src/components/favorites/FavoriteButton.tsx
- Create: src/components/favorites/FavoritesGallery.tsx
- Create: src/components/slideshow/Slideshow.tsx
- Create: src/components/slideshow/SlideshowControls.tsx
- Create: src/components/downloads/DownloadOriginalButton.tsx
- Create: src/components/downloads/DownloadSelectionButton.tsx
- Create: src/components/downloads/AlbumShortlistExport.tsx
- Create: src/lib/favorites/store.ts
- Create: src/lib/downloads/contracts.ts
- Create: src/lib/downloads/sign-originals.ts
- Create: src/lib/downloads/stream-zip.ts
- Test: tests/downloads/original-integrity.test.ts
- Test: tests/downloads/selection.test.ts
- Test: tests/favorites/store.test.ts

## Interfaces

- Consumes: GalleryPhotoRecord.imageDataHash, fileSha256, originalBytes, and originalFilename from task 02.
- Consumes: photos and storage clients from task 03.
- Consumes: requireGalleryAccess() from task 04.
- Consumes: getPhotoDetail(photoId) from task 06.
- Consumes: GalleryQueryInput.ids batch lookup from task 06 to render the favorites gallery from locally stored IDs.
- Produces: OriginalDownload
  - photoId: string
  - filename: string
  - bytes: number
  - sha256: string
  - signedUrl: string
  - expiresAt: string
- Produces: SelectionDownload
  - items: OriginalDownload[]
  - maximumItems: 50
  - estimatedBytes: number
- Produces: getOriginalDownload(photoId: string) -> Promise<OriginalDownload>.
- Produces: getSelectionDownloads(photoIds: string[]) -> Promise<SelectionDownload>.
- Produces: SlideshowProps { photos: GalleryPhotoView[]; modeLabel: string; startIndex?: number; intervalMs?: number; onClose?: () => void }. This exact shape is the contract task 07 consumes; do not rename or restructure it.
- Produces: FavoriteStore
  - list() -> string[]
  - has(photoId: string) -> boolean
  - toggle(photoId: string) -> string[]
  - clear() -> void
  - subscribe(listener) -> () => void

## Download decisions

- One-photo download redirects to a 10-minute signed original URL.
- The original object comes from wedding-originals or guest-approved. It is never a preview.
- Multi-select ZIP uses @zip.js/zip.js in the browser and streams signed originals directly from Supabase.
- Use the File System Access API where available. Use a bounded Blob fallback and show a size warning before allocating memory.
- Maximum 50 originals per selection. If estimated bytes exceed 1 GB on a fallback browser, split into smaller batches.
- ZIP filenames preserve approved original filenames and resolve collisions deterministically.
- Do not proxy original bytes or ZIP output through Vercel.

## Steps

- [ ] Write an integrity test that compares a downloaded fixture SHA-256 with GalleryPhotoRecord.fileSha256.
- [ ] Write selection tests for duplicates, missing IDs, unapproved uploads, more than 50 IDs, filename collisions, expiry, and fallback-size limits.
- [ ] Write FavoriteStore tests for persistence, schema version, bad local data, and storage-disabled browsers.
- [ ] Implement batch signed URLs with a single authorization check and strict approved-status filter.
- [ ] Build streaming ZIP progress, cancel, retry, and partial-failure UI.
- [ ] Add favorite controls to cards and lightbox without shifting image layout.
- [ ] Build Slideshow as a generic component that accepts any ordered photo list and a mode label. Wire current filters and favorites here. Task 07 passes the My Weekend list into the same component; do not import task 07 code in this packet. Include play, pause, next, previous, caption toggle, full screen, and interval control.
- [ ] Respect prefers-reduced-motion by defaulting to manual advance.
- [ ] Add Album Shortlist export as CSV and JSON containing photo IDs, filenames, event, people, and favorite order. Do not include private signed URLs.
- [ ] Record only anonymous aggregate download counts if analytics is enabled.
- [ ] Report status. Do not download or upload the full real archive during unit tests.

## Done-check

Run: npm run test -- tests/downloads/original-integrity.test.ts tests/downloads/selection.test.ts tests/favorites/store.test.ts && npm run build

Expected: tests and build pass. The fixture original download hash matches the source. A selection of 50 streams without a Vercel media response. Pending and rejected items return not found.

## Report

Report DONE_WITH_CONCERNS if a browser lacks safe large-ZIP support. Include the exact fallback and tested size limit.
