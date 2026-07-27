# Rach & Zach gallery: production handoff

Updated 2026-07-27 (PDT).

This is the canonical current-state and continuation document. The site is
live. `docs/HANDOFF_CURRENT.md` and `docs/0719_Launch_Checklist_v1.md` preserve
the pre-launch history and are not operational instructions.

## Release state

| Item | Current state |
|---|---|
| Production | <https://rachandzach.com> |
| GitHub | <https://github.com/zachringnight/rachandzach-gallery> |
| Default branch | `main` |
| Deployed application release | `4fdb61baa9c5427458ed688111417befe6d19d5d` |
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
- The Vercel production deployment containing application release `4fdb61b`
  is `READY`; use
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

On 2026-07-26 the additive `rachandzach_person_overrides` table was applied to
the live project (migration `20260726101500_rachandzach_person_overrides.sql`;
RLS on, zero policies, per-object revokes, service-role only). It backs the
`/admin/faces` guest manager: hand-picked Find me face crops, display-name
corrections, soft hiding from guest pickers, and admin-added people. No
existing table, policy, function, or bucket was altered, and the table was
left empty after verification. The export round trip back to committed source
is `scripts/export-face-overrides.mjs` followed by
`scripts/build-face-thumbnails.mjs` (see each script's header).

Later on 2026-07-26, admin-added people were upgraded to full catalog
identities. "Add a person" on `/admin/faces` now creates a real
`rachandzach_people` row (catalog first, override second), so added people
can be tagged from `/admin/catalog` and the review screens, appear in Find
me, and own a working `/{slug}` personalized page. The DML-only backfill
migration `20260726180000_rachandzach_added_people_catalog_backfill.sql` was
applied to the live project (a no-op there: the overrides table held zero
rows). Remove semantics: pipeline-matched people are only ever soft-hidden. An added
person is deleted outright only while **nothing durable references the
identity**, which means BOTH zero `rachandzach_photo_people` rows and zero
person-keyed `rachandzach_guest_favorites` rows; if either exists the removal
degrades to the same soft hide. The favorites condition matters because
favorites key on `(owner_kind = "person", owner_key = slug)` independently of
photo tags, so deleting the catalog row would strand a guest's shortlist.

Creation is atomic too: `rachandzach_add_person(p_slug, p_display_name,
p_actor)`, added by `20260726233000_rachandzach_add_person.sql` and **applied
to the live project**, writes the catalog row and the override row in one
transaction. The previous sequence -- catalog insert, override insert, then an
unconditional compensating delete in a separate transaction -- could destroy a
tag committed inside that window via the foreign key cascade, which was
reproduced against the live database before the fix. No client-side delete of
`rachandzach_people` remains in either path.

The removal decision is made atomically inside
`rachandzach_remove_added_person(p_slug)`, added by
`20260726213000_rachandzach_remove_added_person.sql`, which **was applied to
the live project** (additive: one `rachandzach_` function, pinned
`search_path`, per-object revokes, `service_role`-only execute). The RPC takes
the catalog row `FOR UPDATE` before checking, so a tag committed concurrently
can no longer be destroyed by the foreign key cascade -- the previous
check-then-delete pair could and did, reproducibly, destroy one. No
client-side delete of `rachandzach_people` remains. Because the UI cannot see
server-side favorites, the confirm dialog states both possible outcomes rather
than one certainty; the server outcome is always one of the two.

The `overrideOnly` guest-surface flag was removed along with the suppressed
personalized-route link. A guest whose saved Find me person no longer resolves
is treated as holding a stale preference and is returned to the picker, since
hidden people deliberately remain resolvable and absence is therefore
unambiguous.

### Seating roster and saved-face curation (2026-07-27)

The final seating chart is now the attendance authority. Its 183 unique seated
guests resolve to 126 existing catalog identities (including five explicit
name aliases) plus 57 newly added identities. The live catalog now contains
189 people in total because six pre-existing catalog identities are not rows
in the seating chart. The 57 added attendees intentionally have zero photos
until a tag is confirmed; they remain real, taggable identities rather than
placeholder labels.

Only attendee names were retained in
`metadata/wedding-attendees.json`. Table, seat, meal, note, contact, and other
seating-workbook fields were not copied into the repository. Rebuilds apply
that tracked roster through `scripts/lib/catalog-overlays.mjs`, and
`scripts/apply-catalog-overlays.mjs` checks the current generated catalog by
default (`--write` is explicit).

The previous face update did persist correctly. Before this curation pass, the
live override table and `src/generated/person-overrides.json` agreed on 23
hand-picked face crops, zero renames, and one hidden identity. Those 23 crops
are anchors in addition to 108 learned signatures, so the audit uses 131 saved
face profiles—not 23.

The first three side-by-side visual review waves examined every current
saved-face suggestion against the committed profile and the detected face in
a local derivative. The third wave checked all 151 candidates that remained:
136 were confirmed and 15 were held back as mismatches or genuinely ambiguous
faces.

A fourth exhaustive pass then covered the separate zero-tag blind spot. Before
applying anything, 241 photos had no people tags; 56 of those contained 245
detected faces. Every full photo was reviewed, all 138 clustering-eligible
faces were compared with all 131 saved profiles, and repeated detections were
sorted into 120 same-face clusters. Thirteen clusters repeated across photos,
covering 31 face detections. Eight identities were visually confirmed in one
wide reception photo. Janice Harstad and Abe Burton were confirmed only after
matching their face, outfit, and same-day context against already-tagged
photos. The other 128 profile comparisons were held back because they were
mismatches, duplicate-person detections, unknown recurring guests, or too
distant, blurred, occluded, or back-facing to name safely.

Across all four waves, 300 confirmed links are tracked in
`metadata/reviewed-face-tag-additions.json`. The live joins were added as
`manual` / `confirmed`, then re-read: the live project has 4,545
`rachandzach_photo_people` rows, all 300 reviewed links are present, and a
second dry run has zero pending people or tags. After those additions, 238
photos remain entirely untagged; 53 contain 208 detected faces, including 118
clustering-eligible faces. The same 13 recurring unknown clusters remain
privately sorted for a later identification pass. Reports and review sheets
stay gitignored under `metadata/faces/`; wedding originals were never opened
for this fourth pass and were not changed.

`scripts/sync-catalog-overlays.mjs` is read-only by default and uses
`--execute` for the narrow additive live sync. It creates missing people only
through the atomic `rachandzach_add_person` RPC, upserts reviewed joins, writes
an ignored local pre-state backup, and verifies the result by re-reading every
page. It never deletes, renames, or changes storage. The application changes
in `codex/expand-saved-face-tags` are not merged or deployed yet; the bounded
live data curation above is complete and verified.

Fresh local verification on that branch:

- focused catalog-overlay coverage passed 6 tests
- Python compilation, the post-sync face audit, and the zero-tag regrouping
  pass completed successfully
- `npm run verify` passed typecheck; lint completed with zero errors and 18
  warnings; Vitest passed 1,037 tests with 17 documented skips;
  production build passed; Chromium end-to-end passed 83 tests with 28
  documented skips
- `git diff --check` passed

### TEMPORARY: Preview is unauthenticated (2026-07-26)

**The Preview environment currently has no access control at all, and it talks
to the live database.**

Two changes, both deliberate and both Zach's call, made to get the guest
manager usable while magic-link sign-in is broken:

1. `OPEN_ACCESS=1` is set on the Vercel **Preview** environment. It bypasses
   the guest password (`src/proxy.ts`, `requireGalleryAccess`) and returns a
   synthetic administrator from `requireAdmin()`. See
   `src/lib/auth/open-access.ts`.
2. Vercel **Deployment Protection (`ssoProtection`) was disabled** for the
   project so Rachel could open the preview without a Vercel account.

**Exposure while this stands:** anyone with a preview URL can read all 1,721
photographs, the guest face crops, every guest name and each person's
`/{slug}` page, and can *write* -- renaming, hiding and removing guests and
moderating uploads -- against the **live Supabase project**, not a copy.

Production is protected by construction: `isOpenAccess()` also requires
`VERCEL_ENV !== "production"`, so setting the variable there has no effect.
That is enforced in code, not by convention.

**Retirement, required before this is considered finished:**

- [ ] Add the gallery URLs to Supabase → Authentication → Redirect URLs
      (`https://rachandzach.com/auth/callback`, the `www` variant, the preview
      origin, `http://localhost:4319/auth/callback`). No gallery URL is
      currently listed, which is *why* magic links land on the unrelated NWSL
      project. **Do not change Site URL** -- it belongs to that other product.
- [ ] Remove the `OPEN_ACCESS` variable from Vercel Preview and delete
      `src/lib/auth/open-access.ts` along with its three call sites.
- [ ] Re-enable `ssoProtection` (`all_except_custom_domains`).

## Next actions

| Priority | Owner | Target | Action and definition of done |
|---|---|---|---|
| DONE | Zach | 2026-07-26 | Created the Google Web OAuth client ID and Dropbox Saver app key; only the public identifiers were supplied to deployment configuration. |
| DONE | Codex | 2026-07-26 | Confirmed `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` and `NEXT_PUBLIC_DROPBOX_APP_KEY` in Vercel Production and Preview, deployed `main`, and verified the production deployment is `READY`. |
| P0 | Zach/admin | Before announcing cloud save | Complete the two consent-dependent file-transfer rows in the authenticated acceptance pass below using a personal Google Drive and Dropbox account. |
| DONE | Codex | 2026-07-26 | Checked Vercel runtime errors after production smoke traffic; none were returned. |
| DONE | Codex | 2026-07-27 | Reviewed all 151 remaining saved-face suggestions, then exhaustively reviewed all 56 zero-tag photos with detected faces. Applied 146 confirmed links across the two passes and verified all 300 tracked links live with zero pending writes. |
| P2 | Zach/admin | Later curation session | Revisit the 15 intentionally held-back saved-face comparisons and the 13 privately sorted recurring unknown-face clusters only if a clearer saved profile, photo, or identity becomes available. Reports and contact sheets remain gitignored; no rejected suggestion is auto-applied. |
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
