# Task 03: Home rebuild (picked direction)

**Wave:** 1
**Depends on:** gate (read `docs/plans/2026-07-23-design-overhaul/PICK.md` first; it names the picked variant, the hero photo decision, and any notes from Zach and Rachel)

## Files
- Modify: `src/components/site/Hero.tsx`, `src/components/site/StoryChapter.tsx`, `src/components/site/PhotoMarquee.tsx`, `src/components/site/FeaturePortal.tsx`, `src/app/page.tsx`

## Interfaces
- Consumes: tokens + `Reveal` (task 00), `focalObjectPosition` (task 01), the picked comp's source under `src/app/(guest)/comps/` and its notes file.
- Produces: the shipped homepage. Component names and props stay source-compatible with current imports (pages and tests import these names).

## Steps
- [ ] Port the picked comp's hero, chapter rhythm, and signature element into the real components, replacing the comp's local sketches with production-quality implementations.
- [ ] Hero uses the picked hero photo with its focal crop; the H1 "From the coast to the dance floor" and all copy stay exactly as in `src/content/site.ts` (pinned).
- [ ] Salvage list: each non-picked variant's notes name what to keep; fold in what fits without diluting the picked thesis.
- [ ] Keep `tests/content/public-routes.test.tsx` green without weakening it (one h1, story chapters present, no protected content in public HTML).

## Done-check
Run: `npx vitest run tests/content && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS naming any comp element that could not be ported faithfully.
