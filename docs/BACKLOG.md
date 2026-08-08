# Backlog

Known, deliberately unshipped work. Everything here was found by a real audit
or review and verified against the code, not speculation. Each item says what
is wrong, why it matters, and where to look.

Last updated 2026-08-05, after the face-pipeline rebuild pass. The release
context is still the guest-experience and performance release (`f5731e9`) plus
the site-wide password gate (`4f3bd22`).

## Mobile and touch

These came out of a guest-UX audit of the whole `(guest)` surface. Most guests
open this from a text message on a phone, and many are older relatives.

**All five shipped 2026-08-05** in the guest-UX mobile pass, along with the
whole "Guest journey" section below. What each became:

| Item | Resolution |
|---|---|
| Filter panel never closed after a selection | Closes on a `person`/`event` change (including clearing one); stays open for orientation, source, and sort refinements. One handler in `FilterBar.tsx` owns the policy. |
| Active-filter chips hidden below 720px | First chip shows at `max-width: 45vw`, the rest collapse to a non-interactive "+N". Desktop pixel-identical. |
| Tap targets under 44px | On coarse pointers the card keeps one thumb-sized action (Favorite, 44px); per-card Download is viewer-only, where the control is also now 44px, as are the lightbox controls and arrows. |
| No guest-scoped `not-found` | `src/app/(guest)/not-found.tsx`: guest header preserved, primary link to Find me, secondary to the archive. Unit-tested; it cannot be visually snapshotted because `[personSlug]` needs the live database before it can 404. |
| Sticky chrome eats ~25% of a phone viewport | Below 720px the chapter tab and Light Bar fade out while scrolling down and return on the first upward gesture (`useHideOnScrollDown`, opacity-only so the virtualized grid's offset math is untouched). |

The one caveat: the gallery grid renders only against the live database, so
the phone-width chrome and chip changes shipped on unit tests plus the green
visual suite of the data-free pages, and were eyeballed on production after
deploy rather than in a local harness.

## Guest journey (shipped 2026-08-05, same pass)

| Item | Resolution |
|---|---|
| Sign-in landed on the full archive | `DEFAULT_DESTINATION` is `/my-weekend` in both the enter page and the login route; sanitized `?next=` deep links still win, so shared URLs are unaffected. |
| The download button wall | One Download and one Save regardless of count; the signing loop was already sequential per 50 under the hood, so the wall was pure UI. Multi-batch runs read "Preparing 2 of 4" on the one button. The orphaned `weekend-download-batches` module is deleted. |
| Lightbox keyword chips deep-linked somewhere that hid the result | Chips point at `/photos?q=…`, and plain `q` was added to the photos page's `GRID_PARAM_KEYS` so the deep link actually mounts the grid and runs Moment Search instead of stopping at the browse landing. |
| `PersonPicker` announced the wrong purpose on Find me | The Find me variant says "Choose your name" / "Find your name"; the gallery filter variant keeps "Filter by person" / "People". |

## Technical debt

| Item | Where | Why it matters |
|---|---|---|
| ~~No AVIF fallback~~ **RESOLVED 2026-08-05** | `serialize.ts` + `PhotoImage.tsx`, in lockstep | `serialize.ts` signs one universally-decodable companion per AVIF width (nearest width, same-width JPEG beats a distant WebP) and `PhotoImage` renders `<picture>` with an AVIF source and that companion as the img, so the browser negotiates natively. AVIF-capable browsers fetch the same bytes as before, so the 2400-tier egress saving holds; the cost is one extra signed URL per width decision, still inside the signing batch limits. Preview arrays now sort most-compatible-first within a width (shared `preview-format.ts` contract, moment-search included), so naive `previews[0]` consumers decode everywhere. One loose end: the Lightbox preload still warms the AVIF URL on browsers that will render the fallback; harmless extra bytes on legacy browsers only, and `pickFallback` is exported when someone wants it. |
| ~~Six design screenshots at repo root~~ **RESOLVED 2026-08-05** | deleted | One-off comparison artifacts nothing referenced; they remain in git history if ever wanted. |
| `force-dynamic` on 28 routes | Everywhere | Audited and mostly **correct**: the cost is inside the render, not the mode, and most routes embed per-guest signed URLs so they genuinely cannot be cached. Listed so nobody re-audits it. The one clear candidate, `[personSlug]`'s sequential queries, was parallelised 2026-08-05: the exact-slug path now dispatches the person lookup and a speculative override lookup together, and only a miss pays for the catalog scan. |
| ~~No field instrumentation~~ **RESOLVED 2026-08-05** | `src/app/layout.tsx` | `@vercel/analytics` and `@vercel/speed-insights` mount in the root layout. First-party under `/_vercel/*`, so the CSP needed no change; both no-op outside Vercel deployments. Data appears in the Vercel dashboard once real guests browse. |

## Found 2026-08-05, in the face pipeline pass

| Item | Where | Why it matters |
|---|---|---|
| ~~`main` fails its own visual gate~~ **RESOLVED 2026-08-05** | `tests/e2e/visual.spec.ts-snapshots/` | All 24 stale baselines (six pages by four projects) were regenerated after inspecting the rendered pages at desktop and 390px mobile. The old `home` baseline still showed the retired public marketing homepage. `npm run verify` is fully green again. Note for later: with the whole site gated, `home`, `enter`, `enter-error` and `404` all render essentially the same screen, so four of six visual baselines now cover one page. |
| ~~"Brend Wasserman" is truncated in 10 originals~~ **RESOLVED 2026-08-05** | see `docs/ONLINE_HANDOFF.md` | All four layers now read "Brenda Wasserman" and the live sync guard passes. Fixed with the new `scripts/rename-person-in-master.py`, not the existing alias reconciler, which could not see her name and would have destroyed later face tags if pointed at those photos. |
| **`jorie-soskin`'s signature may be two people** | `metadata/faces/signatures.json`, clusters `c0070` and `c0090` | `c0070` is 81 faces at confidence 0.696 and is plainly one man across the archive. `c0090` is 18 faces at 0.453 and its sample faces do not obviously look like him. 113 catalog tags ride on this slug, so if the second cluster is somebody else it is the highest-leverage remaining profile defect. Not acted on: the `c0090` samples are too blurred for a confident call, and no tag has been applied from it. Render the two clusters side by side and have a human look. |

## Resolved 2026-08-08: the six "name drifts" were a layering bug

Recorded here because the first diagnosis was wrong and the wrong fix was
half-applied before the evidence turned up.

Six people read differently live than in the tracked files: `elizabeth-licon`
"Elizabeth Adame", `patrick-burton` "Pat Burton", `emily-stillman`
"Emily Cronin-Stillman", `ronald-harris` "Ron Harris", `maura-keith-gutierrez`
"Maura Keith-Gutierrez", `maddie-chaness` "Maddie Lurie". That looked like the
Brenda Wasserman defect (live is truth, drag every other layer to it), and
`sync-catalog-overlays.mjs` failing its name guard seemed to confirm it.

It was the opposite. Those names are **admin corrections**, and they are
supposed to live in exactly one place: `rachandzach_person_overrides`, applied
over the catalog name at the data-source boundary
(`src/lib/gallery/supabase-source.ts`), exported to
`src/generated/person-overrides.json`. `/admin/faces` writes the override table
and nothing else, by design. The catalog keeps the canonical name; the override
supplies what guests read. Both layers were correct.

What was actually broken: between 2026-08-05T22:32Z and 2026-08-06T02:43Z
something copied the six override names down into
`rachandzach_people.display_name` itself. The sync backups in
`metadata/faces/sync-backups/` date it precisely, since every run snapshots
those rows. That collapsed the two layers into one, which is what tripped the
guard, and it was quietly destructive: with the canonical name overwritten,
removing an override would have left the person stuck on the corrected name
instead of reverting. The writer was not identified; no committed script
updates that column, so it was most likely an ad-hoc query in the wave-13
session.

Fixed by restoring the six `display_name` values to canonical (backup:
`metadata/faces/sync-backups/2026-08-08T14-07-13-597Z-people-display-name-restore-before.json`).
No guest-visible name changed: all six overrides were verified present first,
so the site renders exactly what it did before. Both guards pass, and the live
sync is caught up at 5,100 tag rows.

| Item | Where | Why it matters |
|---|---|---|
| ~~`write-additions-to-master.py` embedded the wrong name~~ **RESOLVED 2026-08-08** | `scripts/write-additions-to-master.py` | It wrote each addition's canonical `displayName`, so its dry run wanted to add "Patrick Burton" to 29 originals that already said "Pat Burton": one man, two names, in his own photographs, and since the pass only ever unions, nothing would have removed the second. It now resolves names through `person-overrides.json` first, embedding what guests see. The dry run went from 29 spurious writes to 1 genuine one (a Joan Soskin tag), which was applied and manifest-reconciled. |
| ~~Stray `"pa"` PersonInImage tag~~ **RESOLVED 2026-08-08** | `09 Reception/rachelzach-692.jpg` | Junk truncation deleted from the original (pixels and dimensions verified unchanged), and the stale `By Person/pa` symlink folder it had generated was removed. `rename-person-in-master.py` grew a `--delete` mode for this shape of junk. Note `pa` is still in the override `hidden` list, which is now redundant but harmless. |
## Found 2026-08-08, in a three-part audit (scripts/data, app/config, docs/tests)

Everything here was verified by reading the code, and the fixed rows were
verified again by reproducing the failure first. Fixed in this pass:

| Item | Where | Resolution |
|---|---|---|
| ~~Catalog pages fetched with no total order~~ | `src/lib/gallery/supabase-source.ts:204` | `.range()` paged the 1,721 photos 1000 at a time with no `ORDER BY`. Postgres guarantees no row order across separate LIMIT/OFFSET statements, so page two could repeat rows page one already returned and skip others: photos silently missing from `/photos`, person counts drifting, nondeterministically and per request. Now ordered by `id`. |
| ~~`normalize-clean-master-metadata.py` would have deleted 974 names~~ | that script | It replaces `PersonInImage` from `photo-manifest.csv` but never read `PersonInImage`, and `write-additions-to-master.py` has since embedded reviewed face-tag names that the manifest does not carry. The verification pass could not catch it, because it checks the written values against the same manifest. Re-running it today would have deleted **974 names across 544 originals**. It now reads the field it overwrites and aborts rather than dropping a name, and it is dry-run by default like its siblings. The new guard is what produced those numbers. |
| ~~Guest uploads could report success and never arrive~~ | `src/app/api/uploads/batches/[batchId]/submit/route.ts` | The `status: "submitted"` write discarded its error, so a failed write still returned 200; the guest saw a receipt and the batch stayed a draft that never reached `/admin/review`. `getUploadStatus` returning null also serialized as a 200 with a null body. Both now throw, and the update is guarded on the current status so a double submit is a no-op. |
| ~~Field instrumentation was default-denied~~ | `src/lib/auth/guest-session.ts` | `/_vercel/*` was in neither the proxy matcher exclusion nor the public allowlist, so an anonymous visitor to `/nyc` fetched the analytics script and got a 307 to `/enter`. The instrumentation added in #15 recorded nothing on the one public page whose traffic is the point. Now a public prefix. |
| ~~`/favicon.ico` cost three queries per request~~ | `src/app/(guest)/[personSlug]/page.tsx` | No favicon exists, so browsers' automatic request fell through to the person catch-all: exact lookup, speculative override lookup, then a full 189-row scan, on essentially every navigation. Slugs are `[a-z0-9-]+`, so anything with a dot now returns null before touching the database. The site still has no icon; that is a design decision, not a bug. |
| ~~A failed status recompute rejected a successful approval~~ | `src/app/api/admin/batches/[batchId]/approve/route.ts:197` | Every per-item action is already committed by that line, so a transient failure told the admin the approval failed when all its photos were live, inviting a re-run. Caught, like the notification below it. |
| ~~`FilterBar` chip label read a stale facet~~ | `src/components/gallery/FilterBar.tsx:141` | `useMemo` read `facets.identities` without depending on it, so a newly hidden person's active-filter chip kept rendering the raw slug instead of their name. This was the one lint warning with a real bug behind it; lint is now 16 warnings, all noise. |
| ~~`signed-previews.ts` signed and reported different TTLs~~ | `src/lib/gallery/signed-previews.ts` | `previewExpiresAt` clamped to the 60-second floor while the signing call got the raw value, so a caller passing 10 got URLs dead in ten seconds and a promise they were good for sixty, and the renewal timer fired long after every tile had 403'd. One `resolveTtlSeconds` now feeds both. Its docstring also claimed a 60-minute default against an 8-hour constant. The module had no tests; it now has ten. |

**Not fixed, in rough priority order.** These are real and verified, but each
needs a decision or more room than an audit-fix pass should take.

| Item | Where | Why it matters |
|---|---|---|
| **Admin is locked out roughly an hour after each magic link** | `src/lib/supabase/server.ts:29-38`, `src/proxy.ts:71-80` | The cookie writer swallows writes, saying "session refresh is handled by middleware", but the proxy only regex-matches the auth cookie's *name* and never calls `supabase.auth.getUser()`. Nothing persists rotated tokens, so the refresh happens and its cookies are discarded; the next load replays a consumed refresh token and `requireAdmin()` 401s. Only a fresh magic link recovers. Needs a real refresh path, which is a design call. |
| **Signed-URL renewal fails permanently and silently** | `src/components/gallery/GalleryShell.tsx:457-474`, `:731-745` | One renewal timer, keyed on `[expiresAt, photos, filters]`. A single failed or thrown `/api/gallery` call returns without applying, so no state changes, the effect never re-runs, and there is no retry and no message. When the 8-hour TTL lapses the whole grid goes blank until a reload. |
| **Open access collapses every visitor onto one identity** | `src/lib/auth/guest-session.ts:312-320` | The fixed `sessionId: "open-access"` is the favorites/memories owner key, so on a preview deploy visitor B sees A's favorites and a replace-semantics PUT deletes A's rows in the live database. Non-production only, but it writes production data. |
| **Nothing tests the one line keeping the site private** | `src/lib/auth/open-access.ts:30` | `OPEN_ACCESS === "1" && VERCEL_ENV !== "production"` has zero test references anywhere. Deleting the `VERCEL_ENV` clause is a fully green build and a fully public archive. The login route (`src/app/api/access/login/route.ts`, 156 lines) likewise has no test; its pieces are covered, the composition is not. |
| **`sync-gallery-catalog.mjs` resume state lies in three ways** | `:213-215`+`:289`, `:132-135`+`:396`, `:504-507`+`:302` | `skippedExisting` is counted and then ignored, so a resumed run re-upserts everything it reported skipping; the preview half of the storage gate checks only that a record exists, not its hash, and a stale record writes `bytes: 0`; and a batch that fails verification is still recorded as catalog-complete, so the rerun treats unverified rows as verified. |
| **The naming tool's three-file write is not transactional** | `scripts/lib/naming-decisions.mjs:274-282` | On a failure of the second or third write the catch restores memory from a snapshot, but the first file is already on disk. Rachel is told "nothing was changed" while an addition is persisted; the next successful save writes the rolled-back memory over it, deleting a tag that really was stored. |
| **Three more master writers have no dry-run gate** | `apply-contact-name-matches.py:239`, `reconcile-clean-master-aliases.py:151`, `prepare-clean-master.py:354,393` | Same footgun just closed in `normalize-clean-master-metadata.py`, and `apply-contact-name-matches.py` has the same destructive `PersonInImage` replacement. The alias reconciler additionally unlinks symlinks, rmdirs directories, and rewrites the master's README in the same ungated run. |
| **`write-additions-to-master.py`'s MISSING FILE branch is unreachable** | `:71-72` vs `:143-147` | `read_current()` raises on any nonzero exiftool exit, and exiftool exits 1 when a file is missing, so a moved original aborts the whole run with raw stderr instead of the intended per-file report. |
| **Untested paths with the largest blast radius** | see `tests/` | The three live `describe.skipIf` suites are the only proof of add/remove-person atomicity and of RLS actually denying the anon key, and all are skipped without database credentials, so the FK-cascade regression that once destroyed a committed face tag is currently uncatchable. Moderation visibility (a rejected upload surfacing) is proven only against fixtures, never over HTTP. Every admin write route is untested at the route layer. |
| **Docs that are wrong rather than merely stale** | `README.md:127`, `:7`, `:86-91`; `AGENTS.md:84`, `:114-123`; `docs/ONLINE_HANDOFF.md:22`, `:316-321`, `:437` | README says "nothing in this repo ever writes to" the master, which three scripts do and `AGENTS.md:49-64` explicitly permits; README and the AGENTS code map still describe a public marketing homepage that the password gate made unreachable; the handoff's release state stops at #13 and its cluster counts (93/388/247) contradict the generated report (91/381/244); the AGENTS per-change command list omits `verify:vercel`, which `npm run verify` runs first. Two "Next actions" also point at gitignored paths that exist only on this Mac. |

## Waiting on a person, not an engineer

**Automatic matching is finished.** As of 2026-08-05 both audits return zero
untagged candidates, so nothing below is waiting on the model. Every remaining
name needs somebody who recognizes the face.

- **Rachel or Zach, highest leverage**: name the 91 same-face clusters.
  `npm run faces:recurring -- --report metadata/faces/unresolved-cluster-review.json`.
  One name applies to the whole cluster: 91 decisions reach 381 faces across
  244 photographs, and the largest single cluster is 20 faces. Export the
  decisions, then `npm run faces:recurring:apply -- <file>` (read-only first,
  `--write` after). Prefer this over `npm run tag`: it is roughly a quarter the
  decisions for the same archive.
- **Rachel**: name the remaining 329 individual faces (`npm run tag`, see
  `docs/FACE_TAGGING_TOOL.md`), then run the post-session commands in that doc.
  Do this after the clusters, since naming a cluster removes faces from it. The
  signature rebuilds did not shrink this queue and cannot: it is built from the
  tracked unresolved/partial crop CSVs plus the catalog, never from the model.
- ~~Identify the woman in `metadata/faces/mystery-woman.jpg`~~ **DONE
  2026-08-05**: she is Dominique Caron. Her five tags are wave 13, the rebuild
  separated the couple's profiles, and the `mike-caron` correction retired
  itself. See `metadata/face-profile-corrections.json`.
- **Zach, one row left**: of the two Jeff Rush candidates in
  `metadata/faces/review-2026-08-05-b/sheet-001.jpg`, the after-party face
  (sim 0.483) was confirmed 2026-08-07 and applied as wave 14 to all four
  layers. The cocktail-hour face (sim 0.615, behind sunglasses) could not be
  called and stays undecided; revisit only if a clearer rendering helps.
- **Rachel**: two face crops are correct but unflattering and worth replacing in `/admin/faces`, which outranks anything the script picks: `charlie-weisman` (mid-sentence) and `dee-burton` (another woman shares the frame).
- **Zach**: optional, drop a screenshot at `public/nyc/instagram-post.jpg` to fill the Instagram card on `/nyc`. It degrades to type-only without one, so nothing is broken.
