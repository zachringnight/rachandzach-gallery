# 0719 + co. Content Needed

**Historical status: v1, finalized by packet 12 (2026-07-22).** This preserves
the pre-launch content and decision snapshot. For current production state,
remaining owners, and continuation commands, use `docs/ONLINE_HANDOFF.md`.
This document keeps its original structure below and is updated only where an
item's historical status changed.

Everything the build still needs from Zach, compiled from the manifest end-review eyeball list and the packets. Nothing here blocks local implementation; each item blocks the specific step listed. Packet 12 updates statuses and adds anything discovered during integration.

## Known issues discovered during packet 12 integration

All six items below (five plus the lint failure) are now closed. Kept here for the record, in the order they were found; full detail and exact fixes are in `docs/0719_Launch_Checklist_v1.md` and `docs/HANDOFF_CURRENT.md` section 3.

- [x] **`rachandzach_consume_rate_limit()` errors on every call.** STALE FINDING, already fixed before this doc was written: corrective migration 202607220004_rate_limit_conflict_fix.sql (targets the PK constraint by name, sidestepping the plpgsql ON CONFLICT ambiguity) was applied to the cloud project earlier on 2026-07-22 and live-smoke-tested (limit 1: first call true, second false, cleanup verified). Re-verified again after this doc appeared: same passing result. The packet 12 scan evidently tested before the corrective migration landed or read the pre-fix SQL text of 202607220001.
- [x] **The real full-catalog media sync has not completed.** SUPERSEDED, then CLOSED: root cause found (this network corrupts individual HTTPS request bodies above roughly 1 MB; TLS bad_record_mac reproduced with both Node fetch and curl) and fixed by switching the sync's real upload path to Supabase resumable TUS uploads with 1 MB chunks (every request stays under the corruption threshold). The sync finished clean overnight: 13,532 of 13,532 objects, 0 failures; chained catalog sync also finished, 23,885 of 23,885 rows; a post-sync verification sweep sampled 241 photos across 6 shards with zero mismatches. Full numbers: `docs/HANDOFF_CURRENT.md` section 2.
- [x] **One pre-existing unit test fails on a full run.** FIXED 2026-07-22: the no-invented-URLs sweep now excludes `siteConfig.photographer` (the two Zach-confirmed credit links); all 36 content tests pass.
- [x] **WCAG contrast on footer and login error text.** FIXED 2026-07-22 (from this doc's e2e findings): footer text switched from muted to ink on the sand surface (muted-on-sand was ~4.05:1, below AA for small text), and the login error message reads in ink instead of coral (coral-on-cream is 2.54:1; coral stays decorative). The e2e suite's synthetic-session-cookie question remains open for the final-verify rerun.
- [x] **The packet 12 e2e suite is not green yet, though it improved fast.** CLOSED 2026-07-22 (into the early hours of 2026-07-23): fully green. Final run of the night (`npx playwright test tests/e2e --project=chromium`): 82 passed, 28 skipped, 0 failed. The remaining `/favorites` contrast defect noted below the WCAG fixes is fixed too (see the lint item below; the same integration pass that closed lint also fixed a real pre-existing infinite-render bug in `FavoritesGallery.tsx`'s `useFavoriteIds`). Current authoritative numbers: `docs/HANDOFF_CURRENT.md` section 3.
  - Owner: closed, no further owner needed
- [x] **`npm run lint` fails, blocking `npm run verify` before it reaches tests/build/e2e.** CLOSED 2026-07-22 (into the early hours of 2026-07-23): `playwright-report/` and `test-results/` are now excluded from both `eslint.config.mjs` and `.gitignore`, same as `.venv-search/`. All 4 `react-hooks/set-state-in-effect` findings in `FavoritesGallery.tsx` and `Slideshow.tsx` are fixed (derived state instead of corrective effects; no `eslint-disable` needed). `npm run lint` now returns 0 errors, 14 warnings, all pre-existing. Full detail: `docs/plans/2026-07-22-0719-digital-wedding-home/reviews/polish-sweep.md`.
  - Owner: closed, no further owner needed

## Content

- [ ] **Playlist details.** Titles, descriptions, Spotify URLs, and optional event pairings for each playlist chapter.
  - Owner: Zach (with Rachel)
  - Blocks: enabling the `playlists` flag; the `/playlists` route returns not found until real content arrives (packet 11)
- [ ] **Marathon story and donation URL.** Rachel's story, race name, charity name, canonical donation URL, optional goal amount, and whether to display progress.
  - Owner: Zach (with Rachel)
  - Blocks: enabling the `marathon` flag; the `/marathon` route returns not found until then (packet 11)
- [x] **Photographer credit.** CLOSED 2026-07-22: Ali Beck Photo, website https://www.alibeck.co/, Instagram https://www.instagram.com/alibeckphoto/. Wired into siteConfig.photographer and the footer; both links open in a new tab.
  - Owner: Zach
- [ ] **Hero photo approval.** Approve the 0719 + co. logo treatment, hero selects, and copy. Development selections are recorded in site content; Zach has deferred visual review to end review.
  - Owner: Zach
  - Blocks: final public look sign-off and launch readiness (packets 01, 05, 12); build proceeds with development selections meanwhile

## Access and accounts

- [x] **Production guest password decision.** CLOSED 2026-07-22: 071925. Real Argon2id hash and a fresh GALLERY_SESSION_SECRET are staged in .env.cloud (gitignored, not auto-loaded by Next), ready to paste into Vercel's environment variable UI at deploy time.
  - Owner: Zach
- [x] **Supabase project, region, and retention.** CLOSED 2026-07-22: existing shared Pro project PrizmLounge (ref rnfvmqflktghriqefatc, us-west-2), not a new dedicated project. All wedding objects carry the rachandzach_/rachandzach- prefix; migrations applied and live-verified with zero drift, zero anon grants. Storage cap 1 GiB, SMTP already configured project-wide.
  - [x] Bucket backup policy: CLOSED 2026-07-22. Originals exist in three independent copies (local clean master, Zach's personal Dropbox, Supabase buckets), covering the Storage-objects gap in Pro backups. Only future guest uploads lack an offsite copy; revisit if they accumulate (noted in 0719_Round_Two_Features_v1.md).
  - Owner: Zach
- [ ] **Resend sender domain.** Approve the sender-domain configuration and all outbound emails. Resend stays disabled until `RESEND_API_KEY`, a verified sender, and explicit send approval exist. Exact DNS records and commands: `docs/HANDOFF_CURRENT.md` Gate 3.
  - Owner: Zach
  - Blocks: real batch and decision notifications (packet 10); the app functions without email
- [ ] **Domain and launch approvals.** Approve the first Vercel preview, then separately the production domain and public launch. The folder is not yet a Git repository; creating a remote, connecting Vercel, and deploying are each separate approval steps. `.github/workflows/ci.yml` is authored and waiting; it activates automatically the moment the repo has a GitHub remote with Actions enabled, no separate approval needed for CI itself once the remote exists. Exact commands for every gate: `docs/HANDOFF_CURRENT.md` section 9.
  - Owner: Zach
  - Blocks: any deploy, preview or production (packet 12)

## Decisions

- [x] **Approved guest originals: downloadable or display-only.** CLOSED 2026-07-22: downloadable, same as photographer originals. This already matches how packet 09 was built (one-photo download and ZIP export never distinguish source; both come from the original bucket, never a preview), so no code change was needed.
  - Owner: Zach

## Environment

- [ ] **Docker install for local stack checks.** The packet 03 done-check (`supabase db reset` plus the schema tests) and packet 13's local execution mode run against a local Supabase stack, which requires Docker on this machine.
  - Owner: Zach
  - Blocks: full local verification of migrations, storage policies, and sync (packets 03 and 13); schema authoring itself is not blocked
