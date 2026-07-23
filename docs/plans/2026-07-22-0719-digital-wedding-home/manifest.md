# 0719 + co. Digital Wedding Home Plan

**Goal:** Rebuild the existing gallery into a warm, private-first wedding home where guests can relive the weekend, find themselves, download byte-identical originals, and submit their own photos for approval.

**Architecture:** Keep the current Next.js App Router repo and replace the static reduced-image gallery with a Supabase-backed catalog. Vercel serves the application shell and server authorization. Browsers upload to and download from private Supabase Storage through short-lived signed URLs, so original media does not transit Vercel. A read-only importer turns the clean master manifest into database rows, immutable display derivatives, and optional local visual-search embeddings.

**Tech stack:** Next.js 16.2.x, React 19.2.x, TypeScript 5.9.x, Tailwind CSS 4, Supabase Postgres and private Storage, Supabase Auth for admin magic links, Uppy/TUS for resumable uploads, Resend and React Email for notifications, Vitest, Playwright, and axe-core. Deploy to Vercel only after Zach approves.

## Product shape

- Public: home, weekend story, and eventually playlists and marathon pages.
- Shared guest access: photos, person filters, My Weekend, favorites, downloads, slideshow, and Add Yours.
- Admin access: moderation, metadata edits, guest-upload approval, and notification history.
- Launch beta: natural-language Moment Search using local CLIP embeddings. It searches scenes and objects, not identities.
- Future flags: anniversary capsule, approved memory notes, private family albums, video or voice notes, and print-album handoff.

## Global constraints

- Do not publish, deploy, email, upload media, create cloud resources, or connect a production domain without explicit approval.
- Runtime floor is Node.js 20.9 and TypeScript 5.1. Keep the existing Next.js 16.2.x, React 19.2.x, and TypeScript 5.9.x lines unless a verified compatibility issue requires a change.
- Treat /Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean as read-only.
- Use its _Metadata/photo-manifest.csv as the catalog source. Exclude _Review, _Metadata, and By Person.
- Reverify the source snapshot before import. The July 22 reference is 1,721 unique primary JPEGs across 14 events.
- Use image_data_hash as the stable visual identity across metadata edits. Compute file_sha256 from the current source bytes. Original downloads must match file_sha256 byte for byte.
- Never resize, recompress, rewrite, or strip metadata from the source originals.
- Display derivatives may be AVIF, WebP, or JPEG. Their object names must include a content hash and use cache-control public,max-age=31536000,immutable.
- Keep all original, preview, guest-pending, and export buckets private. Issue short-lived signed URLs server-side.
- No public face recognition, identity inference, or biometric search. Person discovery uses confirmed embedded metadata only.
- User-confirmed identity corrections are authoritative. Leave uncertain names unresolved.
- Do not spend time tagging incidental background guests. Existing background tags may remain.
- Gallery and uploads require a shared guest session. Admin requires a magic link for wedding@rachandzach.com.
- Production credentials fail closed. No fallback passwords or session secrets.
- Guest uploads accept JPEG, PNG, WebP, and HEIC only. Maximum 50 files per batch and 50 MB per file.
- Pending and rejected uploads are never visible to guests. Rejected originals enter a 30-day recoverable cleanup queue.
- Playlist and marathon routes stay disabled until real content and links are supplied.
- Keep analytics minimal and free of person names, email addresses, photo URLs, and search text.
- Use the original site's warm, playful voice. Preserve facts, not its old navigation.
- Visual direction is 0719 + co.: wheat, cream, sand, tan, dusty coral, charcoal, quiet editorial type, generous whitespace, and real ceremony or reception photography.
- Do not commit unless Zach explicitly asks for commits in the current thread.

## Required storage buckets

(Renamed 2026-07-22 for the shared PrizmLounge project; tables likewise carry the rachandzach_ prefix.)

- rachandzach-originals
- rachandzach-previews
- rachandzach-guest-pending
- rachandzach-guest-approved
- rachandzach-download-exports

## Task index

| ID | Task | Primary files touched | Depends on | Wave |
|----|------|-----------------------|------------|------|
| 01 | Brand and content foundation | package.json, src/content/, src/styles/, public/brand/ | none | 1 |
| 02 | Read-only media import pipeline | scripts/build-gallery-v2.mjs, src/types/gallery.ts, tests/import/ | none | 1 |
| 03 | Supabase schema and storage rules | supabase/migrations/, src/lib/supabase/ | none | 1 |
| 13 | Catalog and private-media sync | scripts/sync-gallery-catalog.mjs, scripts/sync-gallery-storage.mjs, src/lib/import/ | 02, 03 | 2 |
| 04 | Guest and admin access layer | src/lib/auth/, src/app/api/access/, proxy.ts | 03 | 2 |
| 05 | Public site and weekend story | src/app/(public)/, src/components/site/ | 01 | 2 |
| 06 | Gallery discovery and lightbox | src/app/(guest)/photos/, src/components/gallery/, src/lib/gallery/ | 02, 03, 04, 13 | 3 |
| 07 | My Weekend and Moment Search | src/app/(guest)/my-weekend/, src/lib/search/, scripts/build-embeddings.py | 02, 03, 04, 06 | 4 |
| 08 | Resumable guest uploads | src/app/(guest)/add-yours/, src/app/api/uploads/, src/lib/uploads/ | 01, 03, 04 | 3 |
| 09 | Originals, favorites, ZIP, and slideshow | src/app/api/downloads/, src/components/favorites/, src/components/slideshow/ | 02, 03, 04, 06 | 4 |
| 10 | Moderation and notifications | src/app/admin/, src/lib/moderation/, src/emails/ | 03, 04, 08 | 4 |
| 11 | Feature-flagged experience modules | src/app/(public)/playlists/, src/app/(public)/marathon/, src/components/modules/ | 01, 05, 06, 08, 10 | 5 |
| 12 | Production QA and handoff | tests/e2e/, docs/, scripts/vercel-ignore-build.mjs, vercel.json | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 13 | 6 |

## Waves

- Wave 1: 01, 02, 03
- Wave 2: 04, 05, 13
- Wave 3: 06, 08
- Wave 4: 07, 09, 10
- Wave 5: 11
- Wave 6: 12

## Launch definition

Launch is ready for Zach's final review when the public pages match the approved 0719 + co. direction, every protected route fails closed, all 1,721 current primary photos can be discovered, an original download reproduces its source hash, guest uploads remain pending until admin approval, and the mobile gallery remains responsive with the full catalog.

## End-review eyeball list

- Confirm the shared guest-access model and production password.
- Confirm the dedicated Supabase project, costs, region, bucket retention, and backup policy.
- Confirm whether approved guest originals are downloadable or display-only.
- Approve the 0719 + co. logo treatment, hero selects, and copy.
- Supply playlist and marathon details when ready.
- Approve Resend sender-domain configuration and all outbound emails.
- Approve the first Vercel preview, then production domain and launch.

## Implementation references

- Supabase private buckets and signed URLs: https://supabase.com/docs/guides/storage/buckets/fundamentals
- Supabase resumable uploads: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- Vercel ignored build steps: https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel
- Resend with Next.js: https://resend.com/nextjs

## Five-minute next action

Read the Product shape and End-review eyeball list. If those are right, say "ship the plan" to begin Wave 1. That still does not authorize deployment or publication.
