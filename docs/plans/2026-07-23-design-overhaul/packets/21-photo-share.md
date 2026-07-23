# Task 21: Per-photo share + copy link

**Wave:** 2
**Depends on:** 10

## Files
- Create: `src/components/gallery/SharePhotoButton.tsx`
- Modify: `src/components/gallery/Lightbox.tsx`, `src/components/gallery/PhotoDetailView.tsx` (mount in the share slot 10 produced), `src/components/gallery/PhotoCard.tsx` only if it fits the card design without clutter
- Test: `tests/gallery/share-photo.test.tsx`

## Interfaces
- Consumes: the photo permalink route `/photos/[photoId]` (exists).
- Produces: `SharePhotoButton({ photoId, label? })`: `navigator.share({ url })` where supported, clipboard-copy fallback with a "Link copied" confirmation (aria-live).

## Steps
- [ ] The shared URL is the permalink, which sits behind the guest gate; recipients hit /enter first. That is correct behavior (privacy model), and the confirmation copy must not promise public access. Keep the string plain: "Link copied".
- [ ] No signed URLs, no storage paths, ever, in a shared link.
- [ ] Tests: share called with the permalink URL; fallback writes to clipboard mock; confirmation announces.

## Done-check
Run: `npx vitest run tests/gallery && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS.
