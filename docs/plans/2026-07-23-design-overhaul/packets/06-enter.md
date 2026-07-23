# Task 06: Enter page polish + progressive enhancement

**Wave:** 1
**Depends on:** gate (read `PICK.md`)

## Files
- Modify: `src/app/(access)/enter/` (page + form component)
- Test: extend the existing enter/access unit tests in `tests/`

## Interfaces
- Consumes: tokens (00). Existing `POST /api/access/login` stays untouched for API clients and tests.
- Produces: a gate page in the picked direction whose form works identically with and without JS.

## Steps
- [ ] Design: the gate is a guest's first touch. Elevate the card (typography, spacing, a story photo or textural use of the palette per picked direction) without slowing it down.
- [ ] Progressive enhancement bug (found in end review): an early submit before hydration does a native POST to `/api/access/login` and renders raw JSON on a black page. Fix so the no-JS/native path re-renders `/enter` with the inline error instead (server action with `useActionState`, or a form action route that redirects back with the error state). The JS path keeps its current inline behavior. Pinned strings ("that is not the password we sent" class of copy) stay exactly.
- [ ] Rate-limit behavior unchanged (`rachandzach_consume_rate_limit` flows through whatever the current login path calls; do not alter auth logic, only the form transport).
- [ ] Test: native form submission path returns to `/enter` with the error rendered (unit-test the action; the e2e access spec stays green in wave 3).

## Done-check
Run: `npx vitest run tests/auth tests/content && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS.
