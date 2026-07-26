# Rach & Zach gallery: production handoff

Updated 2026-07-26 (PDT).

This is the canonical current-state and continuation document. The site is
live. `docs/HANDOFF_CURRENT.md` and `docs/0719_Launch_Checklist_v1.md` preserve
the pre-launch history and are not operational instructions.

## Release state

| Item | Current state |
|---|---|
| Production | <https://rachandzach.com> |
| GitHub | <https://github.com/zachringnight/rachandzach-gallery> |
| Default branch | `main` |
| Current production head | `4fdb61baa9c5427458ed688111417befe6d19d5d` |
| Premium archive redesign | `ca367e38bab16d2ee72060790e17f54901298ac7` |
| Application feature merge | `4455ba95d15259ef210ebd64f8283bc80fe005da` |
| Feature pull request | [#2](https://github.com/zachringnight/rachandzach-gallery/pull/2), merged 2026-07-24 at 19:54 CDT |
| Vercel | `main` auto-deploys to target `production`; current status is `READY` |
| Supabase project | `rnfvmqflktghriqefatc` |

Production aliases are active for:

- `rachandzach.com`
- `www.rachandzach.com`
- `rachandzach-gallery.vercel.app`
- `rachandzach-gallery-zach-soskins-projects-95c2533d.vercel.app`
- `rachandzach-gallery-git-main-zach-soskins-projects-95c2533d.vercel.app`

The former continuation branch, `codex/wedding-premium-overhaul`, has been
merged. Do not continue new work from it. Start from `origin/main`.

## Current release

The production release includes:

- Password-gated 1,721-photo gallery and personalized guest routes
- Event, person, orientation, source, sorting, and text filters
- Shareable current-view URLs; gallery text uses `gallery_q`, while semantic
  Moment Search keeps `q`
- Bounded retries for gallery search and pagination
- Media viewer with adjacent-image preload, keyboard/swipe navigation, and
  quiet photo-first chrome
- Favorites, per-photo sharing, downloads, selection, ZIP export, slideshow,
  TV mode, and native Apple sharing
- Guest uploads, moderation, and durable approved uploader-note captions
- Admin catalog table, search, filters, bulk selection, tagging, and viewer
- Public Rachel Runs NYC story, Team for Kids context, and donation links at
  `/nyc`; `/marathon` redirects there
- Active Google Drive and Dropbox save controls; each guest authorizes and
  saves to their own cloud account
- Premium warm-neutral, photo-first archive design with direct paths to Find
  me, search, favorites, original saves, and guest uploads
- Forward-looking archive and Rachel Runs NYC content; the public weekend recap
  was removed and `/weekend` now redirects to `/photos`

Photo-overlay labels were removed. The existing photo memories wall remains
complete. `tsconfig.tsbuildinfo` was deleted from source control and
`*.tsbuildinfo` is ignored when TypeScript regenerates its incremental cache.

## Verification evidence

The redesigned release was verified on `main` before deployment:

- `npm run verify`: typecheck passed; lint passed with 0 errors and 14 existing
  warnings; Vitest passed 947 tests with 11 live-database skips; production
  build passed; Chromium end-to-end passed 80 tests with 28 documented skips
- The focused accessibility suite passed 13 checks with 3 documented
  live-data skips
- The visual suite passed in Chromium, WebKit, tablet, and 390px mobile
  configurations
- Pull request #2 checks passed
- Final GitHub Codex review found no major issues
- Post-merge `main` CI
  [run 30137350273](https://github.com/zachringnight/rachandzach-gallery/actions/runs/30137350273)
  passed against `4455ba95d15259ef210ebd64f8283bc80fe005da`
- The Vercel production deployment for `4fdb61b` is `READY`; use
  `npx vercel inspect https://rachandzach.com` for its current immutable ID
- The Vercel branch guard is present in the deployment bundle and correctly
  selected `main` for build
- No Vercel runtime errors were returned during the 2026-07-26 production
  checks
- An authenticated live-browser check selected an original and reached the
  Google Drive consent handoff and Dropbox folder handoff with no console
  errors; no personal cloud account was entered or modified during this check

Production smoke results from 2026-07-25:

| Request | Expected and observed |
|---|---|
| `/` | `200` |
| `/enter` | `200` |
| `/nyc` | `200` |
| `/marathon` | `308` to `/nyc` |
| `/photos?gallery_q=weekend` | `307` to the password gate with the full filtered URL preserved in `next` |
| `/api/gallery` without a guest session | `401` JSON |

Supabase migrations added by this release are checked in and applied:

- `20260724123508_rachandzach_approved_upload_captions.sql`
- `20260724124851_rachandzach_photo_processing_gate.sql`

All wedding tables retain RLS and service-role-only access. The linked Supabase
project is shared with other products; 32 non-wedding public tables currently
have RLS disabled. That is a cross-application project concern, not a wedding
release blocker. Do not change those unrelated tables without tracing their
owners, readers, and writers.

## Next actions

| Priority | Owner | Target | Action and definition of done |
|---|---|---|---|
| DONE | Zach | 2026-07-26 | Created the Google Web OAuth client ID and Dropbox Saver app key; only the public identifiers were supplied to deployment configuration. |
| DONE | Codex | 2026-07-26 | Confirmed `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` and `NEXT_PUBLIC_DROPBOX_APP_KEY` in Vercel Production and Preview, deployed `main`, and verified the production deployment is `READY`. |
| P0 | Zach/admin | Before announcing cloud save | Complete the two consent-dependent file-transfer rows in the authenticated acceptance pass below using a personal Google Drive and Dropbox account. |
| DONE | Codex | 2026-07-26 | Checked Vercel runtime errors after production smoke traffic; none were returned. |
| P2 | Zach | Later curation session | Review the local-only face audit before applying any proposed tag changes. The report remains gitignored and no suggestion is auto-applied. |
| P2 | Engineer | Future maintenance | Add a live-database integration harness to replace the intentional schema/catalog skips when repeatable production-like DB testing becomes worthwhile. |
| DONE | Codex | 2026-07-25 | Removed the merged `codex/wedding-premium-overhaul` exception from the CI and Vercel branch allowlists after confirming it had no commits outside `main`. |
| P2 | Zach plus shared-project owners | Future infrastructure decision | Decide whether the wedding app should remain in the shared Supabase project. Any isolation or RLS cleanup requires a cross-app migration plan. |

Google Drive and Dropbox activation is complete in application configuration.
Both public identifiers are present in Vercel Production and Preview, and both
controls render and prepare a selected original on the live domain. Final
file-transfer acceptance remains consent-dependent: an authenticated guest
must sign in to each personal provider account and approve the save.

## Provider activation

### Google Drive

1. Enable the Google Drive API in the selected Google Cloud project.
2. Create an OAuth client of type Web application.
3. Add `https://rachandzach.com`, `https://www.rachandzach.com`, and
   `http://localhost:3000` as authorized JavaScript origins.
4. Store the client ID as `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` in Vercel
   Production and Preview.

The app requests only `https://www.googleapis.com/auth/drive.file`. It
downloads each selected signed original in the browser and uploads it through
a bounded resumable Drive session.

Official setup references:

- <https://developers.google.com/identity/oauth2/web/guides/use-token-model>
- <https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow#creatingcred>
- <https://developers.google.com/workspace/drive/api/guides/manage-uploads>

### Dropbox

1. Create a Dropbox Saver app.
2. Allow `rachandzach.com`, `www.rachandzach.com`, and `localhost`.
3. Store its public app key as `NEXT_PUBLIC_DROPBOX_APP_KEY` in Vercel
   Production and Preview.

Dropbox Saver accepts at most 100 files per invocation. The product blocks
larger selections before signing URLs and asks the guest to narrow the set.

Official setup reference:

- <https://www.dropbox.com/developers/saver>

After either Vercel environment change, redeploy the latest `main`; existing
deployments do not receive new build-time `NEXT_PUBLIC_*` values.

## Authenticated acceptance pass

Run these checks on `https://rachandzach.com`:

- [ ] Enter through the guest password gate and open `/photos`
- [ ] Apply text plus event/person filters, choose **Copy current view**, paste
      the URL in a new tab, and confirm the same filtered result survives
- [ ] Run a semantic Moment Search and confirm its query does not overwrite
      the gallery's `gallery_q`
- [ ] Open the media viewer; verify previous/next, keyboard, swipe, favorite,
      download, and share actions
- [ ] Select multiple photos; verify ZIP and native Apple share where supported
- [ ] Save one photo and a two-photo selection to Google Drive
- [ ] Save one photo and a selection of at most 100 photos to Dropbox
- [ ] Upload a small image with an uploader note, approve it in admin, and
      confirm the approved note appears as the published caption
- [ ] Confirm rejected or still-pending uploads never appear in guest results
- [ ] Open `/nyc` and verify the fundraiser and donation destinations

Stop and roll back the provider variable if its control becomes visible but
cannot complete a single-photo save. Do not work around a failure by exposing a
client secret or making storage public.

## Resume safely

```bash
git fetch origin --prune
git switch main
git merge --ff-only origin/main
git switch -c codex/<task-name>
npm ci
npm run verify
```

`main`, `staging`, and `preview/**` run CI/Vercel builds. Ordinary `codex/*`
branches are skipped by those remote build guards. Use a
`preview/<task-name>` branch when a new protected Vercel preview and GitHub CI
run are required.

For production checks:

```bash
gh run list --branch main --limit 3
npx vercel inspect https://rachandzach.com
curl --fail --silent --show-error --location \
  --output /dev/null --write-out '%{http_code}\n' https://rachandzach.com
```

The clean-master and read-only Supabase reconciliation procedures remain in
`docs/HANDOFF_CURRENT.md` and
`docs/plans/2026-07-22-0719-digital-wedding-home/workflows/wedding-home-post-sync-verify.js`.
