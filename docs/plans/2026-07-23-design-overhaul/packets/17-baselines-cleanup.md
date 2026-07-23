# Task 17: Baselines, cleanup, docs

**Wave:** 3 (last)
**Depends on:** 16

## Files
- Delete: `src/app/(guest)/comps/` (entire directory)
- Modify: visual baselines under `tests/e2e/` (regenerate via the suite's snapshot update mode), `docs/HANDOFF_CURRENT.md` (overhaul summary + new features), `docs/0719_Launch_Checklist_v1.md` (design items closed)

## Steps
- [ ] Delete the comps route and the js-only artifacts it owned; grep for `comps` imports to confirm nothing references it.
- [ ] Tab titles: verify every page's `metadata.title` follows one suffix pattern.
- [ ] Regenerate the visual e2e baselines ONCE (`npx playwright test tests/e2e --project=chromium --update-snapshots` for the visual spec only), then run the full bounded suite clean.
- [ ] CI platform guard: every baseline is `-darwin.png`, so the visual spec will fail on ubuntu CI (no linux snapshots, Playwright refuses missing snapshots in CI). Add `ignoreSnapshots: !!process.env.CI` to `playwright.config.ts` with a comment explaining why (flows still run in CI; pixel comparisons are local-only until linux baselines exist). Keep local enforcement intact.
- [ ] Docs: HANDOFF_CURRENT gains a short "Design overhaul + feature wave (2026-07-23)" section listing what changed and the new feature surface (selection, per-photo download/share, scrubber, Moment Search live, LQIP); Launch Checklist design rows flip to PASS with evidence.
- [ ] Final gate: full chain.

## Done-check
Run: `npm run verify`
Expected: exit 0, all stages green.

## Report
DONE only on a fully green verify; otherwise BLOCKED with the failing stage.
