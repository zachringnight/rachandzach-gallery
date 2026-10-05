# Rach & Zach gallery: production handoff

Updated 2026-10-05 (PDT).

This is the canonical current-state and continuation document. The site is
live. `docs/HANDOFF_CURRENT.md` and `docs/0719_Launch_Checklist_v1.md` preserve
the pre-launch history and are not operational instructions.

## Release state

| Item | Current state |
|---|---|
| Production | <https://rachandzach.com> |
| GitHub | <https://github.com/zachringnight/rachandzach-gallery> |
| Default branch | `main` |
| Deployed application release | `0f663276dad5b42482dc6baa87af2e922f1f8b69` (PR #32); verified 2026-10-05 before this refresh |
| Premium archive redesign | `ca367e38bab16d2ee72060790e17f54901298ac7` |
| Application feature merge | `4455ba95d15259ef210ebd64f8283bc80fe005da` |
| Feature pull request | [#2](https://github.com/zachringnight/rachandzach-gallery/pull/2), merged 2026-07-24 at 19:54 CDT |
| Vercel | `main` auto-deploys to Production; every other Git branch auto-deploys to Preview; current production status is `READY` |
| Supabase project | `rnfvmqflktghriqefatc` |
| Latest release | PR [#32](https://github.com/zachringnight/rachandzach-gallery/pull/32), merged 2026-08-17 PDT: dependency maintenance, Node type alignment, and removal of the obsolete TV-mode claim. |
| Current production head | `0f66327`, deployment `dpl_7XchtLBiqT78FWPEJ68UeDE7L4yH`, `READY` with apex, `www`, project, and main aliases. Commit and aliases verified 2026-10-05. |
| Known unshipped work | NYC October refresh on `codex/nyc-october-refresh`; draft PR [#33](https://github.com/zachringnight/rachandzach-gallery/pull/33) retained separately pending CI and handoff repair. `docs/BACKLOG.md` is not automatically active scope. |
| Face naming tool | `npm run tag` -> <http://127.0.0.1:4310/> (local only, `docs/FACE_TAGGING_TOOL.md`) |
| Current unmerged face work | None; the 996-tag naming and reconciliation pass merged in [#22](https://github.com/zachringnight/rachandzach-gallery/pull/22), and its live joins plus Joan cleanup were verified before merge |
| Current unmerged app work | NYC snapshot refresh: $8,770.50, 81 donations, October 5 as-of date, cents preserved, existing supporter wall explicitly dated August 17. Verification and release pending. |

Production aliases are active for:

- `rachandzach.com`
- `www.rachandzach.com`
- `rachandzach-gallery.vercel.app`
- `rachandzach-gallery-zach-soskins-projects-95c2533d.vercel.app`
- `rachandzach-gallery-git-main-zach-soskins-projects-95c2533d.vercel.app`

The former continuation branch, `codex/wedding-premium-overhaul`, has been
merged. Do not continue new work from it. Start from `origin/main`.

## October 5 worktree review and NYC refresh

- Keep canonical checkout and `main`. Both local and remote started at `0f66327`;
  no pre-existing tracked or untracked changes needed committing.
- Archive the clean detached handoff checkout at `4cefe66`: moved from
  `.claude/worktrees/github-pr-handoff-docs-ab2205` to
  `/Users/zsoskin/Codex/archives/rachandzach-gallery/2026-10-05/handoff-4cefe66`.
  It has no unique commits, tracked edits, untracked files, or ignored files.
  It remains registered with Git and its local branch is retained, so the
  move is reversible without reconstruction or data loss.
- Keep PR #33 as a separate draft, not merge-ready. Its `pull_request`
  `paths-ignore` would omit the required `npm run verify` check for docs-only
  PRs. Live branch protection still requires that exact check plus `Vercel`.
  Replace workflow-level skipping with an always-reported check before merging.
  Its shortened handoff also needs a current release/evidence record rather
  than only routing to historical documents. No PR #33 changes are included here.
- Refresh only the NYC fundraising information and its display. NYRR's public
  fundraiser was read on October 5: 81 displayed donations total $8,770.50,
  matching the header's $10,000 goal and 88% rounded progress. Its countdown
  reads 2 days, consistent with the existing October 7 deadline. Donations
  include repeat and anonymous gifts and must not be called unique people.
- Preserve Rachel's story, design, race date, donation destination, and the
  existing approved 53-entry supporter wall. The wall's August 17 snapshot is
  dated separately; no new donor identities or messages were republished.
- PASS on the NYC refresh working tree: focused content tests 39/39;
  `npm run verify` with Node 24: Vercel schema, typecheck, lint (0 errors,
  16 existing warnings), 1,163 Vitest passes / 17 documented skips, build,
  ONNX runtime trace, and 48 Chromium passes / 26 documented skips.
  `git diff --check` passed. New browser coverage checks desktop and 390px
  mobile totals, donation semantics, links, no overflow, reload, and JS errors.
  Desktop 1440px and mobile 390px screenshots were inspected in the browser;
  the new amounts fit cleanly, and the NYC page emitted no console errors.
- Existing dependency debt: `npm audit` reports 16 advisories (1 critical,
  12 high, 3 moderate), including installed Next 16.3.1. The dependency lockfile
  is unchanged. Prioritize a separate patched-Next maintenance release;
  advisories were recorded, not repaired by this fundraising content change.
- Release pending on `codex/nyc-october-refresh`. Rollback is a scoped revert
  of this refresh; no migrations, credentials, or media were changed.

## Current release

The production release includes:

- Publicly reachable 1,721-photo gallery and personalized guest routes; admin
  routes remain authenticated
- Event, person, orientation, source, sorting, and text filters
- Shareable current-view URLs; gallery text uses `gallery_q`, while semantic
  Moment Search keeps `q`
- Bounded retries for gallery search and pagination
- Media viewer with adjacent-image preload, keyboard/swipe navigation, and
  quiet photo-first chrome
- Favorites, per-photo sharing, downloads, selection, ZIP export, slideshow,
  and native Apple sharing
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

TV mode is gone and this document listed it as shipped until 2026-08-17.
`src/app/(guest)/tv/` was deleted in `f5731e9` (PR
[#11](https://github.com/zachringnight/rachandzach-gallery/pull/11)), and
`https://rachandzach.com/tv` has 404'd ever since. The in-gallery slideshow is
unaffected and still ships. `docs/HANDOFF_CURRENT.md` still describes TV mode
and an open "TV-mode nav decision"; that file is explicitly historical and was
true when written, so it is left alone. Nothing is pending there.

Photo-overlay labels were removed. The existing photo memories wall remains
complete. `tsconfig.tsbuildinfo` was deleted from source control and
`*.tsbuildinfo` is ignored when TypeScript regenerates its incremental cache.

### Moment Search runtime repair (shipped, 2026-08-12)

Production's generic `/api/search` 500 was traced in a logging-only Preview to
the missing Linux `libonnxruntime.so.1` dependency while importing
`@huggingface/transformers`. PR #28 now traces both the native ONNX binding and
its adjacent shared library into the search function. A second Preview then
showed the model trying to create its default cache below read-only
`/var/task/node_modules`; the current head redirects only Vercel's model cache
to `/tmp/rachandzach-transformers-cache` and disables the inapplicable browser
cache for this Node runtime.

The route logs request, fallback stage, completion, deployment ID, commit SHA,
duration, and embedding/keyword result counts without logging the query. The
exact repair head `f005843645fff6e87c2dd9e5094a2272ab20edd7` was `READY` in Preview as
deployment `dpl_9vxEZidmAsXf74sLjNJMgmHGKyGL`. Direct API checks returned:

- `people dancing`: three results, all `matchType: embedding`, 7.5-second cold
  request
- `sunset portrait`: one `embedding` result
- `champagne toast`: one `embedding` result, 1.5-second warm request

The full local gate passed: Vercel config validation, typecheck, lint with zero
errors and 18 existing warnings, 1,141 Vitest tests with 17 documented skips,
production build, and 46 Chromium tests with 26 documented live-database
skips. PR #28 merged as `7a336d83d34303b102bdd48d54ee626bb18a1c04`.
Production deployment `dpl_H3jTUHyyChavAjpGhAS5PSrCDXpU` was `READY` with the
apex, `www`, project, and `main` aliases attached when the application release
shipped. The current docs-only Production deployment is
`dpl_BLb5YNB7XkJggNsAAwoRM91hs57z`; application code remains `7a336d8`. On `rachandzach.com`, the
homepage returns `200` and `people dancing` returns three explicit
`matchType: embedding` results with nonzero similarities. The post-smoke
Production error-log query returned no runtime errors.

### Moment Search deep-link and fail-soft hardening (shipped, 2026-08-12)

PR #30 merged as `3756ac2e87e633d19fc2e7a6582ed4acca951077`, which was the
Production application head until #31 superseded it on 2026-08-17. Direct
`/photos?q=...` loads, same-route Moment
links, Lightbox keyword navigation, URL-rewrite sync, and encoder import
fail-soft are in that release. A 2026-08-17 production check of
`people dancing` returned embedding matches from `GET /api/search`.

The shipped runtime repair restored semantic API responses, but two lifecycle
paths remained broken. A direct `/photos?q=...` request server-rendered the
Moment disclosure closed and recovered after hydration with React error 418;
a same-route link from `/photos` updated the URL but left the disclosure closed
and never mounted the search. The merged PR normalizes `q` on the
server, passes it through `PhotosPage` -> `GalleryShell` -> `FilterBar` and
`MomentSearch`, and models the mutually exclusive Filters/Moments disclosure
against the current query version. Only `MomentSearch` remounts when that query
changes, so unrelated gallery-control state is not discarded. Review also
found that a keyword link opened results behind a preserved gallery Lightbox;
the Link now clears that viewer state without racing its route transition
against `history.back()`. A subsequent Codex review found that native gallery
filter URL rewrites could remove `q` while leaving the original server seed in
memory; the shell now derives its hydrated Moment query from Next's reactive
search-param store, so Link, replace-state, and back/forward navigation share
one current value.

The branch also moves evaluation of `query-embedding` inside the existing
embedding fallback boundary. A native encoder import failure therefore cannot
bypass validation or turn an otherwise usable keyword search into a generic
500. The ONNX trace is platform/architecture-specific, the local Transformers
model cache is excluded, Node is pinned to the deployed `24.x` major, and a
post-build assertion now checks that the native binding and adjacent shared
library are present without bundling a local model.

Safe-point verification was green before merge. PR #30's review-fix head
passed GitHub `npm run verify` and produced a `READY` Vercel Preview, then
merged. Production `dpl_AX5fzRcTa1ZuUaN6Gc7gkQb9Skko` is `READY` on that
commit.

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
- At the time of this release, the Vercel branch guard correctly selected
  `main` for build. The custom guard was retired on 2026-08-10 so every pull
  request now receives a runnable Preview deployment.
- No Vercel runtime errors were returned during the 2026-07-26 production
  checks
- An authenticated live-browser check selected an original and reached the
  Google Drive consent handoff and Dropbox folder handoff with no console
  errors; no personal cloud account was entered or modified during this check

Production smoke results from 2026-07-25:

| Request | Expected and observed |
|---|---|
| `/` | `200` |
| `/enter` | `200` -- the sign-in page, removed 2026-08-09; this row is history |
| `/nyc` | `200` |
| `/marathon` | `308` to `/nyc` |
| `/photos?gallery_q=weekend` | `307` to the password gate with the full filtered URL preserved in `next` -- now a plain `200`, gate removed |
| `/api/gallery` without a guest session | `401` JSON -- now `200`, gate removed |

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
metadata/faces/unresolved-cluster-review.json` offers **91 same-face clusters
covering 381 faces across 244 photographs**, largest 20 faces, where one name
applies to the whole cluster. The report deliberately drops 29 clusters as too
small or too soft to judge and 3 that hold two faces from one photograph and
therefore are not one person. (These are the generated report's own summary
numbers; an earlier revision of this section overstated them.)

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
Zach reviewed them 2026-08-07: the after-party face (0.483) is confirmed and
applied as wave 14; the cocktail-hour face (0.615, behind sunglasses) he could
not call, so it stays undecided and unapplied.

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

### The naming evening (2026-08-05)

The browser tagger was the wrong instrument and was replaced mid-session. It
asks one face at a time; an evening of it produced 107 single-face decisions.
Rendering the same queue as numbered contact sheets, answered in batches as
plain text, produced **90 stacks and 264 faces** in about the same time. The
sheets are now the documented first choice (`docs/FACE_TAGGING_TOOL.md`); the
tagger remains for faces that need their surrounding photograph to answer.

What made the sheets work is not the format but what they print beside each
face: **who is already tagged in that stack's photographs**. Unresolved stacks
exist precisely because no saved profile matched, so the model has no
suggestion to offer, but "standing beside two Myerses" is usually enough for a
human. The sheets now show only stacks nobody has named, and carry the list of
seated guests who appear in no photograph, because those two sets are largely
the same people. Chris Bishop, Lauren Wasmuth's husband, moved from the second
list to the first that way, gaining 5 photographs and his first face profile.

Ambiguity is resolved by measurement before it is ever handed back. A first
name matching several guests is settled by scoring the stack against each
candidate's saved profile and by co-occurrence, which decided 7 of 11 outright
(Emily Myers at 0.93, Alex Kamins at 0.91 while Alex Dubov sat in the same
frame at 0.06). Only genuinely undecidable ones go back to a person.

`scripts/face/deduce-unmatched-tags.mjs` came out of this session: it reads
names a human already put on a photograph and asks which face they belong to.
Where exactly one name and one face are unmatched, the face is that person by
elimination, no model similarity involved. It found **87 such photographs** and
is the only route to a first face for three guests the recognition side cannot
find at all. It writes nothing; the candidates await review.

Also corrected: six display names that existed only in `/admin/faces` and had
never reached the local catalog, the tagger roster, or the photographs' own
embedded metadata (Elizabeth Adame, Emily Cronin-Stillman, Maddie Lurie, Maura
Keith-Gutierrez, Pat Burton, Ron Harris). Guests already saw the right names,
because the overrides table wins at render time; everything underneath
disagreed, including the metadata that outlives this site. The live base rows
still retain their legacy names, while the saved overrides are the approved
guest-facing names. `sync-catalog-overlays.mjs` now validates that effective
name instead of incorrectly rejecting a correct override.

**One incident worth recording.** The first version of
`scripts/face/merge-person.mjs` wrote a column that does not exist (`status`
instead of `confidence`), ignored the resulting error, and deleted the old
rows anyway, destroying three live tags. It was caught by the script's own
verification step (`joan-auwerter now has 0 rows`) and all three were
restored within minutes; the table is back to its expected count. The lesson
is in the code now: ordering the insert before the delete was never the
protection, checking that the insert landed is, and the merge refuses to
delete anything until it has confirmed the replacement row exists.

The production-safe continuation is now a separate dry-run-first command:
`npm run faces:merge:live -- <old-slug> <canonical-slug>`. It only accepts a
merge already recorded in `metadata/person-merges.json`, snapshots the exact
people/tags/overrides/favorites/memories state, copies and reads back every
target reference before deleting its source reference, and uses the existing
row-locking removal RPC to retire the empty duplicate. `--execute` is required
for writes; rerunning without it is the final idempotent readback.

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

### Clear-stack naming continuation (2026-08-10)

Rachel confirmed eight identities from the clearer multi-view stack sheets,
covering **38 faces**: Nick Willey (10), Tom Myers (9), Allison Vega (6), Tim
Jackowski (3), Lauren Lurie (3), Ann Marie Hoppler (3), Nita Myers (2), and
Din Rush (2). Context was used to rank candidates, never to auto-tag them.
Two candidate-specific rejections remain attached to stable stack IDs while
the faces stay open: original sheet #2 / `c0300` is not Marc Soskin, and
original sheet #4 / `c0192` is not Shirley Soskin.

The refreshed Rachel-facing queue now has **16 clear stacks covering 95 open
faces** on two sheets. Nine more stacks covering 19 faces are held out because
they have no clear representative; `--include-blurry` remains an explicit
long-tail option. Current tracked state is 996 reviewed additions across 548
photos and two reviewed removals.

All 25 originals that were still missing one of those confirmed embedded names
were updated metadata-only. The follow-up safety pass verified every affected
`ImageDataHash` and dimension before accepting the new container sizes into
the manifest. Recoverable manifest backups are in the clean master's
`_Metadata/backups/` directory, including
`photo-manifest.before-size-sync-20260810T153134Z.csv`.

Clean rebuilds now reproduce the same identity layer instead of resurrecting
stale records: `metadata/person-merges.json` durably records Joan Soskin ->
Joan AuWerter, the six approved display-name overrides are applied before the
attendance/tag overlays, and `verify:catalog` compares the master plus those
tracked decisions to the generated catalog. The gate passes at 1,721 photos,
14 events, and 188 people with zero hash/count drift.

The sampled originals verifier previously compared the metadata-edited local
JPEG container against the older cloud object's whole-file SHA and size, which
made 35 of 100 healthy samples look corrupt. Its local side now recomputes the
stable `ImageDataHash` and dimensions; whole-file SHA/size remain the cloud
object check. The same deterministic sample passes **100/100** after the fix.

Final branch verification: `npm run verify` passed with typecheck clean; lint
at 0 errors / 20 existing warnings; Vitest 84 passed and 2 skipped files,
1,149 passed and 17 skipped tests; the production build passed; and Chromium
end-to-end finished 84 passed / 28 skipped. `git diff --check`, the catalog
gate, the 100-photo originals sample, Python compilation, and the focused
70-test metadata/reconciliation set also passed.

The authorized live sync then applied and read back all 27 pending reviewed
joins. Production now has all **996/996 reviewed tags** with zero pending. Joan
Soskin's only live row overlapped a photo already confirmed for Joan AuWerter,
so the safe merge removed one duplicate join, preserved Joan AuWerter's three
photos, migrated/checkpointed the independent favorite and memory namespaces
(both had zero source rows), and atomically retired `joan-soskin`. Final live
readback: **188 people, 87 overrides, 1,721 photos, 5,126 photo-person rows,
zero pending joins, and zero pending person merges**. Recoverable pre-write
snapshots are ignored under `metadata/faces/sync-backups/`, including the
2026-08-10 catalog-overlay and Joan-merge snapshots.

### In-gallery people tagging (shipped, 2026-08-10)

The admin catalog now offers **Tag people** on every grid card and table row.
It opens the selected photograph at viewing size beside a searchable guest
list, shows the current names as removable chips, and saves only the exact add
and remove deltas through the existing protected `PATCH /api/admin/catalog`
route. It does not expose a public or guest-authorized write path, replace the
complete join set, add a browser-side service credential, or require a schema
change. Approved display-name overrides are used in the picker, so Joan
AuWerter and the other admin name corrections do not regress to base catalog
names.

Focused component and API coverage passes with 14 tests. The interaction was
also checked without saving against the live read-only catalog at 1440px and
390px: search receives focus, the background becomes inert, Escape closes and
returns focus to the originating button, the dialog has no horizontal
overflow, and Axe reports no serious or critical violations. PR #23's exact
head (`c046492`) passed GitHub CI and produced a real `READY` Vercel Preview,
then merged as `f4f1090`. That merge is `READY` and `PROMOTED` in Production
with the apex, `www`, project, and `main` aliases attached. The homepage,
`/photos`, and `/api/gallery?limit=1` returned `200`; `/admin/catalog`
retained its Production redirect; all public story images returned the new
one-year immutable cache policy; and the post-smoke runtime error scan was
empty. Post-merge `main` CI run
[31423978638](https://github.com/zachringnight/rachandzach-gallery/actions/runs/31423978638)
passed the full gate against `f4f1090`.

### TEMPORARY: Preview is unauthenticated (2026-07-26)

**The Preview environment currently has no access control at all, and it talks
to the live database.**

Two changes, both deliberate and both Zach's call, made to get the guest
manager usable while magic-link sign-in is broken:

1. `OPEN_ACCESS=1` is set on the Vercel **Preview** environment. It returns a
   synthetic administrator from `requireAdmin()`. See
   `src/lib/auth/open-access.ts`. (It also used to bypass the guest password;
   that half became a no-op on 2026-08-09 when the password was removed from
   every environment. The admin bypass is the whole of it now, which makes
   this flag MORE dangerous than it was, not less.)
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

- [x] Add the gallery URLs to Supabase → Authentication → Redirect URLs
      (`https://rachandzach.com/auth/callback`, the `www` variant,
      `https://rachandzach-gallery.vercel.app/**`, `http://localhost:4319/**`).
      Done 2026-08-17. Site URL is still `https://www.nothingbutbet.com` and
      was not changed. Team-scoped Vercel previews were already covered by
      `https://*-zach-soskins-projects-95c2533d.vercel.app/**`. Dashboard
      "send magic link" still defaults to Site URL; use
      `scripts/preview-magic-link.mjs` with an explicit gallery origin, or
      pass `redirect_to` to `/auth/callback`.
- [ ] Remove the `OPEN_ACCESS` variable from Vercel Preview and delete
      `src/lib/auth/open-access.ts` along with its three call sites.
- [ ] Re-enable `ssoProtection` (`all_except_custom_domains`).

## Next actions

| Priority | Owner | Target | Action and definition of done |
|---|---|---|---|
| P0 | Rachel | Next session | Name the 16 clear stacks covering 95 faces in `metadata/faces/stack-sheets/`; then run the post-session commands in `docs/FACE_TAGGING_TOOL.md`. Nine stacks / 19 faces with no clear view remain held out unless `--include-blurry` is chosen deliberately. |
| DONE | Zach + Codex | 2026-08-10 | Applied and verified the 27 live reviewed joins, then safely merged Joan Soskin into Joan AuWerter. The final read-only plans report 996/996 tags present and zero pending joins or merges. |
| P1 | Rachel | Before the supporters wall is announced | The `/nyc` supporters wall is LIVE with 53 real names and their messages as of 2026-08-17 ($5,182 of $10,000). Confirm the list reads the way she wants; `approved: false` in `src/content/nyc.ts` takes it straight back down. |
| OPEN | Zach | Review and merge | [#32](https://github.com/zachringnight/rachandzach-gallery/pull/32): dependency refresh (19 in-range, plus `@types/node` 26 and `jsdom` 30), exiftool failures now report their reason in `write-additions-to-master.py`, and seven tests that drive the #31 session refresh through `proxy()` itself. TypeScript 7 and ESLint 10 are held with reasons in `docs/BACKLOG.md`. |
| DONE | Zach + Cursor | 2026-08-17 | Admin session refresh, landing Moment Search, NYC totals, and master-writer `--write` gates merged in [#31](https://github.com/zachringnight/rachandzach-gallery/pull/31) and are live on Production `4cefe66`. The proxy now requires a live Supabase user for `/admin` rather than a cookie whose name matches. |
| DONE | Codex | 2026-08-12 | Moment Search deep-link and fail-soft hardening merged in [#30](https://github.com/zachringnight/rachandzach-gallery/pull/30) and was live on Production `3756ac2` until #31 superseded it. |
| DONE | Zach + Codex | 2026-08-05 | The 21 rebuild candidates were confirmed (wave 12), the six stale visual baselines were regenerated after page inspection, and the Brenda Wasserman spelling was remapped across all four layers. `npm run verify` is fully green. |
| DONE (half) | Zach | 2026-08-07 | Of the two Jeff Rush candidates in `metadata/faces/review-2026-08-05-b/sheet-001.jpg`, Zach confirmed the after-party face (sim 0.483). Applied as wave 14 to all four layers: additions manifest, catalog, the original's embedded metadata, and the live database (single-row upsert with pre-state backup, because the full sync is blocked; see the P1 name-drift row). The cocktail-hour face (sim 0.615, behind sunglasses) stays undecided and unapplied. |
| DONE | Codex | 2026-08-08 | The six "live-name drifts" turned out to be the opposite of a drift: those names are `/admin/faces` corrections, which belong only in `rachandzach_person_overrides` and are applied over the catalog name at the data-source boundary. Something had copied them down into `rachandzach_people.display_name` between 2026-08-05T22:32Z and 2026-08-06T02:43Z, collapsing the two layers and tripping the sync guard. Restored the six base names to canonical (backup in `metadata/faces/sync-backups/`); no guest-visible name changed, since every override was verified present first. `write-additions-to-master.py` now resolves names through `person-overrides.json`, so it stopped wanting to put a second name for the same person into 29 originals; the one genuine pending write (a Joan Soskin tag) was applied and manifest-reconciled. The junk `"pa"` entry and the stale `By Person/pa` symlink folder are gone. Both guards pass; live sits at 5,100 tag rows. See `docs/BACKLOG.md` "Resolved 2026-08-08". |
| DONE | Codex | 2026-08-17 | Gallery callback URLs added to the shared project's Auth Redirect URLs. Site URL left on `nothingbutbet.com`. `OPEN_ACCESS` and `ssoProtection` left as-is. |
| P1 | Zach | After this deploys | Flip through `/photos` on a phone: filter a person, watch the chip row, scroll down and back up (chapter tab and Light Bar should step aside and return), favorite from a card, download from the viewer. The grid only renders against the live database, so this pass shipped on unit tests plus the data-free visual suite; this is the eyeball check that closes it. |
| P2 | Rachel | Any time | Replace two correct-but-unflattering face crops in `/admin/faces`: `charlie-weisman`, `dee-burton`. Admin picks outrank the script. |
| DONE | Codex | 2026-08-05 | AVIF fallback shipped in [#15](https://github.com/zachringnight/rachandzach-gallery/pull/15): `preview-format.ts` orders previews most-compatible-first, `serialize.ts` signs a decodable companion per AVIF width, and `PhotoImage` renders `<picture>` so browsers negotiate natively. This row previously still read as open work and would have sent an engineer to rebuild it. |
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

- [ ] Open `/photos` directly (no password since 2026-08-09) and confirm it
      renders for a browser with no cookies at all
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

`main` auto-deploys to Vercel Production. Every other Git branch auto-deploys
to Vercel Preview, and every pull request runs the full GitHub CI gate. GitHub
protects `main` with strict required checks for `npm run verify` and `Vercel`,
so neither a missing CI run nor a missing Preview can silently merge. Confirm
that a green Vercel check points to a `READY` deployment for the exact commit;
an ignored or canceled deployment is not a test build.

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
