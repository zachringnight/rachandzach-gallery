# Task 06: Gallery discovery and lightbox

**Wave:** 3
**Depends on:** 02, 03, 04, 13

## Objective

Build a fast protected gallery for the full catalog. Make event and person discovery obvious, preserve shareable filter URLs, and keep the photograph primary.

## Files

- Create: src/app/(guest)/photos/page.tsx
- Create: src/app/(guest)/photos/loading.tsx
- Create: src/app/(guest)/photos/[photoId]/page.tsx
- Create: src/app/api/gallery/route.ts
- Create: src/app/api/gallery/photo/[photoId]/route.ts
- Create: src/components/gallery/GalleryShell.tsx
- Create: src/components/gallery/FilterBar.tsx
- Create: src/components/gallery/PersonPicker.tsx
- Create: src/components/gallery/EventPicker.tsx
- Create: src/components/gallery/VirtualPhotoGrid.tsx
- Create: src/components/gallery/PhotoCard.tsx
- Create: src/components/gallery/Lightbox.tsx
- Create: src/components/gallery/RelatedPhotos.tsx
- Create: src/lib/gallery/query.ts
- Create: src/lib/gallery/layout.ts
- Create: src/lib/gallery/signed-previews.ts
- Test: tests/gallery/query.test.ts
- Test: tests/gallery/layout.test.ts
- Replace after parity: src/components/GalleryApp.tsx

## Interfaces

- Consumes: GalleryCatalog and GalleryPhotoRecord from task 02.
- Consumes: Database types and createServerClient() from task 03.
- Consumes: requireGalleryAccess() from task 04.
- Consumes: synced approved catalog rows and private preview objects from task 13.
- Produces: GalleryQueryInput
  - cursor: string | null
  - limit: number, default 60, maximum 100
  - ids: string[] | null, maximum 100. When set, return exactly these approved photos in the given order and ignore other filters. Status isolation still applies.
  - person: string | null
  - event: string | null
  - orientation: "portrait" | "landscape" | "square" | null
  - source: "photographer" | "guest" | null
  - sort: "weekend" | "newest"
- Produces: GalleryPage
  - photos: GalleryPhotoView[]
  - nextCursor: string | null
  - total: number
  - signedUrlExpiresAt: string
- Produces: getGalleryPage(input: GalleryQueryInput) -> Promise<GalleryPage>.
- Produces: getPhotoDetail(photoId: string) -> Promise<GalleryPhotoDetail | null>.
- Produces: getGalleryFacets() -> Promise<GalleryFacets> where GalleryFacets = { events: { slug: string; name: string; count: number }[]; people: { slug: string; displayName: string; count: number }[] }, computed by indexed group-by over approved photos only.
- Produces URL query contract: person, event, orientation, source, sort, and photo.

## Behavior

- Default order follows event sort order, then captured_at, then original filename.
- Filters are conjunctive and reflect in the URL.
- Search and filter results never include pending or rejected uploads.
- Preview URLs expire after 60 minutes by default, tunable through one constant so task 12's egress measurement can lengthen preview TTL without code changes. Renew expired URLs without losing scroll position.
- Use batch signed URLs for the visible page. Never proxy image bytes through Vercel.
- Related photos prioritize same people, then same event and adjacent time.
- Lightbox supports arrow keys, Escape, swipe, previous, next, focus trapping, and browser history.
- A person chip shows confirmed metadata only. No inferred tags.

## Steps

- [ ] Write query tests for cursor stability, all filter combinations, status isolation, invalid values, and ids lookups including unknown, duplicate, and pending IDs.
- [ ] Write deterministic layout tests for mixed portrait and landscape dimensions.
- [ ] Build the database query with indexed joins and opaque cursors.
- [ ] Build getGalleryFacets with grouped counts over approved photos. Do not read people.photo_count for guest-facing counts; task 13 maintains that denormalized column for admin reporting.
- [ ] Batch-sign only preview object paths returned in the page.
- [ ] Implement a virtualized justified-row grid. Preserve aspect ratio and avoid cumulative layout shift.
- [ ] Keep filters sticky on desktop and compact on mobile.
- [ ] Implement modal and deep-linked photo routes with accessible dialog semantics.
- [ ] Add empty states that distinguish no matches from a session or network failure.
- [ ] Add retry and signed-URL refresh handling.
- [ ] Make person and event filters usable at 390 px without horizontal page overflow.
- [ ] Report status. Do not expose original object paths to the client.

## Done-check

Run: npm run test -- tests/gallery/query.test.ts tests/gallery/layout.test.ts && npm run build

Expected: tests and build pass. A 1,721-photo fixture pages without duplicates or gaps. Pending upload fixtures never appear. No route returns a service-role key or raw private object path.

## Report

Report DONE, DONE_WITH_CONCERNS, BLOCKED, or NEEDS_CONTEXT. Performance below target belongs in DONE_WITH_CONCERNS with measured numbers.
