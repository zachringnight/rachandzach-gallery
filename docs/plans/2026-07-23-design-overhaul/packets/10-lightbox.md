# Task 10: Lightbox + photo detail v2

**Wave:** 2
**Depends on:** 08

## Files
- Modify: `src/components/gallery/Lightbox.tsx`, `src/components/gallery/PhotoDetailView.tsx`, `src/components/gallery/RelatedPhotos.tsx`

## Interfaces
- Consumes: tokens (00), card language (08), per-photo download endpoint (same one 08 wires).
- Produces: the immersive photo view used by gallery, My Weekend, Moment Search, permalink.

## Steps
- [ ] Current failure modes from the end review: the scrim lets the page and site nav bleed through muddily; the photo sits small in dead space; chrome is generic gray; the memories section is an afterthought.
- [ ] Redesign: near-opaque ink scrim (the photo is the only light source), photo sized to breathe (contain within safe insets, larger than today), chrome quiet and consistent (close, prev/next, favorite, download, share slot for task 21), people/event caption typography per direction, memories ("Leave a memory") styled as a warm margin note, not a form dump.
- [ ] Keyboard: arrows navigate, Esc closes, f favorites, d downloads. Focus trapped and restored on close.
- [ ] Preserve every existing behavior contract (deep-link permalink, favorites sync, memories submission flow); pinned aria-labels stay.

## Done-check
Run: `npx vitest run tests/gallery tests/favorites && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS.
