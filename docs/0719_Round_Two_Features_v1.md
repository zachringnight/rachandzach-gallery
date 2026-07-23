# 0719 + co. Round Two Features

Product decisions from Zach, 2026-07-22 evening. This is the post-launch feature slate; nothing here blocks the current cycle. Items marked LAUNCH-ADJACENT should be planned immediately after (or alongside) launch approval.

## Launch-adjacent

- **Guest "Save to cloud" on the selection tray.** Photos always go to THE GUEST'S OWN accounts, never Zach's (confirmed by Zach 2026-07-22): each guest OAuths into their own Google Drive or Dropbox (Google `drive.file` scope, the lightweight per-file one; Dropbox app equivalent) and the server hands signed originals across into their account; guest tokens are used per transfer and never stored server-side. iCloud has no third-party web API, so on Apple devices the same surface uses the Web Share API native share sheet into the guest's own iCloud Photos / Files (this slice shipped 2026-07-22, no OAuth needed). The ONLY Zach-side piece is the one-time developer app registration at Google and Dropbox (client IDs identifying the app on the consent screens, not a data destination); the buttons stay absent until those IDs land in config.
  - SHIPPED 2026-07-22: iCloud-via-share-sheet slice built and tested ("Save photos" button, `src/components/downloads/SavePhotosButton.tsx`, beside the ZIP download in `FavoritesGallery.tsx`; tests in `tests/downloads/`). Google Drive/Dropbox OAuth buttons still pending client IDs.
- **Bucket backup: CLOSED as already-satisfied (Zach, 2026-07-22).** The originals already live in three independent places: the clean master on the Mac, Zach's personal Dropbox (pre-existing copy), and the Supabase buckets once the sync lands. Supabase Pro's backups excluding Storage objects is therefore covered by the other two copies. Optional nicety someday: spot-verify the personal-Dropbox copy's completeness against the 1,721-photo manifest. The one asset with no automatic offsite story is FUTURE guest uploads (they exist only in the buckets); revisit a lightweight mirror for rachandzach-guest-approved if guest uploads accumulate meaningfully.

## Fast follows (flag flips + content)

- **Playlists**: page built; needs Spotify URLs and titles.
- **Marathon**: page built; needs Rachel's story and donation URL; timely before November.
- **Anniversary capsule**: module built with a date gate; load content for July 19, 2027.
- **Approved memory notes**: guests' upload notes as captions post-approval; moderation flow already supports it.

## Round-two proper

- **Download my weekend**: one-tap ZIP of every photo you are tagged in (My Weekend + ZIP tray glue).
  - SHIPPED 2026-07-22: `DownloadMyWeekendButton` renders in My Weekend for a resolved person, batching through the existing ZIP tray flow (`src/components/personalization/DownloadMyWeekendButton.tsx`, `weekend-download-batches.ts`; tests in `tests/personalization/`).
- **Memories wall**: guest notes attached to specific photos; reuses the moderation pipeline.
  - SHIPPED 2026-07-22: `rachandzach_photo_memories` (migration 202607220006), `/api/memories` + admin approve/reject routes, the `PhotoMemories` wall + composer, and the `/admin/memories` review queue. Integration pass renders the wall inside `Lightbox` itself, so every lightbox surface (gallery, My Weekend, Moment Search, photo permalink) carries it. Tests in `tests/memories/`.
- **TV mode**: /tv full-screen auto-looping slideshow for gatherings.
  - SHIPPED 2026-07-22: `/tv` route (`src/app/(guest)/tv/`), whole-catalog pool in weekend order, Shuffle-the-Weekend diversity ordering, wake lock, Esc hint. Tests in `tests/modules/tv.test.tsx`. Reachable by URL only for now: adding a nav item would change the site header on every page and invalidate the four visual e2e baselines (home, weekend, add-yours, favorites), which need Zach's eyes to re-approve. FOR ZACH'S END REVIEW: say the word and "TV Mode" joins `src/content/site.ts` navigation (one line, content tests already accommodate it); the visual baselines get regenerated in that same sitting.
- **New-photos digest email**: CUT by Zach 2026-07-22. Do not build.
- **Face-recognition moderation assist** (admin-only, never guest-facing): local InsightFace pipeline builds per-person signatures from the 1,721 confirmed-tagged photos (co-occurrence resolution, solo shots as anchors), proposes tags on new guest uploads in the review screen, and runs a backward audit over the archive (flags tagged-but-absent and present-but-untagged, ranked, human-confirmed). Face embeddings live local/service-role only; guests only ever see confirmed name tags. The audit half can ship standalone first.
  - SHIPPED 2026-07-22, both halves. Pipeline: `scripts/face/` (signatures + backward audit, reports under gitignored `metadata/faces/`; see `scripts/face/README.md`). Reviewer wiring (integration pass): `scripts/face/suggest-tags.py` proposes tags for a batch's pending uploads; `src/lib/moderation/face-suggestions.ts` shells to it server-side and `FaceTagSuggestions` renders the proposals in the batch reviewer, confident matches pre-checked into the existing confirmed-people flow. Feature-detected: on any machine without `.venv-faces/` + `metadata/faces/signatures.json` (production included) the surface renders nothing at all. Embeddings never leave the machine; the browser sees only slugs, names, and match percentages. Known tradeoff: the admin batch page spends a few seconds shelling to Python per view while pending photos exist, local admin only.
- **"Shot on film" label**: CUT by Zach 2026-07-22. Do not build.
  - Integration note 2026-07-22: a feature pass had built this nod into `Lightbox` despite the cut; removed during round-two integration to match this record. If the cut was softened since, it is a ten-line re-add.

## Corrections and non-goals

- The "wedding film" video-hosting idea from early brainstorming was a misread: 14 Film is film photography, already in the catalog as an event. Video hosting only returns if real videographer footage exists.
- Standing non-goals (deliberate): no public likes/comments/social feed, no guest-facing biometric anything (selfie matching rejected 2026-07-22: person filters + My Weekend already solve "find me", and state biometric-privacy law makes it expensive to do right).
- Favorites server persistence (session + person keyed) was pulled INTO the current cycle 2026-07-22 rather than waiting for round two.
