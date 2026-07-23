# 0719 + co. Handoff: Historical Pre-launch Snapshot

> [!IMPORTANT]
> This document preserves the final pre-launch state from 2026-07-23. It is
> historical, not the current production handoff. For the live domain,
> deployment, DNS, branch, and continuation state, use
> [`docs/ONLINE_HANDOFF.md`](ONLINE_HANDOFF.md) as the single source of truth.

**Historical status at capture: NOT DEPLOYED. Build and data were COMPLETE AND VERIFIED.**

This was the authoritative pre-launch document for the 0719 + co. digital
wedding home. It remains useful for build history, data reconciliation, and
the original launch gates, but it no longer describes the live repository or
deployment state.

**This pass:** final documentation refresh, written after tonight's build and verification session (2026-07-22 into the early hours of 2026-07-23 PT) finished. The numbers below come from that session's own logs, reports, and code on disk, cited inline, plus the final verification transcript in `docs/plans/2026-07-22-0719-digital-wedding-home/reviews/polish-sweep.md`. This pass edited docs only: `docs/HANDOFF_CURRENT.md` (this file), `docs/0719_Content_Needed_v1.md`, `docs/0719_Launch_Checklist_v1.md`, and `README.md`. Nothing else in the repository was touched.

---

## 1. Bottom line

Everything that can be built, synced, and verified without a live domain is done. The full photo catalog is synced to the cloud project with zero failures, and a post-sync verification sweep on top of it came back clean. `npm run verify` is fully green: typecheck, lint, unit tests, production build, and the bounded end-to-end suite. A second wave of features (round two) shipped on top of the original 13-packet plan. Nothing has been deployed, published, committed to git, or emailed to anyone. Every remaining step is a human decision or a deploy-gate action, listed in full in section 9, and that list is exhaustive: nothing else is open anywhere in this project.

---

## 2. Data and media: complete and verified

- **Storage sync: COMPLETE.** 13,532 of 13,532 objects synced to the cloud project (1,721 originals + 11,811 previews), 0 failures. (`metadata/import/gallery-sync-state.json`)
- **Catalog sync: COMPLETE.** 23,885 of 23,885 planned rows upserted, 0 gated photos, 0 failures. (`metadata/import/media-sync-catalog.log`)
- **Post-sync verification sweep: CLEAN.** Sampled 241 photos across 6 shards against the live cloud project. Zero mismatches, zero missing objects.
- **Live database counts, all exact:**
  - 1,721 published photos
  - 11,811 preview rows and objects
  - 132 people
  - 14 events
  - 1,721 Moment Search embeddings (pgvector, pinned CLIP model `openai/clip-vit-base-patch32@3d74acf9a28c`)
- **The Moment Search embeddings backfill hit and fixed a real bug along the way.** PostgREST caps un-ranged responses at 1,000 rows, so the backfill's read of already-embedded photos was silently missing everything past the first page. Fixed in `scripts/build-embeddings.py` with Range-header pagination, 500 rows per page. Confirmed clean: `checkpointed 1721/1721` in `metadata/import/embeddings-run.log`.
- **The legacy static gallery is fully cut over and deleted.** This Next.js app is the only wedding gallery left.

Standard reconciliation commands for this class of check, safe to run anytime to reconfirm against live cloud state (tonight's clean result came from the post-sync verification sweep above, not necessarily this literal invocation):
```bash
npm run verify:catalog -- --db-env-file .env.cloud
npm run verify:originals -- --remote --project-ref rnfvmqflktghriqefatc --allowlist rnfvmqflktghriqefatc --env-file .env.cloud
```

---

## 3. Automated verification: `npm run verify`

```bash
npm run verify
```

Exits 0. Full breakdown, from the final run of the night (`docs/plans/2026-07-22-0719-digital-wedding-home/reviews/polish-sweep.md`):

| Stage | Result |
|---|---|
| `typecheck` (`tsc --noEmit`) | PASS |
| `lint` (`eslint .`) | PASS: 0 errors, 14 warnings, all pre-existing and non-blocking |
| `test` (`vitest run`) | PASS: 817 tests passed, 11 skipped (828 total, 46 files) |
| `verify:build` (`next build`, synthetic env) | PASS |
| bounded e2e (`playwright test tests/e2e --project=chromium`) | PASS: 82 passed, 28 skipped, 0 failed |

The unit-test and e2e skips are both by design: the live-database schema suite and the live-catalog e2e cases, neither of which means anything without a real database session, and both of which announce themselves loudly as skipped rather than silently passing. Zero failures anywhere in the chain.

The one real defect from the last snapshot of this document (an accessibility contrast failure on the empty `/favorites` state) is fixed: `src/components/favorites/FavoritesGallery.tsx` now uses `text-ink` instead of the low-contrast `text-ink/60` utility. Chasing that fix also surfaced and fixed a second, more serious pre-existing bug in the same file: `useFavoriteIds` was returning a fresh array reference on every call, which throws "Maximum update depth exceeded" on first render with zero favorites in a real browser, not only under test. Both are fixed and covered by regression tests.

---

## 4. What's built

All 13 original build packets are done. Full detail: `docs/0719_Architecture_v1.md` (system design) and `docs/plans/2026-07-22-0719-digital-wedding-home/manifest.md` (the original plan). In short: brand and content foundation, the read-only media import pipeline, Supabase schema and storage rules, guest and admin access, the public site and weekend story, gallery discovery and lightbox, My Weekend and Moment Search, resumable guest uploads, downloads/favorites/ZIP/slideshow, moderation and notifications, feature-flagged experience modules (playlists, marathon), and production QA tooling.

---

## 5. Round two: shipped tonight on top of the plan

Full detail and status of every round-two item, shipped and still pending: `docs/0719_Round_Two_Features_v1.md`. Shipped tonight:

- **Face-recognition moderation assist** (admin-only, never guest-facing). A local pipeline builds per-person face signatures from the 1,721 confirmed-tagged photos and proposes tags on new guest uploads in the review screen. A backward audit ran over the whole archive: 8 high-confidence wrong tags and 215 strong missed tags, all awaiting Zach's review, none auto-applied. Full list: `metadata/faces/audit-report.md` (gitignored, local only; face embeddings never leave the machine).
- **Download My Weekend.** One-tap ZIP of every photo a guest is tagged in, from My Weekend, reusing the existing ZIP tray flow. (`src/components/personalization/DownloadMyWeekendButton.tsx`)
- **TV mode at `/tv`.** Full-screen, auto-looping, whole-catalog slideshow for gatherings, with wake lock and an Esc hint. Reachable by URL only for now: adding it to the header nav changes every page's visual e2e baseline, which needs Zach's eyes to re-approve. One-line add, deferred to end review (section 8).
- **Memories wall.** New table (`rachandzach_photo_memories`, migration `202607220006`), applied and live-verified. A guest attaches a short note to a specific photo; it appears once Zach approves it, on the same moderation pipeline as everything else. Renders inside the lightbox on every surface: gallery, My Weekend, Moment Search, and the photo permalink.
- **Favorites v2 server sync.** A guest's hearts now sync server-side (session and person keyed), so they survive a cleared browser.
- **Keyword tag chips.** Visible chips on the photo detail view, deduped against the photo's own confirmed people so a name never shows twice, clickable into Moment Search when that flag is on.
- **Share-sheet save.** A "Save photos" button beside the ZIP download, using the Web Share API to hand full originals into a guest's own iCloud Photos or Files on Apple devices. Google Drive and Dropbox OAuth buttons are built but stay hidden until their client IDs land (section 10).
- **Two Fable copy passes.** A full pages pass (16 strings) and a component micro-pass (10 strings), 26 changed strings total, all de-duplication and truth fixes, zero em dashes, zero invented facts, grep-verified. Full before/after table: `docs/plans/2026-07-22-0719-digital-wedding-home/reviews/fable-copy-pass.md`.

**Cut by Zach, do not build:** the new-photos digest email, and the "shot on film" label. Neither is pending. Both are closed decisions, not open items.

---

## 6. Operational war stories

Two real infrastructure problems came up during the media sync tonight. Both are fixed. Both are worth knowing about if a future sync ever misbehaves the same way.

1. **This network corrupts large HTTPS request bodies.** Any single request body over roughly 1 MB had a real chance of arriving corrupted (TLS `bad_record_mac`, reproduced with both Node's `fetch` and `curl`). Fix: the real upload path now goes through Supabase's resumable TUS protocol in 1 MB chunks, so no single request body ever crosses the threshold, plus a 180-second watchdog (a dead TLS socket can otherwise leave an upload hanging forever with no error at all), plus a dedicated storage hostname (`*.storage.supabase.co` instead of `*.supabase.co`) for the resumable endpoint. See `scripts/sync-gallery-storage.mjs` and `docs/plans/2026-07-22-0719-digital-wedding-home/reviews/media-sync-run.md`.
2. **Supabase's storage tenant connection pool was exhausted twice**, both times by stranded idle-in-transaction connections. `supabase_storage_admin` is a reserved role, so no permanent idle-session timeout could be set on it directly. The zombie-clear SQL playbook used to recover both times lives in session memory and in `docs/plans/2026-07-22-0719-digital-wedding-home/reviews/media-sync-run.md`.

---

## 7. Schema state

6 migrations, 15 tables, applied in filename order:

| Migration | Adds |
|---|---|
| `202607220001_gallery_core.sql` | 12 tables: `events`, `people`, `upload_batches`, `photos`, `photo_people`, `photo_keywords`, `photo_previews`, `upload_items`, `moderation_actions`, `notification_log`, `rate_limit_buckets`, `gallery_events`. |
| `202607220002_storage_policies.sql` | Storage-object overwrite-prevention trigger on the 5 `rachandzach-` buckets. No new table. |
| `202607220003_moment_search.sql` | `rachandzach_photo_embeddings` (pgvector, 512-dim CLIP). |
| `202607220004_rate_limit_conflict_fix.sql` | Corrective fix for a PL/pgSQL ambiguous-column bug in the rate-limit RPC. No new table. |
| `202607220005_guest_favorites.sql` | `rachandzach_guest_favorites` (round two, section 5). |
| `202607220006_photo_memories.sql` | `rachandzach_photo_memories`, the memories wall (round two, section 5). |

Every table carries the `rachandzach_` / `rachandzach-` prefix (shared-project convention), RLS on, zero anon/authenticated policies, grants to `service_role` only.

---

## 8. Zach's end review

Standing rule holds: no agent performs visual review. This is the full agenda for Zach's own pass, in one place.

- [ ] **Visual pass over the live build.** Hero, story photos, gallery, every page, on a real screen.
- [ ] **Hero photo, logo treatment, and copy approval.** Development selections are live now (`src/content/story-photos.ts`, every pick marked `"dev placeholder, pending Zach's visual approval"`).
- [ ] **Fable copy table sign-off.** 26 changed strings across two passes, full before/after and reasoning in `docs/plans/2026-07-22-0719-digital-wedding-home/reviews/fable-copy-pass.md`.
- [ ] **TV-mode nav decision.** Say the word and "TV Mode" joins the header nav (`src/content/site.ts`, one line); the four visual e2e baselines (home, weekend, add-yours, favorites) get regenerated in the same sitting.
- [ ] **Face-audit review.** `metadata/faces/audit-report.md`: 8 high-confidence wrong tags and 215 strong missed tags, sorted by match strength. Nothing here changes a tag until Zach says so.

---

## 9. Remaining deploy gates

This is the complete list. Nothing else is open anywhere in this project. Each gate is its own separate future approval; none of it happens as a side effect of anything in this document.

**Already decided, for the record, no action needed:**
- Shared guest password: `071925`. Real Argon2id hash and a fresh session secret are staged in `.env.cloud` (gitignored).
- Supabase project: existing shared "PrizmLounge" (`rnfvmqflktghriqefatc`, us-west-2), not a new dedicated project.
- Approved guest originals are downloadable, same as photographer originals.
- Photographer credit: Ali Beck Photo, website and Instagram, wired into the footer.
- Bucket retention: covered by three independent copies of the originals (local clean master, Zach's personal Dropbox, Supabase buckets). Only future guest uploads lack an offsite copy; revisit if they accumulate.

### Gate 1: Git repository and remote

```bash
git init
git status                 # confirm .gitignore is excluding node_modules, .next,
                            # .env*, .env.cloud, .venv-search/, .venv-faces/,
                            # metadata/faces/, playwright-report/, test-results/
git add <files>
git commit -m "Initial commit: 0719 + co. digital wedding home"
git remote add origin <new private GitHub repo URL>
git push -u origin main
```
Unlocks `.github/workflows/ci.yml`, already authored, which starts running automatically on pushes to `main`, `staging`, and `preview/**`.

### Gate 2: Vercel project, environment variables, and the auth redirect allow-list

```bash
vercel link                # or import the repo via the Vercel dashboard, framework Next.js
```
Set env vars for Production (real values are staged in `.env.cloud` at the repo root, gitignored; paste them by hand, never commit that file):
```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add GALLERY_PASSWORD_HASH production
vercel env add GALLERY_SESSION_SECRET production
```
Confirm Vercel Authentication (Standard Protection) is on for previews (Project Settings > Deployment Protection).

**At preview time**, the moment the first preview URL exists, add it to Supabase's auth redirect allow-list: Supabase dashboard > Authentication > URL Configuration > Redirect URLs, add `<preview-url>/auth/callback`. The shared project's `site_url` currently points at a different app, so this step has to happen before any admin magic link will work on the new URL.

### Gate 3: Resend domain and guest-facing sends

```bash
# In the Resend dashboard: add domain rachandzach.com, copy the DNS records it emits
# (MX + SPF on send.rachandzach.com, DKIM on resend._domainkey.rachandzach.com,
# optional DMARC p=none on _dmarc.rachandzach.com -- exact values in docs/0719_Launch_Ops_v1.md)
# Send one test email to wedding@rachandzach.com only, then:
vercel env add RESEND_API_KEY production
```
Unblocks real batch and decision notifications. The app runs fine with email disabled until this gate closes.

### Gate 4: Custom domain and DNS cutover (public launch)

```bash
# Lower the current apex/www DNS TTL 24-48 hours ahead of time
# Add the domain in Vercel: Project Settings > Domains > add rachandzach.com
# Point the apex A record and www CNAME per Vercel's shown values
```
Then confirm, in order: SSL issues, the guest gate fails closed, an original download reproduces its source hash, the admin magic link arrives.

---

## 10. Optional post-launch inputs

Not blocking anything above. Pick these up whenever, before or after launch:

- **Google and Dropbox OAuth client IDs.** Unlocks the Save-to-cloud buttons beyond the already-shipped iCloud share-sheet slice (section 5). A one-time developer app registration, not a data destination; photos always go to the guest's own account, never Zach's.
- **Playlist details.** Titles, descriptions, Spotify URLs, event pairings. Unlocks the `playlists` flag.
- **Marathon story and donation URL.** Rachel's story, race/charity name, canonical URL, optional goal. Unlocks the `marathon` flag.

---

## 11. Companion docs

- `docs/0719_Architecture_v1.md` -- system design: stack, data flow, storage buckets, table model, auth, import/sync pipeline, moderation state machine, feature flags
- `docs/0719_Privacy_Operations_v1.md` -- every privacy commitment and exactly how it's enforced
- `docs/0719_Content_Needed_v1.md` -- everything waiting on Zach, plus engineering findings from integration
- `docs/0719_Launch_Checklist_v1.md` -- engineering defects, Zach's approvals, the deploy gate sequence, manual QA
- `docs/0719_Round_Two_Features_v1.md` -- every round-two item, shipped and pending, in full detail
- `docs/0719_Supabase_Decision_v1.md`, `docs/0719_Launch_Ops_v1.md` -- earlier planning briefs, superseded in places by the decisions recorded above
- `docs/plans/2026-07-22-0719-digital-wedding-home/` -- the original build plan, per-packet detail, and every review doc cited above
