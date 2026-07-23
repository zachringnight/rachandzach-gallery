# 0719 + co. Design Overhaul Plan

**Goal:** Take every guest-facing surface to agency-grade art direction, motion, and interaction quality, and add the selection/download feature wave, without breaking the green verify chain or the privacy model.

**Architecture:** Token-and-primitive foundation first (type scale, spacing, motion, focal points), then three rendered homepage comps decide the direction (Zach + Rachel pick from real pages, not descriptions), then per-surface rebuild waves consume the picked direction, then a closing quality wave regenerates visual baselines. Selection/batch-download rides the gallery wave and reuses the existing `POST /api/downloads/selection` endpoint.

**Tech stack:** Next.js 16 (App Router), TypeScript, Tailwind 4 (CSS-first tokens in `src/styles/tokens.css`), Fraunces + Inter via next/font (already loaded in `src/components/brand/Wordmark.tsx`), vitest + Playwright. No new runtime dependencies.

## The brief, in Zach's words (every packet designs to this)

The site is Rach and Zach's connection to their loved ones: how they show and share their love. High-end photography is the crown jewel and the first piece of many. The build must be so impressive it shows the time and effort they pour into the people they love. Rachel is a gifted creative; the work must survive her eye.

**Competitive baseline (Zach, 2026-07-23):** better than any photo-sharing app in every conceivable way; the floor is the union of the best of Google Photos and Dropbox. Already ahead: people-first browsing, moderated guest uploads, memories wall, TV mode, originals-grade ZIP. Gaps this plan closes: semantic search promoted to launch (task 18), blur-up loading (19), event scrubber (20), per-photo share (21), multi-select batch actions (09).

## Global constraints (every packet inherits these)

- Palette is LOCKED: existing tokens in `src/styles/tokens.css` (`--rz-cream #f6f0e4`, `--rz-ink #282521`, `--rz-muted #6b645a`, `--rz-wheat`, `--rz-sand`, `--rz-tan`, `--rz-coral #d38377`, white). New tokens may be derived (opacity/blend of these), no new hues.
- Copy is LOCKED (Fable pass approved 2026-07-23 in full). Do not rewrite existing guest-facing strings. New UI needs new strings: plain verbs, sentence case, no em dashes anywhere, no invented facts; error strings stay generic per security policy. Several strings are test-pinned; if a test names a string, the string wins.
- No new runtime dependencies. Motion = CSS transitions/keyframes + IntersectionObserver. Respect `prefers-reduced-motion` on every animation, and visible `:focus-visible` on every interactive element.
- Privacy model untouched: no new public routes (temp `/comps/*` lives under the guest gate and is deleted by task 17), no changes to `src/proxy.ts` or `PUBLIC_ROUTES` beyond what already landed, per-person photo counts render only on the selected person (PersonPicker rule, Zach 2026-07-23), no signed URL ever in public HTML.
- Media: always the existing signed-preview pipeline (`src/lib/gallery/*`); never raw storage paths, never `next/image` remote loaders (repo convention is `<img>` with signed URLs; keep the existing eslint warnings pattern rather than fighting it).
- Nav: Favorites joins `navigation` in `src/content/site.ts` (enabled). TV Mode stays URL-only (Zach 2026-07-23). Playlists/Marathon stay flag-gated.
- Verify chain must stay green: `npm run typecheck && npm run lint && npm run test` after every packet; `npx playwright test tests/e2e --project=chromium` is wave 3's job (visual baselines regenerate once, deliberately, task 17). Do not regenerate baselines mid-run.
- The preview server on port 4319 belongs to the orchestrator. Packets never start/stop servers; verification is tests + build only. Visual QA happens at wave boundaries by the orchestrator.
- No git commits (repo not yet initialized; Gate 1 comes after this plan lands).
- Responsive floor: 375px, 768px, 1280px all first-class. The gallery grid must never scroll horizontally.

## Task index

| ID | Task | Files touched | Depends on | Wave |
|----|------|---------------|------------|------|
| 00 | Tokens v2 + motion primitives | src/styles/tokens.css, src/components/motion/Reveal.tsx, tests/motion/ | none | 0 |
| 01 | Story-photo focal points | src/content/story-photos.ts, tests/content/ | none | 0 |
| 02 | Three homepage comps | src/app/(guest)/comps/, docs/plans/2026-07-23-design-overhaul/comps.md | 00, 01 | 0 |
| — | GATE: Zach + Rachel pick direction + hero | — | 02 | — |
| 03 | Home rebuild (picked direction) | src/components/site/Hero.tsx, StoryChapter.tsx, PhotoMarquee.tsx, FeaturePortal.tsx, src/app/page.tsx | gate | 1 |
| 04 | Weekend page editorial rebuild | src/components/site/WeekendTimeline.tsx, src/app/(public)/weekend/page.tsx | gate | 1 |
| 05 | Header, nav, footer | src/content/site.ts, src/components/site/SiteHeader.tsx, SiteFooter.tsx, PublicShell.tsx | gate | 1 |
| 06 | Enter page polish + progressive enhancement | src/app/(access)/enter/ | gate | 1 |
| 07 | Gallery frame + filter toolbar | src/components/gallery/GalleryShell.tsx, FilterBar.tsx, EventPicker.tsx, PersonPicker.tsx | 03, 05 | 2 |
| 08 | Photo cards + per-photo download | src/components/gallery/PhotoCard.tsx, VirtualPhotoGrid.tsx | 07 | 2 |
| 09 | Grid multi-select + batch download | src/components/gallery/ (new SelectionBar.tsx, useSelection.ts), VirtualPhotoGrid.tsx, tests/gallery/ | 08 | 2 |
| 10 | Lightbox + photo detail v2 | src/components/gallery/Lightbox.tsx, PhotoDetailView.tsx, RelatedPhotos.tsx | 08 | 2 |
| 11 | My Weekend v2 | src/components/personalization/ | 07 | 2 |
| 12 | Favorites v2 | src/components/favorites/FavoritesGallery.tsx | 08 | 2 |
| 13 | Add Yours v2 | src/app/(guest)/add-yours/, src/components/uploads/ | 05 | 2 |
| 14 | TV mode chrome | src/app/(guest)/tv/TvClient.tsx | gate | 2 |
| 15 | Site-wide motion pass | all site/gallery components (Reveal wiring) | 07-14, 18-21 | 3 |
| 16 | A11y + performance pass | targeted fixes surfaced by audit | 15 | 3 |
| 17 | Baselines, cleanup, docs | tests/e2e visual baselines, delete src/app/(guest)/comps/, docs/HANDOFF_CURRENT.md, docs/0719_Launch_Checklist_v1.md | 16 | 3 |
| 18 | Moment Search to launch | src/content/features.ts, tests/modules/, search UI surface in gallery frame | 07 | 2 |
| 19 | Blur-up loading (LQIP) | src/lib/gallery/ (preview pipeline types), PhotoCard.tsx, Lightbox.tsx | 08 | 2 |
| 20 | Event scrubber | VirtualPhotoGrid.tsx (new EventScrubber.tsx) | 08 | 2 |
| 21 | Per-photo share + copy link | PhotoCard.tsx, Lightbox.tsx, PhotoDetailView.tsx | 10 | 2 |

## Waves

- Wave 0: 00, 01 (parallel), then 02. Ends at the human gate: comp pick + hero pick.
- Wave 1: 03, 04, 05, 06 (parallel after the pick).
- Wave 2: 07 first, then 08, 10, 11, 13, 14, 18 (parallel; 09, 12, 19, 20 after 08; 21 after 10).
- Wave 3: 15, then 16, then 17. Full `npm run verify` green closes the plan.

## Explicitly out of this plan (round two doc, not forgotten)

Comment threads beyond memories, reactions beyond hearts, AI auto-captions, music on slideshows (playlists flag covers it), Google/Dropbox OAuth save buttons (waiting on client IDs, already built and hidden).

## Report protocol

Every packet reports exactly one of: DONE, DONE_WITH_CONCERNS (name the concern), BLOCKED (name the blocker), NEEDS_CONTEXT (name what is missing). The orchestration script reads these and halts a dependent wave on anything that is not DONE/DONE_WITH_CONCERNS.
