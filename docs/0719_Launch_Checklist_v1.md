# 0719 + co. Launch Checklist v1

**Status: v1, packet 12 (2026-07-22). NOT DEPLOYED.** Nothing in this document has been executed by writing it; every checkbox below is unchecked unless marked CLOSED with a date. This is the single place that collects every remaining action before a human calls this launched: engineering fixes first, then Zach's approvals, then the deploy gates, then manual pre-launch QA. Section 1's engineering defects and Gate 3's media sync are now all closed; see `docs/HANDOFF_CURRENT.md` for the current authoritative state and the exact commands for every gate still open.

Companion docs: `docs/0719_Architecture_v1.md` (what is built), `docs/0719_Privacy_Operations_v1.md` (privacy commitments and enforcement), `docs/0719_Content_Needed_v1.md` (content and decisions, with the same engineering findings cross-listed there).

## How to read this list

- **Section 1** items are code/config defects an engineer (or the next agent) fixes. They are not Zach's decisions, but he should know they exist.
- **Section 2** items are Zach's calls: content, money, and irreversible connections. Each names the exact command or dashboard action.
- **Section 3** is the deploy sequence itself, gated in order. Every step here is a **separate future approval** -- none of it happens by finishing this checklist.
- **Section 4** is manual QA that this environment cannot automate, run once before the Section 3 gates.
- **Section 5** is the automated done-check, run last, and what to do if it is not runnable yet.

---

## 1. Blocking engineering defects (fix before trusting any test run)

Listed in the order `npm run verify` actually hits them (it is a strict `&&` chain: typecheck, then lint, then unit tests, then build, then the bounded e2e suite; the first failure stops everything after it). **All five items below are now closed.** Kept in their original order for the record; current authoritative numbers are in `docs/HANDOFF_CURRENT.md` section 3.

- [x] **1a. `npm run lint` fails, blocking the rest of `npm run verify` before it reaches tests/build/e2e at all.** CLOSED 2026-07-22 (into the early hours of 2026-07-23):
  - `.venv-search/` exclusion: **FIXED**, as recorded below.
  - `playwright-report/` and `test-results/` exclusion: **FIXED.** Both are now in `.gitignore` and `eslint.config.mjs`'s `globalIgnores`, same as `.venv-search/`.
  - The 4 `react-hooks/set-state-in-effect` errors in `src/components/favorites/FavoritesGallery.tsx` and `src/components/slideshow/Slideshow.tsx`: **FIXED**, all replaced with derived state or the "adjust state while rendering" pattern, no `eslint-disable` used. Fixing them also surfaced and fixed a fifth, pre-existing bug in the same file: `useFavoriteIds` returned a fresh array reference on every `useSyncExternalStore` call, which throws "Maximum update depth exceeded" on first render with zero favorites in a real browser, not only under test.
  - Verify: `npm run lint` now returns 0 errors, 14 warnings, all pre-existing. Full detail: `docs/plans/2026-07-22-0719-digital-wedding-home/reviews/polish-sweep.md`.
- [x] **1b. Rate-limit RPC errors on every call. FIXED and independently re-verified this pass.** `supabase/migrations/202607220004_rate_limit_conflict_fix.sql` now exists (`on conflict on constraint rachandzach_rate_limit_buckets_pkey`, sidestepping the PL/pgSQL column-vs-parameter ambiguity) and was applied to and live-smoke-tested against the cloud project. Detail on the original bug: `docs/plans/2026-07-22-0719-digital-wedding-home/reviews/cloud-schema-verification.md`.
- [x] **1c. Unit test failure. FIXED and independently re-verified this pass.** `npx vitest run tests/content/site-content.test.ts`: 18/18 passing, including the previously-failing "invents no URLs anywhere in the content" case (now excludes `siteConfig.photographer`'s approved credit links from that specific check).
- [x] **1d. Bounded e2e suite is not fully green yet, but improving fast.** CLOSED 2026-07-22 (into the early hours of 2026-07-23): fully green. Final run: **82 passed / 0 failed / 28 skipped** (110 total).
  - The WCAG AA color-contrast cluster from the first snapshot is fixed (footer text and the `/enter` error message both switched from a low-contrast color to `ink`; see the comment at `src/app/(access)/enter/AccessForm.tsx` around line 52 for the contrast-ratio math).
  - The `/favorites` failure from the second snapshot is fixed: the underlying cause was the `useFavoriteIds` infinite-loop bug noted under 1a above, not a database-reachability issue. The login-rate-limit-copy assertion and `uploads.spec.ts` findings from the second snapshot are also resolved; nothing failing remains.
  - Verify: `npx playwright test tests/e2e --project=chromium` returns 0 failed. Confirmed.
- [x] **1e. Real full-catalog media sync is IN PROGRESS, not complete.** CLOSED 2026-07-22 (into the early hours of 2026-07-23): COMPLETE. The root cause (this network corrupting HTTPS request bodies above roughly 1 MB) was fixed by switching the real upload path to TUS resumable uploads in 1 MB chunks. The `--execute` run finished clean overnight: 13,532 of 13,532 objects (1,721 originals + 11,811 previews), 0 failures. The chained catalog sync also finished: 23,885 of 23,885 rows. A post-sync verification sweep sampled 241 photos across 6 shards with zero mismatches. Full numbers: `docs/HANDOFF_CURRENT.md` section 2.

## 2. Zach's approvals

Already decided (for the record, no action needed):
- [x] Shared guest-access password: `071925`. Hash staged in `.env.cloud`.
- [x] Supabase project: existing shared "PrizmLounge" (`rnfvmqflktghriqefatc`, us-west-2), not a new dedicated project.
- [x] Approved guest originals are downloadable (matches how packet 09 already built it; no code change needed).
- [x] Photographer credit: Ali Beck Photo, website and Instagram wired into the footer.

Still open:
- [ ] **Hero photo, logo treatment, and copy approval.** Development selections are live now (`src/content/story-photos.ts` marks every pick `"dev placeholder, pending Zach's visual approval"`); nothing here requires a code change to approve, only a look and a yes/no. Per the plan's hard constraint, no agent does the visual review.
- [ ] **Playlist details** (titles, descriptions, Spotify URLs, event pairings). Blocks the `playlists` flag; `/playlists` returns not found until then.
- [ ] **Marathon story and donation URL** (story, race/charity name, canonical URL, optional goal). Blocks the `marathon` flag; `/marathon` returns not found until then.
- [ ] **Resend sender-domain approval and every outbound email template.** `rachandzach.com` is the intended sending domain; DNS records are not yet registered (Section 3, Gate 4). The app runs with email disabled until `RESEND_API_KEY` plus a verified sender exist.
- [x] **Supabase bucket retention/backup policy.** CLOSED 2026-07-22 (Zach): already satisfied. Originals exist in three independent copies (local clean master, Zach's personal Dropbox, Supabase buckets once synced), covering the Storage-objects gap in Pro's daily backups. Only future guest uploads lack an offsite copy; revisit if they accumulate meaningfully. Detail: `docs/0719_Round_Two_Features_v1.md`.
- [ ] **Supabase auth redirect allow-list.** The shared project's `site_url` currently points at a different app. Once a preview URL exists (Gate 2), add it to the project's redirect allow-list (`uri_allow_list`) via the Supabase dashboard (Authentication > URL Configuration) or management API. There is no in-app "request a magic link" form yet (`/admin`'s bootstrap is a documented, apparently deliberate gap) -- until one exists, generate wedding@rachandzach.com's magic link directly from the Supabase dashboard's Authentication > Users panel, with an explicit `redirect_to` pointed at the deployed site. Exact step-by-step: `docs/HANDOFF_CURRENT.md` Gate 2.

## 3. Deploy sequence -- each gate is a SEPARATE FUTURE APPROVAL, none implied by this document

This repository is not a Git repository today (`git status` fails; verified for this packet). Nothing below happens automatically. `docs/0719_Launch_Ops_v1.md` has the full DNS/pricing detail behind gates 2 and 4-5 below (Vercel Hobby, Resend free tier) and remains accurate for those; its Supabase section is superseded by the actual decision recorded in Section 2 above (existing shared project, not a new dedicated one).

- [ ] **Gate 1: Create the Git repository and remote. APPROVAL REQUIRED.**
  - Action: `git init`, review `.gitignore` (already present; confirms `.env`, `.env*.local`, and `.env.cloud` are excluded), one initial commit, push to a new private GitHub repository under Zach's account.
  - Unlocks: `.github/workflows/ci.yml` starts running automatically on pushes to `main`, `staging`, and `preview/**` (no separate approval needed for CI itself once the remote exists and Actions are enabled).
  - Rollback: delete the remote; the local tree is unaffected.
- [ ] **Gate 2: Create the Vercel project. APPROVAL REQUIRED.**
  - Action: import the GitHub repo into a Vercel Hobby project, framework Next.js. `vercel.json`'s `ignoreCommand` (untouched by this packet) already restricts builds to `main`, `staging`, and `preview/*`; its `headers` block (added this packet) sets immutable caching on `/story/*` and `no-store` on every `/api/*` route and `/auth/callback`. Add env var **names** now (values after Gates 3-4); confirm Vercel Authentication (Standard Protection) is on for previews.
  - Rollback: delete the Vercel project; GitHub and local are unaffected.
- [x] **Gate 3: Real media in the cloud project. CLOSED 2026-07-22 (into the early hours of 2026-07-23).**
  - **3a.** Section 1b rate-limit fix applied to the cloud project's migration: done, live-smoke-tested. No action needed.
  - **3b.** The network-path problem is fixed (switched the real upload path to TUS resumable uploads in 1 MB chunks). The `--execute` sync finished clean overnight: 13,532 of 13,532 objects, 0 failures, and the chained `sync-gallery-catalog.mjs` run completed too: 23,885 of 23,885 rows.
  - **3c.** A post-sync verification sweep sampled 241 photos across 6 shards against the live cloud project: zero mismatches, zero missing objects. The reconciliation commands remain available to re-run anytime: `npm run verify:catalog -- --db-env-file .env.cloud` and `npm run verify:originals -- --remote --project-ref rnfvmqflktghriqefatc --allowlist rnfvmqflktghriqefatc --env-file .env.cloud`.
  - Full numbers: `docs/HANDOFF_CURRENT.md` section 2. This gate no longer blocks Gate 5's precondition.
- [ ] **Gate 4: Resend domain. APPROVAL REQUIRED.**
  - Action: register `rachandzach.com` in Resend, add the DNS records it emits (MX + SPF on `send.rachandzach.com`, DKIM on `resend._domainkey.rachandzach.com`, optional DMARC `p=none` on `_dmarc.rachandzach.com` -- exact values and a Cloudflare-specific note in `docs/0719_Launch_Ops_v1.md`), send one test email to wedding@rachandzach.com only, then set `RESEND_API_KEY` in Vercel.
  - Rollback: delete the domain in Resend and the three added DNS records; none touch the domain's existing mail flow.
- [ ] **Gate 5: DNS cutover and public launch. APPROVAL REQUIRED.**
  - Precondition: Zach has reviewed and approved a Vercel preview deployment (protected by Vercel Authentication) with real data from Gate 3.
  - Action: lower the current apex/www DNS TTL 24-48 hours ahead, then add the domain in Vercel (apex A record, www CNAME per the dashboard's shown values), confirm SSL issues, confirm the guest gate fails closed, confirm an original download reproduces its source hash, confirm the admin magic link arrives.
  - Rollback: restore the recorded prior A/www records; propagation is minutes at the lowered TTL.

## 4. Manual pre-launch QA (not automated in this environment)

- [ ] **Lighthouse on a representative protected page, mobile.** Real data now exists in the cloud project (Gate 3 closed), so this is unblocked; it no longer needs a Vercel preview specifically, only a server pointed at the live project (local `npm run start` with `.env.cloud`'s values, or a preview once Gate 2 lands) and an authenticated session cookie. Run against a page that needs a real guest session to render meaningfully (e.g. `/photos` or `/my-weekend`) -- Lighthouse against an empty/error-state page is not a meaningful reading. Not yet run as of this pass.
  - Command: `npx lighthouse <url> --preset=desktop --form-factor=mobile --screenEmulation.mobile --only-categories=accessibility,performance --view` (or Chrome DevTools' Lighthouse panel with mobile emulation, with an authenticated session cookie already set in the browser).
  - Targets: **accessibility >= 90, performance >= 85.**
  - The WCAG AA contrast findings (footer, login-error text, and the `/favorites` empty state) are all fixed now (Section 1a, 1d), which should help this reading; confirm rather than assume once a real Lighthouse run happens.
- [ ] **Visual review of hero, logo, and gallery selects** -- by Zach, not an agent (hard constraint on this build). Full end-review agenda: `docs/HANDOFF_CURRENT.md` section 8.
- [ ] **A manual click-through of the admin moderation flow** with at least one real guest upload. Real data now exists in the cloud project (Gate 3 closed), so this is unblocked and doable anytime, locally or on a preview. Section 1b's rate-limit fix is already applied, so upload submission is not blocked by it either. Not yet run as of this pass.

## 5. Automated done-check

Packet 12's specified done-check:

```
npm run verify && npm run verify:catalog && npm run verify:originals
```

All three are now wired into `package.json`. **All three now pass, exit code 0.** Current numbers, from the final run of the night (`docs/plans/2026-07-22-0719-digital-wedding-home/reviews/polish-sweep.md`; full breakdown in `docs/HANDOFF_CURRENT.md` section 3):

- **`npm run verify`: PASSES, exit code 0.** `typecheck` clean; `lint` 0 errors (14 warnings, all pre-existing); `vitest run` 817 passed, 11 skipped (828 total, 46 files); production build succeeds with the synthetic env; the bounded Playwright suite is 82 passed, 28 skipped, 0 failed.
- **`npm run verify:catalog`: PASSES in its default (local-only) mode:** `master valid photos=1721 catalog photos=1721 (match); hash diff: 0 missing-from-catalog, 0 missing-from-master; events: 0 mismatched of 14; people: 0 mismatched of 132`. The `--db-env-file .env.cloud` remote-reconciliation variant is now meaningful to run too, since Gate 3's sync is complete; the live database counts match exactly (`docs/HANDOFF_CURRENT.md` section 2).
- **`npm run verify:originals`: PASSES in its default (local-only) mode**, and the post-sync verification sweep (Gate 3, Section 1e) covers the remote/cloud comparison this script's `--remote` flags are for: 241 photos sampled across 6 shards against the live cloud project, zero mismatches, zero missing objects.

Net: **fully green, top to bottom.** Every item that used to block this done-check (Section 1a lint, Section 1d e2e, Section 1e the real cloud sync) is closed. Re-run the three commands above anytime to reconfirm; none of them have run since this document's most recent edit, so treat this as the last-known-clean snapshot rather than a live guarantee.
