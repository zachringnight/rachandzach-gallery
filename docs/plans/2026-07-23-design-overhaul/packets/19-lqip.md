# Task 19: Blur-up loading (LQIP)

**Wave:** 2
**Depends on:** 08

## Files
- Create: `src/components/gallery/PhotoImage.tsx` (blur-up wrapper)
- Modify: `src/components/gallery/PhotoCard.tsx`, `src/components/gallery/Lightbox.tsx` (adopt the wrapper)
- Test: `tests/gallery/photo-image.test.tsx`

## Interfaces
- Consumes: the serialized photo shape from `src/lib/gallery/serialize.ts` (READ IT FIRST: photos carry multiple preview tiers; use the smallest existing tier as the placeholder, the current tier as the target). No schema or pipeline changes.
- Produces: `PhotoImage({ photo, tier, className, ... })` rendering the smallest preview scaled+blurred under the target image, crossfading on the target's `onLoad` (token durations), aspect-ratio reserved to prevent layout shift.

## Steps
- [ ] Implement with plain `<img>` layering (repo convention; no next/image). Reduced-data/reduced-motion: skip the crossfade, still reserve space.
- [ ] If the smallest tier is too large to be a cheap placeholder (check actual byte sizes in the serialized data), fall back to a dominant-color block from data already present, or report DONE_WITH_CONCERNS naming what a real LQIP would need; do NOT add a build step.
- [ ] Tests: placeholder renders first, target swap on load event, aspect ratio present.

## Done-check
Run: `npx vitest run tests/gallery && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS.
