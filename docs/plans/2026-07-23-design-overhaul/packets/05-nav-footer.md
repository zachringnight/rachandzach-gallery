# Task 05: Header, nav, footer

**Wave:** 1
**Depends on:** gate (read `PICK.md`)

## Files
- Modify: `src/content/site.ts` (navigation array only), `src/components/site/SiteHeader.tsx`, `src/components/site/SiteFooter.tsx`, `src/components/site/PublicShell.tsx` (if shell spacing needs it)

## Interfaces
- Consumes: tokens + `Reveal` (00); picked comp's header sketch as reference.
- Produces: shipped header/footer used by every page. Nav data contract unchanged: `NavigationItem { label, href, enabled, flag? }`.

## Steps
- [ ] Add `{ label: "Favorites", href: "/favorites", enabled: true }` to `navigation` in `src/content/site.ts` (Zach 2026-07-23). TV Mode stays out (URL-only, same decision). Playlists/Marathon untouched.
- [ ] Header: active-state treatment for the current route, scroll-refined behavior (e.g. compacting or hairline on scroll, per picked direction), a real mobile menu at 375px if the current header overflows with 6 items (verify; the grid pages currently waste header height on small screens).
- [ ] Footer: same care as the rest ("Made with love for the people we love." is pinned; Ali Beck Photo credit stays).
- [ ] Nav-related tests: `tests/modules/` asserts flagged routes stay out of nav; content tests may pin nav labels. Extend for Favorites presence; never weaken flag-off assertions.

## Done-check
Run: `npx vitest run tests/content tests/modules && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS.
