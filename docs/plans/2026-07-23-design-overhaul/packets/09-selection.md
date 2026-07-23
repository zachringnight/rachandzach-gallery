# Task 09: Grid multi-select + batch download + batch favorite

**Wave:** 2
**Depends on:** 08

## Files
- Create: `src/components/gallery/useSelection.ts`, `src/components/gallery/SelectionBar.tsx`
- Modify: `src/components/gallery/VirtualPhotoGrid.tsx`, `src/components/gallery/GalleryShell.tsx` (mount the bar in the 07 toolbarSlot)
- Test: `tests/gallery/selection.test.tsx`

## Interfaces
- Consumes: `PhotoCard.selectionSlot` (08); `POST /api/downloads/selection` body `{ photoIds: string[] }` (EXISTS, read `src/app/api/downloads/selection/route.ts` for response shape and limits before wiring); favorites batch via the existing favorites client (read `src/lib/favorites/` and `src/app/api/favorites/` for the exact add API; loop client-side if no batch endpoint exists, do not invent server changes).
- Produces:
  `useSelection(): { selecting: boolean; selected: ReadonlySet<string>; start(): void; toggle(id: string): void; selectAllVisible(ids: string[]): void; clear(): void }`
  `SelectionBar({ count, onDownload, onFavoriteAll, onClear })`

## Steps
- [ ] Entry points: a "Select" affordance in the gallery toolbar; long-press on a card (mobile) and a hover checkbox via `selectionSlot` (desktop) start selection mode.
- [ ] In selection mode: tap toggles, "Select all in view" offered, selection bar pins to viewport bottom with count ("N selected"), actions: Download, Favorite all, Clear. Esc clears. Selection survives scroll (ids, not indexes).
- [ ] Download: POST the ids to the selection endpoint, hand off to the existing ZIP tray flow (find the tray component the favorites ZIP uses and reuse it verbatim).
- [ ] a11y: cards get `aria-checked` semantics in selection mode; bar announces count via `aria-live=polite`; all keyboard reachable.
- [ ] Tests: hook behavior (toggle/clear/selectAllVisible), bar renders count, download handler posts exact ids.

## Done-check
Run: `npx vitest run tests/gallery && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS (name any endpoint limit that caps selection size; surface, do not silently truncate).
