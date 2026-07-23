# 0719 + co. Privacy Operations

**Status: v1, finalized by packet 12 (2026-07-22).** The commitments and mechanisms below are verified against the landed code. Claims that name a specific automated proof are marked with that check's current status: the packet 12 Playwright e2e suite now exists (`tests/e2e/`) and improved fast within this pass (49 of 110 passing on the first snapshot, 68 of 110 on a re-run after fixes landed) but is not fully green yet; see `docs/0719_Launch_Checklist_v1.md` section 1d for the current breakdown. A dedicated automated sweep of live analytics/sitemap/robots/log output has not been run in this environment. The underlying mechanism each commitment relies on is landed and code-reviewed regardless of whether its end-to-end proof has run yet.

The privacy commitments of the 0719 + co. digital wedding home and how each is enforced. Sources: the plan manifest and packets 03, 04, 06, 07, 08, 09, 10, and 12 under `docs/plans/2026-07-22-0719-digital-wedding-home/`.

## Private storage and signed URLs

**Commitment:** wedding media is never publicly reachable.

**Enforcement:**
- All five buckets (`rachandzach-originals`, `rachandzach-previews`, `rachandzach-guest-pending`, `rachandzach-guest-approved`, `rachandzach-download-exports`) are private with default-deny storage policies
- Signed URLs are issued server-side only, after a session check: previews default to 60-minute expiry (one tunable constant), single originals to 10 minutes
- Guests never receive a service-role key; only the admin client can approve, reject, move, or delete objects
- Media bytes never transit Vercel: previews, original downloads, browser-side ZIP streaming, and TUS uploads all go direct to Supabase Storage
- No route returns a raw private object path by design (every response carries a signed URL or a redirect to one, never a bucket/object name). `tests/e2e/access.spec.ts` covers part of this (a comment at its `/api/gallery` case notes the resulting error "must not leak internals"); the suite as a whole is not fully green yet, so treat this as designed-and-partially-tested rather than fully proven -- see `docs/0719_Launch_Checklist_v1.md` section 1d

## Pending and rejected invisibility

**Commitment:** guest uploads are invisible to everyone but admin until approved.

**Enforcement:**
- Uploads land in the private guest-pending bucket with no guest reads; even the submitting guest cannot read pending objects after upload
- Every gallery query, facet, search, related-photos list, and download endpoint filters to approved status; the `ids` batch lookup applies the same isolation
- The submission receipt page returns state and counts only, gated by a hashed receipt token; a batch ID without its token reveals nothing
- Catalog rows become guest-visible only after the approved asset and its previews exist
- Status-isolation unit tests in packets 06, 08, and 10 (for example `tests/uploads/status-isolation.test.ts`) are landed and passing; the packet 12 end-to-end proof across the full running stack is authored (`tests/e2e/`) but not fully green as of this pass. Any visibility leak found once it is green is a BLOCKED finding

## No face recognition or biometric search

**Commitment:** the site performs no identity inference.

**Enforcement:**
- Moment Search uses local CLIP scene embeddings that match objects and scenes ("sunset kiss", "people dancing"), not identities
- No face embeddings are generated or stored; the existing face-recognition review models are not used for site search
- Photo embeddings are generated locally from approved display derivatives; wedding images are never sent to a third-party AI service
- The model ID and revision are pinned with recorded license and checksum

## Person tags from confirmed metadata only

**Commitment:** person discovery reflects what people have confirmed, not what software guesses.

**Enforcement:**
- Person chips and filters show confirmed embedded metadata only; no inferred tags
- User-confirmed identity corrections are authoritative; uncertain names stay unresolved
- No time is spent tagging incidental background guests

## EXIF GPS stripping on guest-upload derivatives

**Commitment:** guest photos never expose location or device data publicly.

**Enforcement:**
- GPS and device-identifying EXIF are stripped from the public display derivatives of guest uploads
- The private submitted original is preserved unchanged in private storage, so nothing is lost and nothing leaks

## Minimal, non-identifying analytics

**Commitment:** analytics contain no person names, email addresses, photo URLs, or search text.

**Enforcement:**
- The optional `gallery_events` table constrains its metadata to an allowlisted scalar key set via check constraint, so identifying fields have nowhere to live
- Sessions appear only as an anonymous hash
- Moment Search logs success, latency bucket, and result count only; query text is never logged
- Downloads record only anonymous aggregate counts
- The mechanism (the metadata allowlist above, plus no code path that ever writes a name/URL into `rachandzach_gallery_events`) is landed; a dedicated automated sweep of live analytics, sitemap, robots output, public HTML, and logs confirming none of this leaked in practice has not been run in this environment as of this pass

## Favorites persistence

Favorites sync to one server table (`rachandzach_guest_favorites`) that stores photo ids keyed to either an anonymous guest session id or a self-claimed My Weekend person slug: no emails, no names beyond the slug the guest chose for themselves, no device identifiers, no IP addresses. Like every other gallery table, it is RLS-on with zero policies and readable or writable only through the service role behind the session-checked `/api/favorites` routes; when a guest claims a person, their session-keyed rows are merged into the person slug and the session rows are deleted. A person-keyed favorite set is shared by anyone who claims that person, which is accepted behavior inside a password-gated guest gallery.

## Photo memories

Guest notes attached to specific photos (the Memories wall) live in one server table (`rachandzach_photo_memories`) that stores the note text (500 characters at most, enforced by the composer, the server, and a Postgres check constraint), an optional self-chosen display name (80 characters at most), and an owner key that is either the anonymous guest session id or a self-claimed My Weekend person slug: no emails, no device identifiers, no IP addresses. Every note starts `pending` and becomes guest-visible only when the admin approves it in `/admin/memories`; pending and rejected notes are never reachable through any guest surface, including their author's (the guest read path filters to approved status, and `tests/memories/` pins this). Approved notes are served with the body and display name only; the owner key never leaves the server, not even to the admin queue. Like every other gallery table it is RLS-on with zero policies, readable and writable only through the service role behind the session-checked `/api/memories` routes and the admin-checked `/api/admin/memories` routes, and note creation is rate limited per hashed IP with the same fail-closed posture as login.

## 30-day recoverable rejection queue

**Commitment:** a rejection is never an immediate, irreversible delete.

**Enforcement:**
- Rejected originals enter a 30-day recoverable cleanup queue
- Packet 10 ships a recoverable cleanup view for rejected items older than 30 days and does not auto-delete
- Restoring a rejected item requires an explicit admin action and writes a new audit record

## noindex on protected routes

**Commitment:** search engines see only the public pages.

**Enforcement:**
- Protected routes are not indexed and do not appear in the generated sitemap
- Protected gallery data is absent from public page HTML
- The default-deny proxy keeps every unlisted route behind the guest session, so a newly added route cannot accidentally go public

## Supporting controls

- Fail-closed credentials: no fallback passwords or session secrets in production
- Login rate limiting keyed by hashed IP; network identifiers are hashed with a dedicated secret before storage. This RPC (`rachandzach_consume_rate_limit`) errored on every call against a real Postgres instance until a corrective migration (`202607220004_rate_limit_conflict_fix.sql`) was applied and live-verified during packet 12 -- while broken it failed in the safe direction (denied every attempt rather than allowing an unlimited number), so this was never a privacy leak, only a functionality gap. See `docs/0719_Launch_Checklist_v1.md` section 1b
- Access responses never reveal whether the password or admin account exists
- Receipt tokens are hashed before database storage
- Security headers include frame-ancestors, nosniff, strict referrer policy, and a tested Content Security Policy
- Seeds and test fixtures use synthetic records only; no real guest names or emails
- Notification emails go to wedding@rachandzach.com and, optionally, the submitting guest; internal rejection notes are never exposed
