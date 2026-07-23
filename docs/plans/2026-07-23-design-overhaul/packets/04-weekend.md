# Task 04: Weekend page editorial rebuild

**Wave:** 1
**Depends on:** gate (read `PICK.md` in the plan root)

## Files
- Modify: `src/components/site/WeekendTimeline.tsx`, `src/app/(public)/weekend/page.tsx` (chapter sections live here or in site components; follow current structure)

## Interfaces
- Consumes: tokens + `Reveal` (00), picked-direction language (03's hero/chapter treatment is the reference once it lands; if running concurrently, read the picked comp instead).
- Produces: the weekend story page in the picked direction.

## Steps
- [ ] The page is the site's narrative heart: three days in order. Apply the timestamp device to the timeline (real times already in content), editorial pacing between timeline and chapters, story photos with focal crops where used.
- [ ] All copy pinned (the Fable pass landed here; do not touch strings). FAQ and travel sections get the same typographic system, no new content.
- [ ] Escalation beats the copy already carries (sound ordinance fact, wink, consequence) deserve typographic support: let the design land the joke, never repeat it.

## Done-check
Run: `npx vitest run tests/content && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS.
