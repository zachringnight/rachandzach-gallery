# Task 08: Photo cards + per-photo download

**Wave:** 2
**Depends on:** 07

## Files
- Modify: `src/components/gallery/PhotoCard.tsx`, `src/components/gallery/VirtualPhotoGrid.tsx`
- Test: extend `tests/gallery/`

## Interfaces
- Consumes: frame from 07; existing per-photo download endpoint under `src/app/api/downloads/photo/` (read its route.ts for the exact URL shape before wiring).
- Produces: `PhotoCard` with a `selectionSlot?: React.ReactNode` prop (task 09 renders its checkbox there) and a download affordance on every card. Grid exposes `scrollToIndex(index: number)` (from the TanStack virtualizer) for task 20.

## Steps
- [ ] Card design: refined hover state (desktop) and pressed state (mobile), the favorite heart restyled from the generic gray circle into the design system, people-name chip redesigned (currently a utilitarian dark chip with truncation; consider reveal-on-hover/tap with graceful truncation).
- [ ] Download on every photo (Zach 2026-07-23): a quiet per-card affordance (hover/hold reveal) that triggers the existing photo download endpoint; must not fight the card's open-lightbox tap target. Label: "Download".
- [ ] a11y: card is a button/link with a descriptive aria-label (existing pattern "Open photo from {event} with {names}" stays); download affordance keyboard-reachable.
- [ ] Grid: spacing/rhythm per picked direction; virtualization behavior and load-more contract unchanged.

## Done-check
Run: `npx vitest run tests/gallery && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS.
