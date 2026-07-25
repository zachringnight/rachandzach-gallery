# UGC App and ProductCopy Reuse Audit

Date: 2026-07-24

## Scope and method

This audit used current `origin/main` snapshots, not the stale working copies:

- UGC App: `/Users/zsoskin/Downloads/UGC App` at
  `0695cf1fffc9a5e5a4f0fa3f401460216be2ef9b`
- ProductCopy: `/Users/zsoskin/dev/ProductCopy` at
  `e0f4a16fc87f38b7b57ddb1322cc961080798e4e`

The reference repositories were not modified. Each `origin/main` tree was
exported to a temporary read-only directory. The audit:

1. Enumerated every tracked path and grouped the complete app, component,
   library, test, migration, script, and documentation trees.
2. Searched the full text source, tests, and docs for discovery, tables,
   viewers, media loading, URL state, selection, sharing, export, uploads,
   moderation, accessibility, retry, offline, realtime, and mobile patterns.
3. Deep-read the reusable feature surfaces and their tests.
4. Compared those patterns against the wedding repo before recommending a
   port.

Binary media was inventoried by path and type, not visually reviewed. It is
campaign-specific source material rather than reusable application logic.

### Coverage

| Repository | Tracked files | Main code | Tests | Docs | Other large areas |
| --- | ---: | ---: | ---: | ---: | --- |
| UGC App | 1,017 | 118 TSX, 155 TS | 99 | 125 | 91 app files, 43 migrations, 520 public assets |
| ProductCopy | 1,510 | 555 TSX, 408 TS | 84 unit, 14 e2e | 115 | 90 migrations, 275 public assets |

## Executive judgment

Do not port either application wholesale. Both contain good interaction
patterns, but their operating models are different:

- UGC App is an analytics and curation data room for social posts.
- ProductCopy is a broad campaign operations platform with approvals,
  calendars, exports, realtime mutations, and media handoff.
- The wedding site is a private, image-first guest product with a smaller admin
  workflow.

The right move is to port small, proven patterns into the wedding site's
existing privacy and media architecture.

## Adopted in this pass

| Wedding surface | Change | Reference pattern |
| --- | --- | --- |
| Guest photo grid | Removed event and people labels from photo surfaces. Metadata remains in accessible button names. | UGC App viewer keeps primary media visually clean. |
| Lightbox | Initial focus on Close, horizontal touch-only paging, vertical/mouse gesture rejection, adjacent preview preloading, and `N of M` position. | UGC `OwnedMediaViewer` and `ImmersiveViewer`; ProductCopy `image-lightbox` and `ugc-tracker-theater`. |
| Guest gallery search | Added deterministic search across event, confirmed person, keyword, and filename metadata. Search is combined with every existing filter. | UGC `buildSearchBlob`/debounced search; ProductCopy `ugc-grid.ts`. |
| Shareable discovery state | Added `q` to page/API query state so search, filters, sort, and open photo survive copied URLs. | UGC `SavedViews`; ProductCopy `ugc-view-state.ts`. |
| Filter clarity | Added removable active-filter chips and an active count while preserving the live result count. | UGC `TableFilterBar`/`FilterRail`; ProductCopy `filter-chips.tsx` and `ugc-filters.tsx`. |
| Admin catalog | Added URL-backed contact-sheet/table view switching. Table mode lists thumbnail, filename, dimensions, event, people, keywords, source, and metadata status while reusing the bounded bulk selection/editor. | UGC virtual table information design; ProductCopy `ugc-data-grid.tsx`. |

## Reuse matrix

### High-value next candidates

| Priority | Pattern | Source evidence | Wedding target | Recommendation |
| --- | --- | --- | --- | --- |
| P1 | Copy current filtered view | UGC `components/hooks.ts` (`useCopied`) and URL-backed views | Guest gallery and admin catalog | Add a small Copy view action with an `aria-live` confirmation. The URL is already canonical after this pass. |
| P1 | Named saved views | UGC `components/SavedViews.tsx` | Admin catalog | Save named catalog queries in localStorage, capped and schema-validated. Keep the URL as the shareable artifact. |
| P1 | Bounded transient retry | UGC `lib/feed/fetch-retry.ts` and QueryClient retry policy | Gallery filter/pagination fetches | Retry network, 429, and 5xx responses twice with capped backoff. Never retry 401 or other honest 4xx state. |
| P1 | Dynamic facet counts | UGC `FilterRail.tsx`, `FiltersSheet.tsx`, and `TableFilterBar.tsx` | Admin catalog first | Return counts for the current query context so unavailable event/person choices can be hidden or disabled. |
| P2 | Mobile filter sheet with live apply count | UGC `FiltersSheet.tsx` and `Sheet.tsx` | Guest gallery | Replace the long small-screen disclosure only if phone QA shows it obscuring photos. Implement without adding Framer Motion. |
| P2 | Catalog density control | UGC `TableControls.tsx` | Admin catalog | Add compact/comfortable row density if the catalog grows beyond the current 36-row page. |
| P2 | Viewer thumbnail rail | UGC `ImmersiveViewer.tsx`; ProductCopy deck viewer | Guest lightbox | Use loaded photos only, virtualize or cap it, and keep it outside the image stage. |
| P2 | Back-to-top after long browse | UGC `components/ui.tsx` | Guest gallery | Useful for a 1,721-photo collection after mobile visual QA. Respect safe-area and reduced-motion settings. |
| P3 | Realtime invalidation | ProductCopy `realtime-sync-provider.tsx` | Admin catalog/review | Only worthwhile if multiple admins edit concurrently. Debounce by table and avoid mutation plus realtime double invalidation. |

### Already present or stronger in the wedding repo

| Reference capability | Wedding equivalent | Decision |
| --- | --- | --- |
| Infinite/virtual tables and feeds | `VirtualPhotoGrid` virtualizes justified rows and paginates near the tail. | Keep the photo-native implementation. |
| Progressive thumbnail/fallback handling | `PhotoImage` picks signed preview tiers, reserves aspect ratio, crossfades, and renders a fallback. | Keep. External thumbnail materialization is unnecessary. |
| Deep-linked viewer | `/photos?photo=...` and `/photos/[photoId]` | Keep. |
| Viewer keyboard/focus behavior | `Lightbox` and `Slideshow` | Kept and strengthened in this pass. |
| Selection and bulk action bars | Guest selection bar and admin catalog inspector | Keep. |
| Native sharing and download fallback | `SavePhotosButton`, streaming ZIP, failed-item retry | Wedding implementation is more appropriate and already feature-detects file sharing. |
| Personal collections | Favorites and My Weekend | Keep. Better guest fit than UGC saved sets. |
| Semantic media search | Moment Search with private embeddings | Keep separate from deterministic metadata search. |
| Upload retry/resume | TUS guest upload queue | Keep. Stronger than either reference for this use case. |
| Moderation and audit isolation | Admin review, bounded tagging, retry-safe processing | Keep. |
| Route skeletons and honest errors | Gallery loading UI and session/network/empty states | Keep; add bounded retry only. |
| Presentation mode | Wedding slideshow | Keep. ProductCopy presentation exports are campaign-report specific. |

### Do not port

| Pattern | Reason |
| --- | --- |
| Guest-facing dense data table | It turns a wedding album into an operations tool. Table mode belongs in `/admin/catalog` only. |
| Engagement metrics, rankings, outreach, creator tiers | No guest value and no compatible data model. |
| CSV/XLSX/PPTX exports | Admin tagging and guest photo delivery already have purpose-built outputs. Spreadsheet/deck exports add dependencies and privacy surface. |
| Social oEmbed and thumbnail materialization | Wedding previews are private, owned, signed assets. External platform workarounds do not apply. |
| ProductCopy realtime optimistic mutation stack | Too much complexity for current single-admin usage, and its audit documents silent failures and duplicate refetches. |
| ProductCopy global search categories | The wedding domain only needs photos, people, events, and moments. A global command palette would add navigation weight. |
| UGC public hubs, leaderboards, and showcase rankings | Campaign presentation concepts conflict with a private personal album. |
| PWA push notifications | No recurring task or timely notification contract for guests. |
| Mux/Dropbox handoff surfaces | Media hosting and archive boundaries are already defined through private Supabase storage and protected originals. |
| Framer Motion sheet dependency | The interaction can be built with existing CSS and dialog primitives if phone QA justifies it. |

## Important source caveats

The useful ProductCopy UGC surface is not a drop-in library. Its own current
audit identifies:

- Notes that write to the database on every keystroke.
- Silent mutation failures despite optimistic success messaging.
- Redundant mutation and realtime invalidations.
- A large fallback seed shipped in the client bundle.
- Filter dimensions implemented in logic but unreachable from the UI/URL.

Its generic `SortableTable` also uses clickable table headers rather than real
keyboard-operable buttons. The wedding table borrows the information layout,
not that implementation.

UGC App has the stronger table implementation, but its virtualization, column
filters, exports, and saved-view system are sized for thousands of analytical
rows. The wedding admin should add those pieces only when a demonstrated
workflow needs them.

## Key reference files

### UGC App

- `components/OwnedMediaViewer.tsx`
- `components/ImmersiveViewer.tsx`
- `components/FilterRail.tsx`
- `components/FiltersSheet.tsx`
- `components/TableFilterBar.tsx`
- `components/ColumnFilter.tsx`
- `components/TableControls.tsx`
- `components/SortableTable.tsx`
- `components/SavedViews.tsx`
- `components/hooks.ts`
- `components/ui.tsx`
- `lib/feed/fetch-retry.ts`
- `tests/showcase/showcase-media-viewer.test.tsx`

### ProductCopy

- `src/components/worldcup/ugc/ugc-tracker-page-client.tsx`
- `src/components/worldcup/ugc/ugc-tracker-theater.tsx`
- `src/components/worldcup/ugc/ugc-data-grid.tsx`
- `src/components/worldcup/ugc/ugc-filters.tsx`
- `src/components/worldcup/layout/search-panel.tsx`
- `src/components/worldcup/shared/filter-sidebar.tsx`
- `src/components/worldcup/shared/filter-chips.tsx`
- `src/lib/worldcup/ugc-grid.ts`
- `src/lib/worldcup/ugc-view-state.ts`
- `src/components/nwsl/NwslMediaDayHub.tsx`
- `src/components/PresentationMode.tsx`
- `docs/audit/wc-ugc.md`
- `docs/audit/nwsl.md`

## Merge-state follow-up

At audit time, wedding `origin/main` was
`00ecb288111c00776fc7da6b67b4d91ddbba555e`, the merge of PR 1, and the changes
described as "adopted in this pass" were uncommitted working-tree changes.

Those changes and their review fixes later shipped in
[PR 2](https://github.com/zachringnight/rachandzach-gallery/pull/2), merged as
`4455ba95d15259ef210ebd64f8283bc80fe005da`. The former
`codex/wedding-premium-overhaul` branch has no commits outside `main`; the
2026-07-25 closeout review also found no stash or additional worktree carrying
unique tracked work.
