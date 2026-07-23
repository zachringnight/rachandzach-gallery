# Task 20: Event scrubber

**Wave:** 2
**Depends on:** 08

## Files
- Create: `src/components/gallery/EventScrubber.tsx`
- Modify: `src/components/gallery/VirtualPhotoGrid.tsx` (mount + expose boundaries)
- Test: `tests/gallery/event-scrubber.test.tsx`

## Interfaces
- Consumes: `scrollToIndex(index)` produced by 08; the loaded photo list's event metadata (events and their first-photo indexes; compute boundaries from the data already in the grid, no new fetches).
- Produces: a scrubber rail for fast navigation through 1,721 photos: event landmarks (Getting Ready, Ceremony, Reception, ...) with jump-on-tap; on drag (desktop) or press-drag (mobile), a floating label shows the event under the thumb.

## Steps
- [ ] Design: quiet at rest (hairline + dots per direction), expands on hover/touch. Never overlaps the selection bar (09); coordinate z-index/insets via tokens.
- [ ] Only landmark events with loaded-or-known indexes are jumpable; jumping near unloaded ranges triggers the grid's existing load-more path (read how pagination works in VirtualPhotoGrid before wiring; if full-index jumps are impossible without data changes, scope to loaded ranges and report the limitation).
- [ ] a11y: a visually-hidden select fallback ("Jump to event") for keyboard/screen readers.
- [ ] Tests: boundary computation from a fixture list; jump calls scrollToIndex with the right index.

## Done-check
Run: `npx vitest run tests/gallery && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS.
