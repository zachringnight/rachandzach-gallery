# Task 11: Feature-flagged experience modules

**Wave:** 5
**Depends on:** 01, 05, 06, 08, 10

## Objective

Add the useful extensions the initial request did not fully specify. Every incomplete idea is a real disabled module, not a placeholder page. The data contracts are ready when content arrives.

## Files

- Create: src/app/(public)/playlists/page.tsx
- Create: src/app/(public)/marathon/page.tsx
- Create: src/app/(guest)/submissions/[batchId]/page.tsx
- Create: src/components/modules/ShuffleWeekend.tsx
- Create: src/components/modules/RecentlyApproved.tsx
- Create: src/components/modules/PlaylistChapter.tsx
- Create: src/components/modules/MarathonSupport.tsx
- Create: src/components/modules/AnniversaryCapsule.tsx
- Create: src/components/modules/ApprovedMemoryNote.tsx
- Create: src/lib/modules/contracts.ts
- Create: tests/modules/feature-flags.test.tsx
- Create: tests/modules/submission-status.test.ts

## Interfaces

- Consumes: SiteConfig and FeatureFlags from task 01.
- Consumes: PublicShell and FeaturePortal from task 05.
- Consumes: getGalleryPage(input) and getPhotoDetail(photoId) from task 06.
- Consumes: getUploadStatus(batchId, receiptToken) from task 08.
- Consumes: approved batch notes and terminal decisions from task 10.
- Produces: PlaylistConfig
  - title: string
  - description: string
  - spotifyUrl: string
  - coverPhotoId: string | null
  - eventSlug: string | null
- Produces: MarathonConfig
  - runnerName: string
  - raceName: string
  - story: string
  - donationUrl: string
  - charityName: string
  - goalAmount: number | null
  - displayProgress: boolean
- Produces: AnniversaryCapsuleConfig
  - enabledAt: string | null
  - title: string
  - body: string
  - photoIds: string[]
- Produces: getRecentlyApproved(limit: number) -> Promise<GalleryPhotoView[]>.

## New feature set

- Shuffle the Weekend: one action opens a varied approved photo and can continue as a serendipitous slideshow.
- Recently Added: a separate guest-upload rail with clear contributor credit when approved.
- Submission Receipt: a private receipt-token page with upload counts and moderation status.
- Approved Memory Notes: short uploader context shown only when both the photo and note are approved.
- Playlists: one or more Spotify-linked chapters, optionally paired to weekend events.
- Marathon Support: Rachel's story, charity, donation action, and optional progress display.
- Anniversary Capsule: a timed editorial module for a future anniversary.
- Album Shortlist handoff: link to packet 09 export, positioned as a future print workflow.

## Launch and future boundaries

- Launch: Shuffle the Weekend, Recently Added, and Submission Receipt.
- Enable when content arrives: Playlists and Marathon Support.
- Future opt-in: Anniversary Capsule and Approved Memory Notes.
- Do not add public comments, likes, follower counts, facial recommendations, or a social feed.
- Do not scrape Spotify or donation totals. Use supplied canonical URLs and explicit display settings.

## Steps

- [ ] Write flag tests proving disabled modules have no route in navigation, no sitemap entry, and no empty placeholder card.
- [ ] Write receipt tests proving a batch ID without its receipt token reveals nothing.
- [ ] Build Shuffle with event diversity and no repeat until the recent-history queue is exhausted.
- [ ] Query Recently Added from approved guest photos only and cap the home rail at 12.
- [ ] Build the receipt page with submitted, under review, partially approved, approved, rejected, and expired states.
- [ ] Build playlist and marathon pages against typed config. Return not found while their flags are false.
- [ ] Use Spotify links or accessible embeds only after URLs are supplied. Avoid autoplay.
- [ ] Render marathon progress only from explicit structured data. Never imply live progress when the data is static.
- [ ] Build the anniversary module with a date gate and manual feature flag. No automatic publication.
- [ ] Render approved memory notes as captions, with contributor display name only when the uploader opted in.
- [ ] Report status. Missing playlist or marathon content is expected and must not block completion.

## Done-check

Run: npm run test -- tests/modules/feature-flags.test.tsx tests/modules/submission-status.test.ts && npm run build

Expected: tests and build pass. Disabled playlist, marathon, anniversary, and memory-note features are absent. Receipt access is opaque. Recently Added contains approved guest photos only.

## Report

Report DONE with playlists and marathon disabled. Use NEEDS_CONTEXT only if the typed config cannot represent content Zach later provides.
