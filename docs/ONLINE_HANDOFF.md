# Rach & Zach gallery: production handoff

Updated 2026-08-05 (PDT).

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
| Latest release | `b7d5b6f` -- face waves 12+13, Brenda Wasserman name chain, green visual gate ([#13](https://github.com/zachringnight/rachandzach-gallery/pull/13), merged 2026-08-05) |
| Known unshipped work | `docs/BACKLOG.md` |
| Face naming tool | `npm run tag` -> <http://127.0.0.1:4310/> (local only, `docs/FACE_TAGGING_TOOL.md`) |

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

That later pass now has a private local tagging surface. Run
`npm run faces:recurring` to build and open the ignored
`metadata/faces/recurring-face-tagger/index.html`. It presents the 13 recurring
groups (31 face instances across 10 photographs), lets Zach open every full
photo with the face boxed, and searches all 189 catalog identities. Selecting
a person shows their committed saved face when one exists; attendees with no
saved face remain selectable. Drafts persist in browser local storage, and
the page exports only cluster decisions—never embeddings or saved-profile
similarity suggestions.

`npm run faces:recurring:apply -- <decisions.json>` is read-only by default.
`--write` validates the exact report fingerprint, recurring membership, roster
identity, photo path, and duplicate-person conflicts before updating the
tracked additive overlay and generated local catalog. Human assignments become
a separate review wave without a fabricated similarity score. This importer
never writes live data; the existing sync command remains a separate explicit
dry-run/`--execute` step with its pre-write backup and live verification.

`scripts/sync-catalog-overlays.mjs` is read-only by default and uses
`--execute` for the narrow additive live sync. It creates missing people only
through the atomic `rachandzach_add_person` RPC, upserts reviewed joins, writes
an ignored local pre-state backup, and verifies the result by re-reading every
page. It never deletes, renames, or changes storage. The application changes
in `codex/expand-saved-face-tags` are not merged or deployed yet; the bounded
live data curation above is complete and verified.

Fresh local verification on that branch:

- focused catalog-overlay and recurring-face workflow coverage passed 14 tests
- Python compilation, the post-sync face audit, and the zero-tag regrouping
  pass completed successfully
- `npm run verify` passed typecheck; lint completed with zero errors and 18
  warnings; Vitest passed 1,045 tests with 17 documented skips;
  production build passed; Chromium end-to-end passed 83 tests with 28
  documented skips
- the private recurring-face tool was inspected at 1440px and 390px: all 13
  clusters, 31 face crops, 10 private previews, the saved-face reference,
  full-photo dialog, local decision state, and JSON export loaded without
  console errors or horizontal overflow
- `git diff --check` passed

### Face pipeline rebuild (2026-08-05)

The three places a confirmed name is supposed to land were checked and all
three were already current before this pass, so no tagging work was lost when
the last session ended:

- local catalog: all 831 reviewed tags present, 0 to add
  (`node scripts/apply-catalog-overlays.mjs`)
- live database: 5,035 `rachandzach_photo_people` rows, all 831 reviewed tags
  present, 0 people and 0 tags pending
  (`node scripts/sync-catalog-overlays.mjs`, read-only)
- master originals: all 487 photos carrying additions already current, 0 to
  write (`python3 scripts/write-additions-to-master.py`, dry run)

Two exported decision files were found unfiled in `~/Downloads`
(`rachandzach-recurring-face-decisions*.json`, 4 and 61 decisions). Both were
verified as already applied: their 53 tag decisions across 50 identities are
all present in the overlay as wave 10. Nothing was orphaned.

Signatures were stale against the human waves 10 and 11, so they were rebuilt.
Resolution improved from 118 of 132 tagged people to **138 of 152**, and the
re-run audit surfaced 18 untagged candidates that no earlier sweep could have
produced, mostly for people who only just earned a profile.

That rebuild also exposed a profile defect. Every face in the learned
`mike-caron` cluster is a woman with a chin-length bob; his committed saved
face is a heavyset man. The cluster was named on thin evidence (support 2,
confidence 0.325, from 4 tagged photos) and it had begun winning the archive's
three highest untagged matches at 0.786, 0.773 and 0.728, which would have put
his name on three photographs of somebody else. Recorded in
`metadata/face-profile-corrections.json`, the same mechanism that held the
Chris/Maura Gutierrez defect. He has no hand-picked crop, so he now carries no
recognition profile at all, which is the intended outcome: no profile beats a
confidently wrong one. The three rows are gone from the audit.

`scripts/export-face-overrides.mjs` had not been re-run since 2026-07-27, so
two live `/admin/faces` decisions existed only in the database. Both are now
committed: `brend-wasserman` renamed to "Brenda Wasserman", and `lauren-kunz`
renamed to "Lauren Lurie" and hidden.

Zach then confirmed all 21 rendered candidates, which landed as **wave 12** and
is the first wave to reverse earlier denials: six of the 21 were his own
rejections from waves 6 and 8, denied against profiles that have since been
rebuilt or, for Danny Listrani, did not exist at the time. The reversals are
listed in the wave's `overturnsEarlierDenials` rather than applied quietly.
The 21 are now in all three destinations: catalog, 20 master originals, and
the live database, which verified at **5,056** `rachandzach_photo_people` rows.

**Automatic matching has converged.** After rebuilding on wave 12, both the
calibrated and the widened audits return **zero** untagged candidates. Every
prominent face that matches a known profile is tagged. Everything left needs a
human to name a face the model has never been shown. Signature resolution
reads 136 of 152 rather than the 138 seen mid-pass; two marginal clusters fell
back below the 1.6x naming lead when the new tags added competing evidence,
which is the guard doing its job, not lost data.

The remaining work is now shaped for one sitting rather than 329 separate
decisions. `npm run faces:recurring -- --report
metadata/faces/unresolved-cluster-review.json` offers **93 same-face clusters
covering 388 faces across 247 photographs**, largest 20 faces, where one name
applies to the whole cluster. The report deliberately drops 29 clusters as too
small or too soft to judge and 3 that hold two faces from one photograph and
therefore are not one person.

One person could not be reached by that queue. The woman whose face trained
the `mike-caron` signature appeared in 5 photographs, and because the pipeline
believed she was Mike Caron she was never offered as unnamed. Zach identified
her from her contact sheet: **Dominique Caron**, his companion, seated guest,
previously zero tagged photographs. Same defect shape as the Gutierrezes: a
couple photographed together where only one identity ever resolved. Her five
tags landed as wave 13 (catalog, masters, live at 5,061 rows), and the next
rebuild did exactly what the correction's own retirement rule predicted:
cluster c0259 now resolves to her, Mike gained his own genuine cluster c0305
(visually verified against his saved thumbnail), and the correction was retired
into the `resolved` list beside the Gutierrez entry. Resolution now reads 138
of 153 tagged people.

That rebuild surfaced two below-default Jeff Rush candidates
(`metadata/faces/review-2026-08-05-b/sheet-001.jpg`, sims 0.615 and 0.483).
They await Zach's eyes; nothing is applied.

### Visual baselines regenerated (2026-08-05)

All 24 stale snapshots (six pages by four projects) were regenerated after
inspecting the rendered pages at desktop and 390px mobile per `AGENTS.md`. The
`home` baseline was the big one: it still showed the retired public marketing
homepage, which the password gate replaced outright. The gate pages and the two
guest pages (12px growth from a shared spacing change) all render as intended.
WebKit 26.5 was installed locally for the webkit and mobile-390 projects.
`npm run verify` is now fully green end to end: typecheck, lint 0 errors,
Vitest 1,101 passed with 17 documented skips, production build, and Chromium
e2e **84 passed** with 28 documented skips, the first fully green gate since
the password-gate release. One caveat worth keeping: with the whole site
gated, `home`, `enter`, `enter-error` and `404` all render essentially the
same screen, so four of the six visual baselines now cover one page.

### The "Brend Wasserman" name chain, resolved (2026-08-05)

The seating chart's truncated spelling had reached the roster, the catalog, the
reviewed additions, and the embedded metadata of 10 originals. Only the live
database was right, because it had been corrected by hand in `/admin/faces`.
All four layers now read "Brenda Wasserman", and the live sync guard that had
been throwing `Live name mismatch` passes.

`scripts/reconcile-clean-master-aliases.py` was the obvious tool and was the
wrong one. It is driven by `_Metadata/photo-manifest.csv`, and **zero manifest
rows carry her name**: hers arrived later through
`write-additions-to-master.py`. It would have reported success having changed
nothing, and worse, its write path rebuilds `PersonInImage` from the manifest,
so aiming it at those photos would have deleted every face-tag name added since
the manifest was built.

`scripts/rename-person-in-master.py` covers that gap: one name at a time,
exact case-insensitive matching rather than a regex that matches "Dan" inside
"Danny", symlinks skipped so the `By Person` and `_Review` farms cannot cause
the same photograph to be written once per link that references it, and
`ImageDataHash` plus dimensions compared before and after so a run that altered
a pixel fails instead of reporting success. It also verifies that no other name
moved. Dry run by default. The run touched 10 files and verified clean.

Two things were deliberately left alone: `seatingName` in the roster, which
records what the chart actually said, and the wave-10 `contextEvidence` prose,
which records the identification as Zach made it at the time.

Verification: Vitest 1,101 passed with 17 documented skips, typecheck clean,
lint 0 errors and 19 existing warnings, production build passed, Chromium
end-to-end 78 passed with 28 documented skips. Six visual snapshots fail, and
they fail identically on a clean `main` with no local changes, so that is
pre-existing baseline drift from the password gate rather than a regression
from this pass. It is written up in `docs/BACKLOG.md` along with a suspected
second profile defect in `jorie-soskin`.

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
| P0 | Rachel | Next session | Name the remaining 329 faces: `npm run tag`, then the post-session commands in `docs/FACE_TAGGING_TOOL.md` (apply overlays, rebuild thumbnails, embed names into the masters). Decisions save as you go and the session resumes if interrupted. |
| P1 | Rachel | Before the supporters wall is announced | The `/nyc` supporters wall is LIVE with 46 real names and their messages. Confirm the list reads the way she wants; `approved: false` in `src/content/nyc.ts` takes it straight back down. |
| DONE | Zach + Codex | 2026-08-05 | The 21 rebuild candidates were confirmed (wave 12), the six stale visual baselines were regenerated after page inspection, and the Brenda Wasserman spelling was remapped across all four layers. `npm run verify` is fully green. |
| P1 | Zach | Two rows | Confirm or deny the two Jeff Rush candidates in `metadata/faces/review-2026-08-05-b/sheet-001.jpg`. Nothing is applied. |
| P1 | Engineer | Next UI pass | Work `docs/BACKLOG.md` "Mobile and touch". The filter panel not closing after a selection is the one that reads as broken on a phone. |
| P2 | Rachel | Any time | Replace two correct-but-unflattering face crops in `/admin/faces`: `charlie-weisman`, `dee-burton`. Admin picks outrank the script. |
| P2 | Engineer | Before wide sharing | No AVIF fallback: the client is AVIF-only by design, so a browser without support gets broken images. See `docs/BACKLOG.md` "Technical debt"; needs a `<picture>` element and a matching serialization change, together. |
| DONE | Zach | 2026-07-26 | Created the Google Web OAuth client ID and Dropbox Saver app key; only the public identifiers were supplied to deployment configuration. |
| DONE | Codex | 2026-07-26 | Confirmed `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` and `NEXT_PUBLIC_DROPBOX_APP_KEY` in Vercel Production and Preview, deployed `main`, and verified the production deployment is `READY`. |
| P0 | Zach/admin | Before announcing cloud save | Complete the two consent-dependent file-transfer rows in the authenticated acceptance pass below using a personal Google Drive and Dropbox account. |
| DONE | Codex | 2026-07-26 | Checked Vercel runtime errors after production smoke traffic; none were returned. |
| DONE | Codex | 2026-07-27 | Reviewed all 151 remaining saved-face suggestions, then exhaustively reviewed all 56 zero-tag photos with detected faces. Applied 146 confirmed links across the two passes and verified all 300 tracked links live with zero pending writes. |
| READY | Zach/admin | Next curation session | Run `npm run faces:recurring`, name any recognizable recurring group once, hold uncertain groups, and download the decisions. The private tool propagates a confirmed identity only to that cluster's represented photos; no rejected or held cluster is auto-applied. |
| P2 | Zach/admin | Later curation session | Revisit the 15 intentionally held-back saved-face comparisons only if a clearer saved profile, photo, or identity becomes available. Reports and contact sheets remain gitignored; no rejected suggestion is auto-applied. |
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
