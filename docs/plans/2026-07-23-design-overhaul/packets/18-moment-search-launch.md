# Task 18: Moment Search to launch

**Wave:** 2
**Depends on:** 07

## Files
- Modify: `src/content/features.ts` (flag), `tests/modules/` (flag assertions updated WITH the decision), gallery frame toolbar slot (07) for the entry point
- Read first: `src/lib/search/`, `src/app/api/search/route.ts`, existing Moment Search UI under `src/app/(guest)/my-weekend/` or its own surface (locate it; it shipped in packet 07 of the original build)

## Interfaces
- Consumes: `toolbarSlot` (07). Search backend is DONE: 1,721 CLIP embeddings live in `rachandzach_photo_embeddings`, RPC `rachandzach_search_gallery_moments()` deployed.
- Produces: Moment Search reachable by guests ("find the cake, the dip, the confetti" class of queries).

## Steps
- [ ] Flip the `momentSearch` flag from dev-only to enabled. This is a Zach-directed launch (2026-07-23 competitive baseline: the union of the best of Google Photos and Dropbox; semantic search is the centerpiece feature).
- [ ] Update the flag tests deliberately: assertions that pinned "dev-only" now pin "on"; sitemap/robots exposure must NOT change (search lives behind the guest gate; verify the flag flip adds no public surface).
- [ ] Entry point: a search affordance in the gallery toolbar (07's slot) plus wherever the existing UI already mounts; results open in the shared lightbox (10).
- [ ] Empty/loading/error states to design-system standard; result quality is verified by the orchestrator live at the wave boundary (agents cannot query the cloud DB from tests; unit tests mock).

## Done-check
Run: `npx vitest run tests/modules tests/gallery && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS.
