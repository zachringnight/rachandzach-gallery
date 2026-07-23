# Task 15: Site-wide motion pass

**Wave:** 3 (first)
**Depends on:** every wave-2 packet landed

## Files
- Modify: site + gallery components (Reveal wiring and transition tuning only; no structural changes)

## Interfaces
- Consumes: `Reveal` (00) and everything landed in waves 1-2.

## Steps
- [ ] One choreography, not scattered effects: page-load sequence on home (hero settles, then type, then chapters as they enter), scroll reveals consistent across pages (same duration/ease tokens), hover micro-interactions only where they inform (cards, nav, controls).
- [ ] Audit for motion debt: any transition not using the 00 tokens gets migrated; anything gratuitous gets removed (the Chanel rule: remove one accessory).
- [ ] `prefers-reduced-motion`: walk every animated surface with the media query forced; everything must simply appear.

## Done-check
Run: `npm run test && npm run typecheck && npm run lint`
Expected: all pass (full unit suite; motion touched many files).

## Report
DONE, or DONE_WITH_CONCERNS.
