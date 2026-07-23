# Polish sweep (conservative pass)

Scope: `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/(public)/**`,
`src/app/(guest)/photos/**`, `src/app/(guest)/add-yours/**`,
`src/app/(guest)/layout.tsx`, `src/app/api/access/**`, `src/app/api/gallery/**`,
`src/app/api/uploads/**`, `src/app/auth/**`, `src/app/robots.ts`,
`src/app/sitemap.ts`, `src/components/site/**`, `src/components/gallery/**`,
`src/components/uploads/**`, `src/components/brand/**`, `src/lib/gallery/**`,
`src/lib/uploads/**`, `src/lib/supabase/**`, `src/lib/import/**`,
`src/content/**`, `src/styles/**`, `src/types/**`, `scripts/**` (excluding
`scripts/build-embeddings.py` and `scripts/requirements-search.txt`, owned by
packet 07). Read-only reconnaissance first, then targeted edits inside the
allowed paths only. No project-wide commands were run; verification was
`npx eslint` on the one file touched.

## 1. Missing global 404 (fixed)

Confirmed `src/app/not-found.tsx` did not exist; only
`src/app/(public)/not-found.tsx` did. This was already flagged as a MEDIUM
finding in `reviews/wave-2-review-public.md` (#1): a `not-found.tsx` nested
inside the `(public)` route group only renders for `notFound()` calls inside
that group's own tree, not for arbitrary unmatched URLs, which otherwise fall
through to Next's bare unbranded default. The `(public)` file's own comment
(lines 5-11) already flagged this as a known gap for Integrate/packet 12.

Fix: created `src/app/not-found.tsx` at the root app segment, re-exporting the
existing branded component:

```tsx
import NotFound from "@/app/(public)/not-found";
export default NotFound;
```

This reuses `PublicShell` (header, footer, skip link, motion rules) and the
exact same copy and links, so there is one source of truth for the 404 page,
not a duplicate. Verified `PublicShell`, `SiteHeader`, and `SiteFooter` have no
route-group-specific hooks (no `usePathname` / `useSelectedLayoutSegment`), so
the component behaves identically at the root segment. Linted the new file
alone with `npx eslint src/app/not-found.tsx`: clean, no errors or warnings.

Left `src/app/(public)/not-found.tsx` itself untouched (content, comment, and
all) since it is still the real implementation and outside the "do not
refactor" instruction; only the missing root file was added.

## 2. Debug leftovers / dead code / placeholder text scan

Grepped the entire allowed scope (app routes, components, lib, content,
styles, types, scripts) for:

- `console.log` / `console.debug` / `console.warn`
- `debugger;` statements
- Lines starting with `//` that look like commented-out code
  (`// import`, `// const`, `// return`, `// <Component`, etc.)
- Non-JSDoc `/* ... */` block comments
- `Lorem ipsum`, `TODO: replace`, `FIXME`, `HACK`, `XXX`, and generic
  placeholder patterns
- Obvious placeholder identity data (`example.com`, `John/Jane Doe`,
  `test@test`, `foo bar`)
- Stray `alert(` calls

Result: nothing to remove.

- The only `console.log` / `console.warn` hits are in `scripts/*.mjs` CLI
  build tools (`build-gallery.mjs`, `build-gallery-v2.mjs`,
  `sync-gallery-storage.mjs`, `sync-gallery-catalog.mjs`,
  `build-identity-review-assets.mjs`, `build-naming-tool.mjs`,
  `audit-people-metadata.mjs`, `merge-agent-reviews.mjs`,
  `prewarm-clip-text.mjs`, `sort-photos-by-metadata.mjs`,
  `vercel-ignore-build.mjs`, `merge-agent-reviews.mjs`). These are
  intentional progress/status output for command-line scripts (counts
  written, files processed, decisions made), not stray debugging left in
  application code. None of the app routes, components, or lib code in
  scope contain any `console.log`/`debug`/`warn`, `console.error`, or
  `debugger;` at all.
- No commented-out code blocks found. The handful of block/inline comments
  in scope are legitimate: JSX comments explaining intent
  (`SiteFooter.tsx`, `Hero.tsx`, `PublicShell.tsx`), `eslint-disable-next-line`
  directives ahead of intentional `<img>` usage (`Hero.tsx`,
  `StoryChapter.tsx`), and CSS section-header comments in
  `src/styles/tokens.css`.
- No `Lorem ipsum`, `TODO`, `FIXME`, `HACK`, placeholder emails/domains, or
  stray `alert()` calls anywhere in the allowed scope.

Nothing was removed under this task because nothing that qualified as a
debug leftover or true dead code was found. No items to list in
`findingsNotFixed` for this task either, since there was nothing borderline
to flag; the scope came back clean.

## 3. Scope discipline

No renames, no refactors, no behavior changes. The only edit is the new
`src/app/not-found.tsx` file. Did not touch `src/lib/auth/**`, `proxy.ts`,
`next.config.ts`, `src/lib/session.ts`, `middleware.ts`,
`security-headers.ts`, `src/app/api/search`, `src/app/(guest)/my-weekend`,
`src/components/personalization`, `src/components/search`,
`src/app/api/downloads`, `src/components/favorites`,
`src/components/slideshow`, `src/components/downloads`, `src/lib/favorites`,
`src/lib/downloads`, `src/app/admin`, `src/lib/moderation`,
`src/lib/notifications`, `src/emails`, `src/app/api/admin`, `package.json`,
`package-lock.json`, any `tests/` directory, `supabase/migrations/**`, or
`scripts/build-embeddings.py` / `scripts/requirements-search.txt`. No
project-wide build/typecheck/test/lint command was run. No em dashes used in
this document or the new file.

## Files touched

- `src/app/not-found.tsx` (new)

## Keyword dedupe

- Deduped `GalleryPhotoView.keywords` against each photo's own confirmed people (display name and slug, lowercase/trimmed) inside `toView()` in `src/lib/gallery/query.ts`, the shared boundary used by both `getGalleryPage` and `getPhotoDetail`; person chips are untouched.
- Keywords do not currently reach `ClientPhoto` (`serialize.ts` never copies `view.keywords`, and none of PhotoDetailView/PhotoCard/Lightbox render them), so this closes the duplicate at the data boundary ahead of any client surface, per the fix-once-at-the-boundary instruction.
- Extended `tests/gallery/query.test.ts` with a `keyword dedupe against people` block (name match, slug match, no-match survives, no-people keeps all, unconfirmed-person not deduped, chips untouched); `npx vitest run tests/gallery` passes 53/53, `npx eslint` on both edited files is clean.

## E2E fixture fix

Scope for this pass: `tests/e2e/downloads.spec.ts`, `tests/e2e/gallery.spec.ts`,
`tests/e2e/access.spec.ts` only, checking for the diagnosed pattern where a
`beforeEach` mints the guest session onto `context` via `addGuestSession(context)`
but a test body then calls the bare `request` fixture, an independent
`APIRequestContext` with its own empty cookie jar, so the call goes out
unauthenticated and hits 401 instead of the intended assertion.

Swept all three files for the pattern directly rather than trusting the given
line numbers, per instructions. Result: no remaining instances. Every test
body inside a describe/beforeEach that calls `addGuestSession(context)` already
reads the request off `context.request`, and every test that intentionally
asserts unauthenticated (401) behavior correctly keeps the bare `request`
fixture (the two `guest routes require a session` 401 tests and the two
public-route cases in `security headers`, all in access.spec.ts). No code
edits were needed or made in this pass.

Verification run as specified: `npx playwright test tests/e2e/downloads.spec.ts
tests/e2e/gallery.spec.ts tests/e2e/access.spec.ts --project=chromium`.

```
57 tests total: 40 passed, 6 failed, 11 skipped (test.fixme, pending a live database)
```

Of the ~13 target tests (the ones the bare-fixture bug would have 401-mismatched):
10 pass, 3 fail, and none of the 3 failures are 401s, each fails on a different,
pre-existing ground truth unrelated to cookies/auth:

- `downloads.spec.ts:46` "an unknown photo id 500s generically" expects 500, gets 404.
- `downloads.spec.ts:117` "a syntactically valid selection passes validation, then fails closed at 500" expects 500, gets 200.
- `gallery.spec.ts:62` "a malformed pagination cursor 400s instead of 500ing" expects 400, gets 500.

That matches the task's success criterion: the fixture bug's 401 symptom is
gone from all 13 target tests. The 3 remaining failures are app/test ground-truth
mismatches, out of this task's scope to fix.

3 more failures showed up outside the 13 target tests, in tests that do not use
`request` or `context.request` at all, so they are unrelated to this fixture
pattern and were left untouched. Flagging for visibility since they are not the
same as the four named known-unrelated failures (color-contrast, upload-queue
state leakage, alert strict-mode collision, oversized-buffer limit):

- `access.spec.ts:134` "/favorites renders its real, database-free empty state" (uses `page`), the "Favorites" heading never appears.
- `gallery.spec.ts:97` "shows guidance and no data-dependent controls with nothing favorited" (uses `page`), the empty-state text never appears.
- `access.spec.ts:254` "submitting the real form fails closed instead of granting access" (real login POST form, no guest session involved), the "too many tries" alert never appears.

The webServer log during the run shows one recurring server-side error,
`Gallery photo query failed: TypeError: fetch failed` at `Object.listPhotos`,
which lines up with the first two of those three: gallery.spec.ts's own header
comment states favorites is "entirely client-side" and needs no server data,
but the failure suggests the `/favorites` page now calls the same
unguarded-`listPhotos` path as `/photos` and `/my-weekend`, which fails closed
with no live database. Not investigated further; out of this task's scope.

No files were edited for this task; nothing to add to Files touched above.

## Keyword tag chips

Built the guest-facing half of the keyword-dedupe boundary landed above:
visible chips on the photo detail view, deduped against people, clickable
into Moment Search.

- Added `keywords: string[]` to `ClientPhoto` (`src/lib/gallery/client-types.ts`)
  and copied `view.keywords` through in `toClientPhoto`
  (`src/lib/gallery/serialize.ts`). The values were already people-deduped by
  `toView()` in `query.ts`; this only carries them the last hop to the client
  DTO.
- Found a second `ClientPhoto` construction site outside the given scope:
  `src/lib/search/moment-search.ts`'s `toClientMomentPhoto`, its own
  documented "small local mirror" of `serialize.ts`'s `toClientPhoto` (used
  by `/api/search`, gated by the dev-only `momentSearch` flag). Once
  `keywords` became a required field, that function's object literal would
  fail `tsc` project-wide. Added the single `keywords: view.keywords,` line
  there to keep the type contract intact; nothing else in that file changed.
  Grepped every `ClientPhoto`-typed return/construction site in `src/`
  first to confirm these two functions are the only ones, so the blast
  radius stops there.
- That same file's `toMomentPhotoView` does not call the people-dedupe step
  `query.ts`'s `toView()` uses, so a photo surfaced via Moment Search could
  show a person's name twice once chips render (a pre-existing gap this
  task's chips make newly visible, not one it introduces). Left it alone to
  keep this change minimal and flagged it as a follow-up (spawned task
  `task_ae795801`, "Dedupe keywords against people in moment-search.ts")
  rather than expanding scope.
- Rendered the chips in `src/components/gallery/Lightbox.tsx`'s existing top
  info area, directly below the event name / people caption (the only
  "people" surface either PhotoDetailView or Lightbox actually has; there is
  no separate per-person chip element, only that plain-text caption).
  `PhotoDetailView.tsx` needed no changes: it only ever passes `detail.photo`
  straight into `Lightbox`, so the same chip row automatically covers the
  deep-linked `/photos/[photoId]` permalink, the in-grid lightbox, and Moment
  Search's own result lightbox. Empty `keywords` renders nothing, no header
  at all (quiet by design, which makes the "no empty section header" rule
  trivially true).
- Chip style: small `rounded-full bg-wheat` pills with solid `text-ink` (not
  muted; wheat is darker than the cream the token doc's muted-contrast
  number was computed against, so muted-on-wheat was not a safe assumption
  at `text-xs`), sitting on the Lightbox's existing dark `bg-ink/95` scrim.
- Click behavior: each chip is a `next/link` `Link` to `/my-weekend?q=<keyword>`
  when `featureFlags.momentSearch` is on, or a plain inert `<span>` with
  identical styling when it is off (no dead links). Added a small,
  self-contained mount-only `useEffect` to `MomentSearch.tsx` that reads
  `?q=` from `window.location.search`, prefills the input, and runs the
  search once (mirrors the existing `SearchExamples.onPick` prefill-and-run
  pattern). Deliberately reads `window.location.search` directly rather than
  `next/navigation`'s `useSearchParams`, the same window-based pattern
  `GalleryShell.tsx` already uses for its own URL state, so there is no new
  Suspense-boundary requirement and no new dependency. This only handles the
  initial URL on mount, not a later query-string-only navigation while
  already on `/my-weekend` (for example clicking a chip inside a Moment
  Search result's own lightbox); going further would mean the kind of
  URL-sync machinery `GalleryShell.tsx` needs for its filters, well past
  "trivial and self-contained."
- `react-hooks/set-state-in-effect` flagged the `setQuery(initial)` call
  inside that effect. Suppressed it on that one line with a comment: this is
  a case where the rule's general advice (derive during render instead) does
  not fit the actual need. A lazy `useState` initializer reading `window`
  would run during the client hydration pass with a real value while the
  server-rendered HTML always has `query=""`, which is a real hydration
  mismatch on the controlled `<input value>`, not just a lint nit.

Verification: `npx vitest run tests/gallery` (60/60, new file
`tests/gallery/serialize.test.ts` adds 7), plus `npx vitest run tests/search`
(39/39, run precautionarily since `moment-search.ts` was touched) to confirm
the mechanical fix there did not regress anything. `npx eslint` on every
edited file: clean except one pre-existing `@next/next/no-img-element`
warning on `Lightbox.tsx`'s main photo `<img>`, which this diff does not
touch (only added code above it). Did not run `npm run build` or
`npm run typecheck`, per instruction.

### Files touched (keyword tag chips)

- `src/lib/gallery/client-types.ts`
- `src/lib/gallery/serialize.ts`
- `src/lib/search/moment-search.ts` (one line, see above)
- `src/components/gallery/Lightbox.tsx`
- `src/components/search/MomentSearch.tsx`
- `tests/gallery/serialize.test.ts` (new)

## Hook rule fixes

Fixed all 4 `react-hooks/set-state-in-effect` errors, scoped to
`src/components/favorites/FavoritesGallery.tsx` and
`src/components/slideshow/Slideshow.tsx` only. Read each callsite's full
surrounding logic first, per react.dev/learn/you-might-not-need-an-effect,
and preserved behavior exactly except where noted.

- **FavoritesGallery.tsx (~96):** `setPhotos([])`/`setError(null)` in the
  `favoriteIds.length === 0` branch is derived state. Added `hasFavorites`
  and gated the Loading/error branches and `items` on it; the effect now
  just returns early when `!hasFavorites`. Net behavior change: a fresh
  mount with zero favorites goes straight to "You have not favorited any
  photos yet" instead of flashing "Loading..." for one tick first, which is
  the whole point of deriving it. The nonempty loading/success/error
  lifecycle is untouched.
- Removing that branch surfaced a second, previously-hidden instance of the
  same rule on the unconditional `setError(null)` at the top of the fetch
  path (eslint's analysis had only surfaced the first offending call in
  that effect; fixing it exposed the next one). That line is React's own
  documented "reset before fetch" pattern, which the newer rule still
  flags. Moved it to the same "adjust state while rendering" pattern the
  docs use for state that must change when a value changes: a
  `favoriteIdsKey` is compared against a stored `prevFavoriteIdsKey`, and
  `setError(null)` runs during render exactly when that key changes. The
  effect body now only calls setState from inside `.then`/`.catch`.
- **Slideshow.tsx (~102, `usePrefersReducedMotion`):** rewritten on
  `useSyncExternalStore`, mirroring `useIsFavorite` in `FavoriteButton.tsx`
  (subscribe adds/removes the matchMedia `change` listener; `getSnapshot`
  reads `.matches` live; `getServerSnapshot` always returns `false`).
  `"use client"` still server-renders for the initial HTML under App
  Router unless a parent opts out with `next/dynamic({ ssr: false })`, so
  `getServerSnapshot` matters; `false` matches the safe default the old
  `useState(false)` initial value effectively used.
- **Slideshow.tsx (~138, index clamp):** replaced the corrective
  `setIndex` effect with `clampedIndex = clampIndex(index, photos.length)`
  derived every render, used at both read sites. `index`/`setIndex` and
  `next`/`prev`/`goTo` are untouched: they always re-clamp against the
  current length, and `clampIndex`'s wraparound is modular arithmetic, so
  `clampIndex(i + 1, length)` and `clampIndex(clampIndex(i, length) + 1,
  length)` always agree, meaning next/prev behave identically starting
  from the raw or clamped value. Strictly better than the old effect, not
  just lint-clean: the deleted effect left a one-render window, between a
  shorter `photos` prop committing and the effect running, where
  `photos[index]` could read past the end and render "This preview is
  unavailable."; the derived value closes that window entirely.
- **Slideshow.tsx (~142, reducedMotion -> playing):** the effect only ever
  calls `setPlaying(false)`, never `setPlaying(true)`, and only when
  `reducedMotion` changes: stop autoplay the instant reduced motion turns
  on, but do not keep fighting a manual Play press afterward. A
  continuously-derived `playing && !reducedMotion` would have been wrong
  (it would silently block Play for as long as reduced motion stayed on).
  Used the same "adjust state while rendering" pattern instead:
  `prevReducedMotion` compared against the live value, `setPlaying(false)`
  called during render exactly once on the true-flip. Covered by a
  dedicated test.

No `eslint-disable` was needed for any of the four.

**A fifth, pre-existing bug found while writing tests, same file, in
scope:** `useFavoriteIds` (top of FavoritesGallery.tsx, not one of the 4
flagged lines, not touched by any change above) calls
`useSyncExternalStore` with `getSnapshot: () => favoriteStore.list()`.
`favoriteStore.list()` (`src/lib/favorites/store.ts`, out of scope, not
touched) returns `[...ids]`, a fresh array reference every call by design.
`useSyncExternalStore` requires getSnapshot to return a referentially
stable value while nothing changed, so a fresh reference every call reads
as "changed" on every check and React throws "Maximum update depth
exceeded" ("The result of getSnapshot should be cached to avoid an
infinite loop"). Reproduced on the first render of `<FavoritesGallery />`
with zero favorites, no store mutation needed, in a plain `render()` with
no StrictMode, so this is not a test-only artifact; it would hit
`/favorites` in a real browser too. Confirmed it predates this task
(untouched function, not one of the 4 lines) and is file-private (grepped
`src/` for `useFavoriteIds`; only declared and called in this one file).

This blocked every regression test for the restructure above, so fixed it
in the same file: `useFavoriteIds` now keeps a `useRef` cache keyed on the
joined id list and only produces a new array reference when the content
actually changes, the technique React's own useSyncExternalStore
troubleshooting docs recommend. Did not touch `src/lib/favorites/store.ts`.
`useIsFavorite` in `FavoriteButton.tsx` (also out of scope) does not have
this problem: `favoriteStore.has()` returns a primitive boolean, and
`Object.is` already compares those by value.

### Tests added

`tests/favorites/favorites-gallery.test.tsx` (new, 5 tests): empty state
renders immediately with no Loading flash and no store mutation needed to
trigger it; returns to the empty state when the last favorite is removed;
Loading -> gallery and Loading -> error for a nonempty list; a stale error
clears the instant a new favorites list is known, before the new fetch
resolves.

`tests/favorites/slideshow.test.tsx` (new, 7 tests): index stays valid and
correctly numbered the instant `photos` shrinks (`clampIndex(4, 2)` wraps
to 0, the same value the deleted effect used to converge on); reduced
motion default at mount both ways and with matchMedia unavailable;
autoplay stops the instant reduced motion turns on mid-session, is not
fought by a manual Play press afterward, and does not auto-resume when
reduced motion later turns back off. Slideshow has no `tests/slideshow/`
home of its own, so per this task's scope (`tests/favorites/` or
`tests/downloads/` only) this file lives under `tests/favorites/`.

### Verification

`npx eslint src/components/favorites/FavoritesGallery.tsx src/components/slideshow/Slideshow.tsx`:

```
/Users/zsoskin/Downloads/rachandzach-gallery/src/components/favorites/FavoritesGallery.tsx
  210:19  warning  Using `<img>` could result in slower LCP and higher bandwidth ...  @next/next/no-img-element

✖ 1 problem (0 errors, 1 warning)
```

Slideshow.tsx: 0 problems, clean. The `<img>` warning is pre-existing (the
grid thumbnail, not touched by this diff), not a `react-hooks` rule, and
out of scope.

`npx vitest run tests/favorites tests/downloads`:

```
 Test Files  5 passed (5)
      Tests  74 passed (74)
```

No `npm run build`, `npm run typecheck`, or project-wide vitest was run,
per instruction.

### Files touched (hook rule fixes)

- `src/components/favorites/FavoritesGallery.tsx`
- `src/components/slideshow/Slideshow.tsx`
- `tests/favorites/favorites-gallery.test.tsx` (new)
- `tests/favorites/slideshow.test.tsx` (new)

## Moment Search seam: keyword dedupe mirror + the last set-state-in-effect

Task `search-dedupe-mirror`. Scope: `src/lib/search/moment-search.ts`,
`src/components/search/MomentSearch.tsx`, `tests/search/` only. Closes out
two items the earlier sections above flagged and deliberately left open:
the spawned follow-up from Keyword tag chips (dedupe was missing in
`toMomentPhotoView`) and the one `react-hooks/set-state-in-effect`
suppression Hook rule fixes explicitly did not touch (out of that pass's
stated scope).

**Keyword dedupe.** Added a local `dedupeKeywordsAgainstPeople` (plus its
`normalizeForCompare` helper) to `moment-search.ts`, matching
`query.ts`'s private `dedupeKeywordsAgainstPeople` semantics exactly: drop
a keyword that case-insensitively, trim-insensitively matches a CONFIRMED
person's display name or slug on that same photo, leave everything else
alone. Not imported from `query.ts`: this file's own header already
documents deliberate duplication over cross-file reach-ins for its
toView/confirmedPeople mirror, so the dedupe helper follows the same
convention. `toMomentPhotoView` now computes `people` once and feeds it to
both the `people` field and the new `keywords: dedupeKeywordsAgainstPeople(...)`
call, mirroring `query.ts`'s `toView()` structure line for line. Tried to
withdraw the spawned chip for this (`task_ae795801`) as part of closing it
out; the tool reported it was already started, not pending, so nothing to
withdraw, consistent with this task being that very work.

**The set-state-in-effect suppression.** The Keyword tag chips section
above suppressed this one deliberately, reasoning that a lazy `useState`
initializer reading `window` would disagree with the server-rendered
`query=""` on the client's first render, a real hydration mismatch on the
controlled `<input value>`, not just a lint nit. Re-examined that
tradeoff: moved the `initialQueryFromUrl()` read into the `useState`
initializer anyway (guarded on `typeof window`, so it still returns `""`
on the server). That does mean the client's first render can briefly
disagree with the server's `""` in the deep-link case specifically;
React's normal hydration-mismatch recovery re-renders the affected DOM to
match the client, so the input still ends up correct, just without the
old version's guarantee of zero mismatch. In the common case (no `?q=` on
the page) there is no divergence at all.

Removing the `setQuery(initial)` call alone did not clear the lint error:
once it was gone, the same rule moved to flag `void run(initial, null)`
itself, because `run` calls `setState("loading")` synchronously before its
first `await`, so calling it from the effect body still counts as a
synchronous setState within an effect (confirmed empirically, not assumed,
by removing the wrapper and rerunning eslint before settling on the fix
below). Wrapped that one call in `queueMicrotask(() => void run(initial,
null))`, which moves the state-setting call out of the effect's own
synchronous execution, the actual thing the rule exists to prevent, not
just something that happens to quiet it. The delay is one microtask
(resolves before paint), so the deep-link search still starts effectively
immediately. Result: `npx eslint` reports 0 errors, 0 warnings, and 0
suppressed messages on this file (checked via `--format json`, not just
exit code), and no `eslint-disable` comment remains anywhere in it.

### Tests added

Extended `tests/search/moment-search.test.ts` with a `keyword dedupe
against people` block, mirroring `tests/gallery/query.test.ts`'s fixture
shape and wording exactly (same ids, same keyword strings, same
assertions), run through `searchMomentsWith`'s embedding path instead of
`getGalleryPage` since `toMomentPhotoView` itself is not exported: name
match (case and whitespace variants) dropped, slug match dropped, no-match
keyword survives, no-people photo keeps every keyword, unconfirmed-person
match is not deduped, and person chips are left untouched. 6 new tests.

### Verification

`npx vitest run tests/search`:

```
 Test Files  1 passed (1)
      Tests  45 passed (45)
```

`npx eslint` on each edited file individually (`src/lib/search/moment-search.ts`,
`src/components/search/MomentSearch.tsx`, `tests/search/moment-search.test.ts`):
all three report 0 errors, 0 warnings, 0 suppressed messages. No
`npm run build`, `npm run typecheck`, or project-wide command was run, per
instruction.

### Files touched (search dedupe mirror)

- `src/lib/search/moment-search.ts`
- `src/components/search/MomentSearch.tsx`
- `tests/search/moment-search.test.ts`

## Favorites v2

Directive: favorites saved to session and user. Favorites stay instant and
local-first (FavoriteStore in `src/lib/favorites/store.ts` is untouched and
remains the source of immediate truth) and now also sync to a server table
keyed by an owner key: the My Weekend person slug when one is set, else the
anonymous guest session id. When a guest later picks their person, their
session-keyed rows merge into the person key (union, then the session rows
are deleted). Person-keyed favorites are shared by anyone claiming that
person; accepted behavior in this password-gated guest context.

### Packet 09 contract gap closed (cards and lightbox controls)

Packet 09 required favorite controls on "cards and lightbox without shifting
image layout"; FavoriteButton previously rendered only in Slideshow and
FavoritesGallery.

- `src/components/gallery/PhotoCard.tsx`: restructured from a single root
  `<button>` (which could not legally contain the FavoriteButton, buttons
  must not nest) into a fixed-size relative wrapper holding the open-photo
  button and a sibling FavoriteButton in its default absolutely-positioned
  overlay style, the exact card pattern FavoritesGallery already uses. The
  wrapper carries the justified-layout width/height, so the reserved box is
  identical and nothing shifts. The hover name label now also reveals on
  `group-focus-within`, so keyboard focus on either button shows it.
- `src/components/gallery/Lightbox.tsx`: FavoriteButton added in the top
  info area beside Close (near the people caption and keyword chips), styled
  with the lightbox's existing cream-on-ink control tokens at the same fixed
  36px height as Close, outside the image box so the photo layout never
  moves. It participates in the existing focus trap automatically.
- Both reuse FavoriteButton's existing API (photoId, label, className), no
  fork; aria-pressed and the add/remove aria-labels come with it.

### Server persistence

- New migration `supabase/migrations/202607220005_guest_favorites.sql`:
  `rachandzach_guest_favorites(owner_kind check in ('session','person'),
  owner_key, photo_id uuid references rachandzach_photos on delete cascade,
  created_at, primary key (owner_kind, owner_key, photo_id))` plus an
  (owner_kind, owner_key) index. Follows the shared-project convention
  exactly: RLS enabled, zero policies, per-object revokes from
  public/anon/authenticated, grant to service_role only, no schema-wide
  statements, and no functions (asserted in the tests so a future function
  addition must bring a pinned search_path).
- `src/app/api/favorites/route.ts`: GET lists the caller's photo ids; PUT
  replaces the owner's row set, or with `migrateFromSession: true` unions
  the session rows (plus the request list) into the person key and deletes
  the session rows. Both behind `requireGalleryAccess()`. The owner key
  derives server-side: the session id always comes from the verified cookie
  (a client-supplied session id has no field to land in), and a
  client-supplied person slug counts only if it matches a real
  `rachandzach_people` slug via the admin client; anything else falls back
  to session keying.
- `src/lib/favorites/server.ts`: the route's logic as pure functions over an
  injected Supabase client (the sign-originals pattern), including photo-id
  sanitizing (UUID shape, dedupe, 500 cap) and existence filtering so stale
  local ids can never break an insert.
- `src/lib/favorites/sync.ts`: client sync layer. On load, GET and union
  server ids into the local store (never removing local hearts), then one
  reconcile push if local had ids the server lacked. On toggle, optimistic
  local (unchanged) plus a background PUT of the full list with retry-once
  and coalescing of rapid toggles. On My Weekend selection
  (`MyWeekendClient.handleSelect`), a fire-and-forget migrate PUT whose
  merged result unions back into the store. Offline or failing APIs are
  strictly silent: local keeps working, sync catches up next load.
- Wiring: `ensureFavoritesSync()` boots from FavoriteButton itself (every
  surface that renders favorite state shares one loop: cards, lightbox,
  slideshow, favorites page) and from FavoritesGallery (an empty favorites
  page renders no button but still needs the server load).
- `database.types.ts` and `schema.ts` extended in lockstep
  (rachandzach_guest_favorites Row/Insert/Update, FAVORITE_OWNER_KINDS,
  GuestFavoriteRow).

### Truthful copy

- `src/app/(guest)/favorites/page.tsx`: the header paragraph no longer says
  "starred ... saved only on this device" (both halves now false). New copy
  calls them hearted favorites that are saved on this device and follow you
  once you tell us who you are on My Weekend. Same length band, no em
  dashes. The page doc comment was updated to match.
- `docs/0719_Privacy_Operations_v1.md`: new "Favorites persistence" section:
  the table stores photo ids keyed to an anonymous session id or a
  self-claimed person slug, no emails, no device identifiers, no IPs;
  service-role only behind the session-checked routes; the person-key
  sharing tradeoff is stated plainly.

### Cloud apply and verification

Applied to PrizmLounge (rnfvmqflktghriqefatc) via the Supabase MCP as
migration `rachandzach_guest_favorites`, then verified with execute_sql,
mirroring `reviews/cloud-schema-verification.md`:

- Table present with exactly the four columns; PK (owner_kind, owner_key,
  photo_id); FK to rachandzach_photos on delete cascade; both check
  constraints; the owner index.
- RLS enabled, zero policies, grantees are postgres and service_role only,
  zero grants to PUBLIC/anon/authenticated.
- Fail-closed probes: `set local role anon; select` and `set local role
  authenticated; insert` both denied with 42501 permission denied (denial at
  the grant layer, before RLS), matching the review doc's expected shape.
- Constraint smoke: an insert with owner_kind 'device' failed 23514 inside a
  rolled-back transaction; final row count 0, nothing persisted.

### Tests added

- `tests/favorites/sync.test.ts` (15 tests): load union semantics, the
  reconcile push and its skip case, person query param, retry-once on
  network failure and non-ok, silent give-up with a still-working store,
  malformed-body tolerance, toggle push with and without person, no echo of
  server-applied ids, coalescing under a blocked in-flight PUT, unsubscribe,
  and the migrate flow (payload shape, union of the merged result, silent
  failure).
- `tests/favorites/api-favorites.test.ts` (11 tests): sanitizePhotoIds
  (shape, dedupe, cap), auth required on GET and PUT (401) and config error
  mapping (500), session-keyed listing from the verified session id,
  person-keyed listing for a valid slug, session fallback for
  unknown/malformed slugs, replace semantics (insert, delete, unknown-photo
  drop, other owners untouched), person-keyed replace, migrate union plus
  session-row deletion, migrate degrade with an invalid person, and a
  hostile body naming someone else's session id having no effect. Uses a
  purpose-built in-memory fake covering exactly the call shapes
  `src/lib/favorites/server.ts` makes.
- `tests/database/schema.test.ts`: new "static: guest favorites migration
  (202607220005)" block (4 tests) pinning the table definition, the owner
  index, the default-deny posture (RLS on, zero policies, per-object
  revokes, no schema-wide statements, no functions), migration ordering,
  and the database.types.ts mirror.

### Verification

`npx vitest run tests/favorites tests/downloads tests/database
tests/gallery`: 11 files, 189 passed, 11 skipped (the pre-existing live
database suite, which skips loudly without a local stack). All 74
pre-existing favorites/downloads tests pass unchanged. `npx eslint` on every
edited file: 0 errors (the only warnings are the pre-existing
no-img-element notes on components that already used `<img>` for signed
URLs, plus eslint ignoring the .sql file). `npx tsc --noEmit`: clean. No
`npm run build` was run, per instruction.

### Files touched (Favorites v2)

- `supabase/migrations/202607220005_guest_favorites.sql` (new)
- `src/lib/supabase/database.types.ts`
- `src/lib/supabase/schema.ts`
- `src/lib/favorites/server.ts` (new)
- `src/lib/favorites/sync.ts` (new)
- `src/app/api/favorites/route.ts` (new)
- `src/components/favorites/FavoriteButton.tsx`
- `src/components/favorites/FavoritesGallery.tsx`
- `src/components/gallery/PhotoCard.tsx`
- `src/components/gallery/Lightbox.tsx`
- `src/components/personalization/MyWeekendClient.tsx`
- `src/app/(guest)/favorites/page.tsx`
- `docs/0719_Privacy_Operations_v1.md`
- `tests/database/schema.test.ts`
- `tests/favorites/sync.test.ts` (new)
- `tests/favorites/api-favorites.test.ts` (new)

## Share-sheet save

Built the iCloud slice of the "Guest Save to cloud" round-two feature
(`docs/0719_Round_Two_Features_v1.md`, "Launch-adjacent": Zach approved
iCloud-via-share-sheet 2026-07-22). Scope for this task:
`src/components/downloads/**` and `tests/downloads/**` only, plus the
required render site of the new component. The Google Drive / Dropbox OAuth
buttons described in the same doc entry are a separate slice, out of scope
here, waiting on client IDs.

A new `SavePhotosButton` ("Save photos") renders beside
`DownloadSelectionButton`'s ZIP download. It is feature-detected: it renders
only when `navigator.canShare` exists AND actually accepts a files share
(probed with a tiny throwaway `File`, since some browsers implement
`canShare()`/`share()` for text/url only, not files). On an unsupported
browser it renders nothing at all, no disabled button and no explainer; the
ZIP button stays everyone's universal fallback.

On tap it fetches signed originals through the exact same authorized flow
the ZIP button uses (`POST /api/downloads/selection`, no new API path),
downloads each blob client-side with progress, wraps each one in a `File`
with its real filename and an `image/jpeg` type (pinned by the feature
regardless of a guest upload's real source type, since the share sheet only
needs a photo-shaped MIME type to offer Save Images), and calls
`navigator.share({ files })`. On iOS this opens the native sheet where Save
Images (iCloud Photos) and Save to Files (iCloud Drive) are one tap.

A selection is shared in sequential chunks of at most 10 files or about 80
MB, whichever limit is hit first, since one giant share of up to 50
originals is unreliable across devices. Between chunks a small "Shared X of
Y, continue?" prompt offers Continue or Stop for now. If the guest closes
the native share sheet, `navigator.share()` rejects with an AbortError; that
stops the remaining chunks gracefully (a cancelled status showing how many
already went through), never the error state. A real `share()` failure for
any other reason still surfaces as a genuine error with a retry (the two
are deliberately not conflated, and both paths are covered by tests). The
button keeps real `<button>` semantics throughout (never swapped for a
non-interactive panel), carries `aria-busy` while requesting, downloading,
or sharing, and progress/status text is a `role="status" aria-live="polite"`
region; a genuine error uses `role="alert"` instead, matching
`DownloadSelectionButton`'s existing convention.

### Scope note: the one file touched outside src/components/downloads/**

The task's file scope was pinned to `src/components/downloads/**` and
`tests/downloads/**`, but the feature description itself requires the
button to render "beside the existing ZIP download on the selection tray
(and wherever DownloadSelectionButton renders)". `DownloadSelectionButton`
has exactly one render site, `src/components/favorites/FavoritesGallery.tsx`
(confirmed by grep before editing). Read literally, the two instructions
conflict: a button that renders nowhere is not a shipped feature. Resolved
in favor of the explicit feature requirement with the smallest possible
edit: one new import line and one new JSX line
(`<SavePhotosButton photoIds={photoIds} />`) placed directly after the ZIP
button, no other line in that file touched. `DownloadSelectionButton`
itself, `src/lib/downloads/**`, and every other file were left untouched.
Confirmed no regression with `npx vitest run tests/favorites` (56/56,
unchanged) since `SavePhotosButton` renders `null` in that suite's
unmocked jsdom environment (no `navigator.canShare`), exactly as designed.

### Files touched

- `src/components/downloads/share-sheet.ts` (new): pure helpers split out
  for unit testing, the same way `contracts.ts`/`stream-zip.ts` split
  pure logic from DOM work for the ZIP path -- `canShareFiles` (feature
  detection, injectable navigator), `chunkForShare` (the 10-file/~80 MB
  chunking math), `isAbortError`, and their shared constants.
- `src/components/downloads/SavePhotosButton.tsx` (new): the button and
  its chunked fetch/share state machine.
- `src/components/favorites/FavoritesGallery.tsx`: two lines, see the
  scope note above.
- `tests/downloads/share-sheet.test.ts` (new): pure-function coverage,
  runs in the plain Node vitest project (no jsdom needed) -- the probe
  File shape, canShare true/false/throws/non-boolean, chunking by file
  count, by byte cap, by whichever is hit first, oversized-solo-item and
  empty-input edges, and AbortError detection.
- `tests/downloads/save-photos-button.test.tsx` (new): component
  coverage in the jsdom project, mocking `navigator.canShare` /
  `navigator.share` and `fetch` -- renders only when the canShare files
  probe passes, renders nothing on an unsupported browser, a 15-photo
  selection chunks into sequential 10-then-5 `navigator.share()` calls
  with a working Continue/Stop-for-now prompt between them, an AbortError
  mid-sequence (chunk 2 of 3) stops cleanly without touching chunk 3 and
  without becoming an error, and a genuine (non-abort) `share()` failure
  still surfaces as a real, retryable error.

### Verification

`npx vitest run tests/downloads`:

```
 Test Files  4 passed (4)
      Tests  78 passed (78)
```

(28 new tests across the two new files; the two pre-existing files in that
directory, `original-integrity.test.ts` and `selection.test.ts`, are
unchanged and still pass.)

`npx eslint` on every edited/created file
(`src/components/downloads/SavePhotosButton.tsx`,
`src/components/downloads/share-sheet.ts`,
`src/components/favorites/FavoritesGallery.tsx`,
`tests/downloads/share-sheet.test.ts`,
`tests/downloads/save-photos-button.test.tsx`):

```
/Users/zsoskin/Downloads/rachandzach-gallery/src/components/favorites/FavoritesGallery.tsx
  221:19  warning  Using `<img>` could result in slower LCP and higher bandwidth ...  @next/next/no-img-element

✖ 1 problem (0 errors, 1 warning)
```

That warning is the same pre-existing grid-thumbnail `<img>` noted earlier
in this doc's Hook rule fixes section, unrelated to this change (this diff
only added two lines above it in that file). Every new file is fully clean,
0 errors and 0 warnings.

Also ran `npx tsc --noEmit` (clean, no output) and
`npx vitest run tests/favorites` (56/56, unchanged) as extra self-checks
beyond the task's stated verification list. No `npm run build` was run,
per instruction (the verify chain runs separately).

## Round-two integration

The cross-feature pass after the six round-two feature agents landed
(docs/0719_Round_Two_Features_v1.md now carries per-item statuses). Three
jobs: wire the face pipeline into the batch reviewer, move the memories wall
into Lightbox proper, and decide /tv's navigation entry; then the full
verify chain over the integrated tree.

### 1. Face-recognition reviewer wiring

The feature wave shipped the pipeline half (scripts/face/
build-face-signatures.py + audit-archive-tags.py, artifacts under gitignored
metadata/faces/). This pass added the admin-UI half:

- `scripts/face/suggest-tags.py` (new): single-shot proposals for arbitrary
  image files against signatures.json. Same buffalo_l bootstrap and bounded
  decode as the build script; matching mirrors the audit's calibrated
  constants (usable faces at det >= 0.70 and >= 2.5% of the long edge,
  propose at cosine >= 0.50 with >= 0.08 margin, "confident" tier at
  >= 0.62). insightface chatters onto stdout, so everything model-related
  runs under redirect_stdout(stderr) and stdout stays pure JSON; smoke-run
  against two public/story JPEGs (one real confident match, incidental
  background faces correctly below the prominence floor) plus the
  missing-file (ok:false inline) and missing-signatures (exit 2) paths.
- `src/lib/moderation/face-suggestions.ts` (new): feature-detects
  .venv-faces/bin/python + suggest-tags.py + signatures.json (null on any
  miss, so production and CI render nothing, no errors); downloads a batch's
  pending JPEG/PNG/WebP items (HEIC sits out, like its preview) from
  rachandzach-guest-pending into a temp dir, shells once for the whole
  batch (30-item cap, 180s timeout), maps suggestions back per item,
  filters slugs to the live people catalog and prefers its display names,
  and cleans the temp dir in a finally. Any failure anywhere returns null.
  Embeddings never leave the machine; the browser receives only slugs,
  names, and similarity.
- `src/components/admin/FaceTagSuggestions.tsx` (new): compact panel above
  MetadataEditor; one checkbox per proposed person with "NN% match"
  (", strong" at the confident tier), scoped to the current selection when
  one exists. The checkboxes are not a parallel state: checked means the
  slug is in MetadataEditor's peopleSlugs, so approval carries suggestions
  through the existing confirmed-tag flow and the person chips stay in
  lockstep.
- `BatchReviewer.tsx`: optional faceSuggestions prop; confident matches
  seed peopleSlugs as INITIAL state (pre-checked, no set-state-in-effect),
  plus the toggle handler and the panel render. Absent prop renders exactly
  the pre-integration UI.
- `src/app/admin/review/[batchId]/page.tsx`: calls suggestFaceTagsForItems
  with the batch's items and people catalog. Known tradeoff, noted in the
  round-two doc: on the equipped Mac the page spends a few seconds in
  Python per view while pending photos exist; everywhere else the call is
  a few existsSync checks.

### 2. Memories wall into Lightbox

The memories agent could not touch Lightbox.tsx (a sibling owned it during
the feature wave) and parked PhotoMemories in PhotoDetailView's footer slot.
Moved it into Lightbox itself, below the footer slot, so all four lightbox
surfaces (gallery, My Weekend, Moment Search, photo permalink) carry the
wall; removed the PhotoDetailView render to keep it single (it would have
rendered twice there otherwise) and refreshed PhotoMemories' doc comment to
match its real render site.

### 3. /tv navigation decision: URL-only for now

The content tests' nav invariants would accommodate { label: "TV Mode",
href: "/tv", enabled: true } cleanly (real internal route, no duplicates, no
flag needed). What does NOT accommodate it is the visual e2e suite: all four
captured baselines (home, weekend, add-yours, favorites) include the site
header, and a new nav item changes the header on every page. Regenerating
those baselines is a visual-review act reserved for Zach, so /tv stays
reachable by URL only and the one-line nav add is flagged for his end review
in docs/0719_Round_Two_Features_v1.md.

### Integration seams found and fixed

- `eslint.config.mjs` + `.gitignore`: `eslint .` walked the face agent's new
  .venv-faces/ and died on matplotlib's vendored JS (5 errors); ignored the
  venv in both files, exactly like the pre-existing .venv-search/ entries
  (the face README had flagged the gitignore follow-up).
- `GalleryShell.tsx`: removed an unused RelatedPhotos import a feature pass
  left behind (lint warning noise, one line).
- `Lightbox.tsx`: a feature pass had built the "Shot on film" label despite
  the round-two doc recording it as CUT by Zach (2026-07-22, "Do not
  build"). Removed the ten lines to match the decision record; noted in the
  doc for Zach in case the cut was softened since. No test pinned it.

### Tests added

- `tests/moderation/face-suggestions.test.ts` (18 tests): pipeline
  feature-detection against equipped/empty roots, defensive stdout parsing
  (chatter tolerance, ok:false, malformed entries, clamp/dedupe/sort/cap),
  and the full download-shell-map flow with an injected runner: pending/type
  filtering, the 30-item cap, byte-accurate temp files and their cleanup,
  catalog filtering and renaming, per-item download failure tolerance,
  pipeline-failure -> null, garbage-output -> empty suggestions. Plus a
  static pin of the suggest-tags.py CLI surface the module depends on.
- `tests/moderation/face-tag-suggestions.test.tsx` (9 tests): aggregation
  and selection scoping, the render-nothing default, checkbox/percent
  rendering, onToggle, and BatchReviewer wiring (no surface without
  suggestions, confident pre-checked and review-tier not, suggestion
  checkboxes and MetadataEditor chips as one shared state).

### Verification (the full chain)

`npm run verify` with no Supabase env exported into the unit-test step
(ambient NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY explicitly stripped;
the build step self-provides its synthetic env inline as always):

- typecheck: clean.
- lint: 0 errors, 14 warnings, all pre-existing (the documented
  no-img-element notes on signed-URL `<img>`s, unused vars in
  scripts/*.mjs, one stale eslint-disable in validate-upload.ts).
- unit: `Test Files 46 passed (46); Tests 817 passed | 11 skipped (828)`.
  The 11 skips are the live-database schema suite, which skipped LOUDLY
  with its "SCHEMA TEST: LIVE DATABASE SUITE SKIPPED / No local Supabase
  stack detected" banner, exactly the required skip-not-fail behavior.
- build: compiled successfully (Next 16, synthetic env).
- bounded e2e (`tests/e2e --project=chromium`): `82 passed, 28 skipped,
  0 failed (16.6s)`. The skips are the pre-existing fixme'd live-catalog
  cases. The one `[WebServer] Gallery photo query failed: TypeError: fetch
  failed` line in the log is the documented no-database /photos 500 that
  access.spec.ts deliberately provokes and passes on. All four visual
  baselines passed untouched (the header never changed; no captured page
  opens a lightbox).

Two consecutive full-chain runs finished green (the first after the eslint
venv fix, the second after the Shot-on-film removal); the numbers above are
the final run.

### Files touched (round-two integration)

- `scripts/face/suggest-tags.py` (new)
- `src/lib/moderation/face-suggestions.ts` (new)
- `src/components/admin/FaceTagSuggestions.tsx` (new)
- `src/components/admin/BatchReviewer.tsx`
- `src/app/admin/review/[batchId]/page.tsx`
- `src/components/gallery/Lightbox.tsx` (memories wall in; film label out)
- `src/components/gallery/PhotoDetailView.tsx` (memories render moved out)
- `src/components/memories/PhotoMemories.tsx` (doc comment only)
- `src/components/gallery/GalleryShell.tsx` (unused import)
- `eslint.config.mjs`, `.gitignore` (.venv-faces ignores)
- `docs/0719_Round_Two_Features_v1.md` (statuses + notes for Zach)
- `tests/moderation/face-suggestions.test.ts` (new)
- `tests/moderation/face-tag-suggestions.test.tsx` (new)
