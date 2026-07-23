# Task 12: Favorites v2

**Wave:** 2
**Depends on:** 08

## Files
- Modify: `src/components/favorites/FavoritesGallery.tsx`, plus the favorites page shell under `src/app/(guest)/favorites/` if spacing needs it

## Interfaces
- Consumes: card language (08), frame (07).
- Produces: the favorites page in the picked direction.

## Steps
- [ ] Empty state today is a text paragraph in a cream void. Make it an invitation: design-system treatment, the pinned copy stays ("You have not favorited any photos yet." is verbatim-pinned by three test files; the second sentence points to My Weekend slideshows and is also pinned).
- [ ] Populated state: the collection presented as a keepsake (this is the album-planning surface per the page copy), ZIP/slideshow/shortlist actions styled as first-class.
- [ ] Contrast rule: `text-muted` (>= 4.5:1) or stronger for all secondary text; never reintroduce `text-ink/60` on cream (the exact bug fixed 2026-07-22).
- [ ] Keep the `useFavoriteIds` stable-reference regression test green (a real crash fix landed there; do not restructure the hook).

## Done-check
Run: `npx vitest run tests/favorites && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS.
