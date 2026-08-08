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
