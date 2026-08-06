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

## Waiting on a person, not an engineer

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
- **Zach, two rows**: confirm or deny the two Jeff Rush candidates in
  `metadata/faces/review-2026-08-05-b/sheet-001.jpg` (sims 0.615 and 0.483),
  surfaced by the post-wave-13 rebuild. Nothing is applied.
- **Rachel**: two face crops are correct but unflattering and worth replacing in `/admin/faces`, which outranks anything the script picks: `charlie-weisman` (mid-sentence) and `dee-burton` (another woman shares the frame).
- **Zach**: optional, drop a screenshot at `public/nyc/instagram-post.jpg` to fill the Instagram card on `/nyc`. It degrades to type-only without one, so nothing is broken.
