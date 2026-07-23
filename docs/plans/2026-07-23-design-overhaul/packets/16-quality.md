# Task 16: A11y + performance pass

**Wave:** 3
**Depends on:** 15

## Files
- Modify: targeted fixes only, wherever the audit points

## Steps
- [ ] Contrast: every text/background pair introduced by the overhaul re-checked against the 4.5:1 floor (tokens comment in tokens.css documents the approved pairs).
- [ ] Focus: visible `:focus-visible` on every interactive element added by the overhaul (cards, selection, lightbox chrome, scrubber, share).
- [ ] Images: every `<img>` carries width/height or aspect-ratio to prevent layout shift; lazy-loading below the fold; the hero eager.
- [ ] Bundle: confirm zero new runtime dependencies landed (`git status` is unavailable, so check `package.json` diff by eye) and no component imports a heavyweight module client-side that the plan did not sanction.
- [ ] Run the axe unit-level checks that exist in the repo; log anything deferred.

## Done-check
Run: `npm run test && npm run lint && npm run typecheck`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS listing every deferred a11y/perf item.
