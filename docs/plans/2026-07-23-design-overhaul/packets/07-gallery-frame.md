# Task 07: Gallery frame + filter toolbar

**Wave:** 2 (first; 08/11/13/14/18 fan out after it)
**Depends on:** 03, 05

## Files
- Modify: `src/components/gallery/GalleryShell.tsx`, `src/components/gallery/FilterBar.tsx`, `src/components/gallery/EventPicker.tsx`, `src/components/gallery/PersonPicker.tsx`

## Interfaces
- Consumes: tokens + `Reveal` (00); header treatment (05).
- Produces: the gallery page frame every wave-2 packet composes into. Exposes an unchanged data contract (props from `src/lib/gallery/client-types.ts`) plus one new slot: a `toolbarSlot?: React.ReactNode` on the shell (task 18 mounts Moment Search entry there; task 09 mounts the selection bar).

## Steps
- [ ] Current failure mode: the filter rail is a tall vertical stack that buries photos below the fold (mobile especially). Redesign as a compact toolbar: sort + filters condensed, count line refined, mobile gets a collapsed filter sheet/disclosure, desktop a single refined rail or top bar per picked direction.
- [ ] PersonPicker keeps its hard rule: photo counts render ONLY on the selected person (Zach 2026-07-23, comment in the file). Restyle freely, never reintroduce resting counts.
- [ ] The grid must never scroll horizontally at 375px (current build clips the second column at narrow widths; fix the container math).
- [ ] Filter labels are pinned scan targets (Sort, Newest, Events, People etc.); style, do not rename.

## Done-check
Run: `npx vitest run tests/gallery tests/personalization && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS.
