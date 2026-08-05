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

| Item | Where | Why it matters |
|---|---|---|
| The filter panel never closes after a selection | `src/components/gallery/FilterBar.tsx` (`open` is only toggled by the Filters button; `onChange` does not close it) | On a phone the panel covers ~68% of the screen. Tap "The Wedding", nothing visibly changes, tap again. Reads as broken. Close on a `person`/`event` change; keep it open for orientation/sort, which are refinements. |
| Active-filter chips hidden below 720px | `globals.css`, `.atlas-active-filters { display: none }` | The only signal a filter is applied is a numeric badge. A guest arriving from a name link cannot see whose photos they are looking at, or get back to everything. Keep the first chip with `max-width: 45vw`, collapse the rest to "+2". |
| Tap targets under 44px | Photo card controls 36px; filter actions 34px; lightbox controls 38px, arrows 32px | Photo tiles are ~132px tall on a phone with two 36px overlay buttons, so mis-taps that trigger a download instead of opening are near certain. Consider showing only Favorite on touch and moving per-card Download into the lightbox. |
| No guest-scoped `not-found` | `src/app/(guest)/` has none, so `notFound()` in `[personSlug]` falls through to the public 404 | Person URLs are now guessable and typeable by design, so mistypes are the expected failure, not an edge case. A signed-in guest gets a different header, different nav, and no route back to Find me. Add `src/app/(guest)/not-found.tsx` with a link to `/my-weekend`. |
| Sticky chrome eats ~25% of a phone viewport | `VirtualPhotoGrid.tsx` hard-codes `VISIBLE_TOP_OFFSET = 170` (header + filter rail + chapter strip + light bar) | On a 667px screen that is a quarter of the viewport before a single photograph. Hide the chapter strip and light bar on scroll-down below 720px. |

## Guest journey

| Item | Where | Why it matters |
|---|---|---|
| Sign-in lands on the full archive | `src/app/(access)/enter/page.tsx`, `DEFAULT_DESTINATION = "/photos"` | Everything else points at Find me first. Change to `/my-weekend`; deep links via `?next=` still win, so shared URLs are unaffected. |
| The download button wall | `src/components/personalization/DownloadMyWeekendButton.tsx` renders one Download **and** one Save per 50-photo batch | A guest in 180 photos sees eight buttons at the emotional peak of the product. `DownloadSelectionButton.runBatches` already sequences batches behind one click; lift the chunking inside it so the caller passes all ids and the guest sees one button and one progress bar. |
| Lightbox keyword chips deep-link somewhere that hides the result | `Lightbox.tsx` links keywords to `/my-weekend?q=…`; the search panel sits *below* the guest's entire gallery with no scroll-to | Tapping "sunset" appears to do nothing. Point at `/photos?q=…` instead. |
| `PersonPicker` announces the wrong purpose on Find me | `PersonPicker.tsx` hard-codes `aria-label="Filter by person"` and an `<h2>People</h2>` in both variants | A screen-reader user hears "Filter by person" on a page whose job is "tell us who *you* are". Derive label and heading from `variant`. |

## Technical debt

| Item | Where | Why it matters |
|---|---|---|
| **No AVIF fallback** | `pickTarget` in `PhotoImage.tsx` takes AVIF whenever it exists with no feature detection, and `serialize.ts` now signs only one format per width to match | The client is AVIF-only. This is not a regression (the WebP rows were never a working fallback, just unused payload), but a browser without AVIF support gets broken images. A real fix needs a `<picture>` element **and** a matching change to what gets signed, together. |
| Six design screenshots committed at repo root | `comp-a-final.jpeg` and five siblings, ~1.8 MB, tracked since 2026-07-23 | One-off design comparison artifacts nothing references. Delete or move under `docs/`. |
| `force-dynamic` on 28 routes | Everywhere | Audited and mostly **correct**: the cost is inside the render, not the mode, and most routes embed per-guest signed URLs so they genuinely cannot be cached. `src/app/(guest)/[personSlug]/page.tsx` is the one clear candidate, and its three sequential Supabase queries could be parallelised. Low value; listed so nobody re-audits it. |
| No field instrumentation | `package.json` | Neither `@vercel/speed-insights` nor `@vercel/analytics` is installed. ~2 KB, and it turns the performance work from measured-locally into measured-in-the-field. |

## Found 2026-08-05, in the face pipeline pass

| Item | Where | Why it matters |
|---|---|---|
| ~~`main` fails its own visual gate~~ **RESOLVED 2026-08-05** | `tests/e2e/visual.spec.ts-snapshots/` | All 24 stale baselines (six pages by four projects) were regenerated after inspecting the rendered pages at desktop and 390px mobile. The old `home` baseline still showed the retired public marketing homepage. `npm run verify` is fully green again. Note for later: with the whole site gated, `home`, `enter`, `enter-error` and `404` all render essentially the same screen, so four of six visual baselines now cover one page. |
| ~~"Brend Wasserman" is truncated in 10 originals~~ **RESOLVED 2026-08-05** | see `docs/ONLINE_HANDOFF.md` | All four layers now read "Brenda Wasserman" and the live sync guard passes. Fixed with the new `scripts/rename-person-in-master.py`, not the existing alias reconciler, which could not see her name and would have destroyed later face tags if pointed at those photos. |
| **`jorie-soskin`'s signature may be two people** | `metadata/faces/signatures.json`, clusters `c0070` and `c0090` | `c0070` is 81 faces at confidence 0.696 and is plainly one man across the archive. `c0090` is 18 faces at 0.453 and its sample faces do not obviously look like him. 113 catalog tags ride on this slug, so if the second cluster is somebody else it is the highest-leverage remaining profile defect. Not acted on: the `c0090` samples are too blurred for a confident call, and no tag has been applied from it. Render the two clusters side by side and have a human look. |

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
- **Zach, two rows**: confirm or deny the two Jeff Rush candidates in
  `metadata/faces/review-2026-08-05-b/sheet-001.jpg` (sims 0.615 and 0.483),
  surfaced by the post-wave-13 rebuild. Nothing is applied.
- **Rachel**: two face crops are correct but unflattering and worth replacing in `/admin/faces`, which outranks anything the script picks: `charlie-weisman` (mid-sentence) and `dee-burton` (another woman shares the frame).
- **Zach**: optional, drop a screenshot at `public/nyc/instagram-post.jpg` to fill the Instagram card on `/nyc`. It degrades to type-only without one, so nothing is broken.
