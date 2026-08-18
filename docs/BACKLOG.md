# Backlog

Known, deliberately unshipped work. Everything here was found by a real audit
or review and verified against the code, not speculation. Each item says what
is wrong, why it matters, and where to look.

Last updated 2026-08-17. Production application release `4cefe66` (PR #31) is
public. Nothing is held back on a branch: the admin cookie refresh, landing
Moment Search, NYC totals, and archive-writer gates all shipped in it.

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
| Lightbox keyword chips deep-linked somewhere that hid the result | Shipped in [#30](https://github.com/zachringnight/rachandzach-gallery/pull/30). Direct `/photos?q=` loads, same-route links, and Lightbox keyword navigation open and run Moment Search. |
| `PersonPicker` announced the wrong purpose on Find me | The Find me variant says "Choose your name" / "Find your name"; the gallery filter variant keeps "Filter by person" / "People". |

## Technical debt

| Item | Where | Why it matters |
|---|---|---|
| ~~Unit suite flaky under load~~ **FIXED 2026-08-06** | `vitest.config.ts` | Three consecutive runs on a busy machine failed 1, 2 and 11 tests, every failure a timeout, every one passing alone, across five unrelated files in both the node and jsdom projects. So it was not one bad test: the suite had outgrown vitest's 5-second default. `testTimeout` and `hookTimeout` are now 20s in both projects, far above what a loaded machine needs and far below what a genuine hang costs. Verified by running the full suite three times against eight CPU spinners: 1,139 passed each time. |
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
| ~~**Admin is locked out roughly an hour after each magic link**~~ **SHIPPED 2026-08-17 (#31), end-to-end sign-in still unconfirmed** | `src/lib/supabase/server.ts`, `src/proxy.ts`, `src/lib/auth/supabase-auth-refresh.ts` | The proxy calls `getUser()` and writes rotated cookies back, and gallery callback URLs are on the shared project's allowlist as of 2026-08-17. What is proven is the code path: a live user reaches `/admin`, a rotation survives both the admin route and the guest-cookie mint, and an unreachable auth service fails closed on `/admin` and soft on guest routes (`tests/auth/route-protection.test.ts`). What is not proven is a real magic link followed by an hour of admin use; that needs Zach's own session. `OPEN_ACCESS` is still Preview-only until someone chooses to retire it. |
| ~~**Signed-URL renewal fails permanently and silently**~~ **RESOLVED 2026-08-08 (#19)** | `src/components/gallery/GalleryShell.tsx:457-474`, `:731-745` | One renewal timer, keyed on `[expiresAt, photos, filters]`. A single failed or thrown `/api/gallery` call returns without applying, so no state changes, the effect never re-runs, and there is no retry and no message. When the 8-hour TTL lapses the whole grid goes blank until a reload. **Fixed:** the renewal now reports success, and a failure backs off 15s doubling to a 5-minute cap and keeps retrying. |
| ~~**Open access collapsed every visitor onto one identity**~~ **RESOLVED 2026-08-09** | former guest-session bypass | Guest routes are intentionally public and now issue normal per-browser guest sessions for favorites and uploads. `OPEN_ACCESS` no longer supplies the guest identity; its remaining Preview-only admin bypass is the separate temporary risk documented in `ONLINE_HANDOFF.md`. |
| ~~**Nothing tested the one line keeping the site private**~~ **RESOLVED / SUPERSEDED 2026-08-09** | `src/lib/auth/open-access.ts` | The guest site is intentionally public, the retired access-login route is gone, and the remaining Preview-only admin guard has explicit production-denial coverage. The current admin-session refresh defect is tracked separately above. |
| ~~**`sync-gallery-catalog.mjs` resume state lies in three ways**~~ **SHIPPED 2026-08-17 (#31)** | that script | Checkpointed photos are skipped on resume; preview records with empty hash or `bytes: 0` fail the storage gate; a verify-counts failure no longer records the batch as catalog-complete. |
| ~~**The naming tool's three-file write is not transactional**~~ **SHIPPED 2026-08-17 (#31)** | `scripts/lib/naming-decisions.mjs` | The three decision files are staged, then renamed as a set; a later failure restores the pre-write bytes. |
| ~~**Three more master writers have no dry-run gate**~~ **SHIPPED 2026-08-17 (#31)** | `apply-contact-name-matches.py`, `reconcile-clean-master-aliases.py`, `prepare-clean-master.py` | Each now defaults to dry-run; `--write` is required before any metadata, symlink, or clean-master output is touched. |
| ~~**`write-additions-to-master.py`'s MISSING FILE branch is unreachable**~~ **SHIPPED 2026-08-17 (#31)** | that script | A missing original no longer aborts the whole read; remaining files continue and the missing path is reported per file. |
| **Untested paths with the largest blast radius** | see `tests/` | The three live `describe.skipIf` suites are the only proof of add/remove-person atomicity and of RLS actually denying the anon key, and all are skipped without database credentials, so the FK-cascade regression that once destroyed a committed face tag is currently uncatchable. Moderation visibility (a rejected upload surfacing) is proven only against fixtures, never over HTTP. Every admin write route is untested at the route layer. |
| **Docs that are wrong rather than merely stale** | `README.md:127`, `:7`, `:86-91`; `AGENTS.md:84`, `:114-123`; `docs/ONLINE_HANDOFF.md:22`, `:316-321`, `:437` | README says "nothing in this repo ever writes to" the master, which three scripts do and `AGENTS.md:49-64` explicitly permits; README and the AGENTS code map still describe a public marketing homepage that the password gate made unreachable; the handoff's release state stops at #13 and its cluster counts (93/388/247) contradict the generated report (91/381/244); the AGENTS per-change command list omits `verify:vercel`, which `npm run verify` runs first. Two "Next actions" also point at gitignored paths that exist only on this Mac. |

## Dependency holds, found 2026-08-17 in a full upgrade pass

Nineteen of the twenty-three outdated packages moved to current inside their
existing semver ranges (Next 16.2.9 -> 16.3.1, React 19.2.7 -> 19.2.8,
`@supabase/supabase-js` 2.110.8 -> 2.112.3, Playwright 1.61.1 -> 1.62.1, and
the rest), and `@types/node` 24 -> 26 plus `jsdom` 29 -> 30 were taken as
majors. `npm run verify` is green on all of it. Two majors were attempted and
put back, for reasons that are external to this repository. All of it is in [#32](https://github.com/zachringnight/rachandzach-gallery/pull/32).

| Item | Where | Why it matters |
|---|---|---|
| **TypeScript 7.0.2 held at 5.9.3** | `package.json` | `typescript-eslint@8.67.0`, the newest published version, declares `peerDependencies.typescript: ">=4.8.4 <6.1.0"`. TypeScript 7 is outside that range, so taking it means linting with an unsupported combination. Revisit when typescript-eslint ships TS 7 support. Nothing in the app needs a TS 7 feature. |
| **ESLint 10.8.1 held at 9.39.5** | `package.json` | Attempted and reverted. `eslint-config-next` bundles an `eslint-plugin-react` that calls `contextOrFilename.getFilename`, removed in ESLint 10, so `eslint .` dies loading `react/display-name` with a `TypeError` before it lints anything. Revisit when `eslint-config-next` ships a plugin set built for ESLint 10. |

**A trap this pass walked into, worth knowing about.** `npm run verify | tail`
reports `tail`'s exit code, not npm's. When ESLint 10 crashed, the chain
stopped at `lint` and the piped command still looked like a pass. Read the end
of the output, or run `npm run verify` unpiped, before believing a green run.

## Known advisories with no upstream fix (2026-08-17)

`npm audit` reports 4 high-severity findings, both roots transitive under
`@huggingface/transformers@4.2.0`, the Moment Search encoder. npm reports "No
fix available" for both: there is no newer version to take.

| Item | Where | Why it matters |
|---|---|---|
| **sharp <0.35.0 inherits four libvips CVEs** | `@huggingface/transformers@4.2.0 -> sharp@0.34.5` | The application's own `sharp` is already 0.35.3, and Next 16.3.1 dedupes onto it; only the encoder's nested copy is affected. The candidate fix is an npm `overrides` entry pinning `sharp` to `^0.35.3` so the nested copy dedupes too. It is not applied here because that package's native stack (ONNX runtime, libvips) already caused two production Moment Search outages (#28), and nothing local exercises it: it needs a Preview deploy and a live `GET /api/search` before it can be trusted. |
| **adm-zip 0.5.18, crafted ZIP triggers a 4GB allocation** | `@huggingface/transformers -> onnxruntime-node@1.24.3 -> adm-zip` | No fix published. Reachable only where onnxruntime-node unpacks its own model archive, from an archive the runtime fetches rather than one a guest supplies, so there is no guest-reachable path to it. Watch for an onnxruntime-node release that moves off adm-zip. |

## Waiting on a person, not an engineer

**These paths are local-only.** `metadata/faces/` is gitignored, so the review
sheets and cluster reports named below exist on Zach's Mac and nowhere else. In
a fresh clone they must be regenerated before any of this is runnable.

**Automatic matching is finished.** Both audits converge to nothing new at the
calibrated thresholds, so nothing below is waiting on the model. Every
remaining name needs somebody who recognizes the face. Each naming round does
feed the next: rebuilding signatures on the evening of 2026-08-05 took
resolution from 136 to 142 of 155 tagged people and surfaced 6 fresh
candidates in the widened sweep, rendered to
`metadata/faces/review-2026-08-06/`.

**Use the contact sheets, not the browser tagger.** See
`docs/FACE_TAGGING_TOOL.md`. On 2026-08-05 the sheets named 90 stacks and 264
faces in one evening; a browser session of similar length managed 107
single-face decisions. Answers are called out as plain text and applied in
batches with validation.

- **Rachel or Zach, highest leverage**: name the remaining **33 nameless
  stacks, 152 faces**, on 3 contact sheets in `metadata/faces/stack-sheets/`
  (re-render any time with `node scripts/face/render-stack-sheets.mjs`). The
  sheets carry a suggestion per stack drawn from who is already tagged in the
  same photographs, plus the list of **32 seated guests who still appear in no
  photograph** across the header. Those two lists are largely the same people:
  Chris Bishop came off the second list by naming a stack on the first.
- **Zach**: confirm or deny the 6 candidates in
  `metadata/faces/review-2026-08-06/sheet-001.jpg`, surfaced by the rebuild
  after the evening's naming. One is Chris Bishop, who had no profile at all
  until tonight.
- **Zach**: `node scripts/face/deduce-unmatched-tags.mjs` found **87
  photographs** where a name a human already applied has exactly one unmatched
  face left, so the face is that person by elimination. Worth a review pass:
  it is the only route to a first face for Lisa Caplan, Max Gordichuk and
  Maura Keith-Gutierrez, none of whom the recognition side can find today. Not
  applied, because for a person who already has a profile, being left over
  means their own profile disagreed with the deduction.
- **Rachel**: the individual-face queue behind `npm run tag` is the long tail
  and should come last. It is built from the tracked crop CSVs plus the
  catalog, so signature rebuilds never shrink it.
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

## Found 2026-08-10, in the visual review pass

Full findings and what shipped: `docs/DESIGN_REVIEW_2026-08-10.md`. Only the
unresolved items are repeated here.

| Item | Where | Why it matters |
|---|---|---|
| **"Sneak Peek" is a 2-photo chapter** at the same card weight as "Reception" (224) | the catalog, surfaced on the `/photos` landing | A two-photo chapter is noise at that card size, and there are two more small ones (Ceremony Details 27, Reception Details 39). Not a CSS fix: shrinking or reordering the card was rejected because chapter order carries meaning and dimming a photograph in a photo archive is the wrong instrument. The fix is to merge or retire the chapter in the catalog, which is a content decision. **Zach's call.** |
| **Several Find me face crops are not faces** | `metadata/faces/`, surfaced on `/my-weekend` | Backs of heads, wide shots, one landscape. Alphabetical grouping (shipped) stopped them reading as a broken tail, but the crops are still wrong. Needs a human choosing from candidates: `npm run faces:recurring`, or override in `/admin/faces`, which outranks the script. **Rachel or Zach.** |
| **Lightbox previews intermittently empty at 390px** | `PhotoImage` / `serialize.ts` | The lightbox rendered `.atlas-photo-image-fallback` (meaning `photo.previews` was empty) twice in one run at 390px, then zero times in six subsequent attempts across both widths, including on the same photo ID that had just failed. No network errors, no console errors. Not caused by the 2026-08-10 branch, which is CSS only, and not reproducible on demand, so it was left alone. Recorded so whoever sees it next has the first sighting. |

### Two pre-existing toolbar bugs found and fixed in the same pass

Noted because neither was in any prior audit, and both were found by
measuring rather than looking.

- The gallery control row never fit on a phone. At 390px the search input
  rendered **25px wide** and the active-filter chip clipped to one letter; at
  320px the last action sat off-screen where nothing could reach it. The row
  now wraps below 520px, and below 720px on a touch pointer.
- The action labels collapsed to icons only up to 720px, so from 721px to
  1040px the labelled actions took **639px** and squeezed the search field to
  **57px** -- narrower than on a phone, and exactly where iPad portrait
  (820px) lands. The collapse now runs to 1040px, the breakpoint the filter
  rail and Light Bar already switch at.

### Resolved 2026-08-12: `/photos?q=` lifecycle repair shipped in #30

PR [#30](https://github.com/zachringnight/rachandzach-gallery/pull/30) merged
as `3756ac2`, which was the Production head until #31 (`4cefe66`) superseded
it on 2026-08-17. The behavior is still live: direct loads, same-route links,
and Lightbox keyword navigation open and run Moment Search.

### Resolved 2026-08-11: the /nyc supporters wall is current

The fundraiser totals were refreshed again on 2026-08-17 ($5,182 of $10,000,
53 named supporters) from live NYRR. The 2026-08-11 snapshot was $5,032 / 52
names, up from the 46 seeded on 2026-07-27. The six who gave between 07-27
and 08-11 are Tatiana Jovic, Alicia Garrity, Jessie Long, LunarEpic,
Kaitlyn Young and Vanguard, listed newest first as NYRR lists them. Linda
Willey is the 53rd named supporter as of 2026-08-17.

They were held back on the first pass because `SupportersContent.approved`
said only Rachel could approve, and only after reading each name. Zach
confirmed on 2026-08-11 that both owners can approve and that approval is
standing rather than per-name, so that comment was corrected rather than
worked around. The gate itself is unchanged: `approved: false` still takes
the whole wall down, amounts are still never stored, and `visibleSupporters`
still drops anonymous donors whatever is in `people`.
