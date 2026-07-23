# Boundary fixes queue

Findings from the sidework reviews that cannot be applied while their files are owned by running agents. Apply at the named boundary; check off with the commit of record (once git exists) or the applying agent's report.

## At Wave 2 integrate/completion (src/content and nav are quiet)

- [ ] site.ts galleryIntro rewrite: current line doubles coast/dance-floor wording; suggested rewrite is in reviews/copy-qa.md. Apply the rewrite or an equivalent in the same voice.
- [ ] Verify /my-weekend navigation is gated consistently with momentSearch being dev-only (schema-brand review finding 8); My Weekend itself does not require momentSearch, so the check is that nav copy does not promise search before packet 07 ships it.
- [ ] Record: heroTitle "Rachel & Zach" is a deliberate packet 01 override of the PDF's rach + zach preservation rule. Do not revert (copy-qa.md documents it).

## At Wave 3 integrate (GalleryApp replacement lands)

- [ ] Confirm src/components/GalleryApp.tsx and its filename-fallback alt text (old lines 188, 215) are fully replaced/deleted by packet 06's gallery. No raw filename may surface in alt text.

## At Wave 4 preflight (package.json owner window)

- [x] Add npm script types:generate -> supabase gen types typescript --local > src/lib/supabase/database.types.ts. CLOSED 2026-07-22 (nobody held package.json at the time; applied directly). Also corrected embeddings:import to route through uv --python 3.12 instead of bare python3.
- [x] Fold spikes/embeddings-env-js.md into spikes/embeddings-env.md as the JS text encoder section. CLOSED 2026-07-22; embeddings-env-js.md left as a one-line pointer.

## Once a container runtime (Docker/OrbStack) exists

- [ ] Regenerate database.types.ts via supabase gen types and diff against the hand-written file (schema-brand review finding 4; preflight-prefix concern).
- [ ] Run the live schema test layer (RLS denial, cascades, rate-limit semantics) that static assertions cannot cover.

## Cloud config checks (verified live via management API, 2026-07-22 evening)

- [x] Project-global storage upload cap is 1 GiB, comfortably above the 50 MB bucket caps. CLOSED.
- [x] SMTP is already configured project-wide via smtp.resend.com (sender "Nothing But Bet"); admin magic links to wedding@rachandzach.com are deliverable today. Sender branding is cosmetic for admin-only mail. CLOSED for launch purposes.
- [ ] At preview/deploy time: the project's auth site_url points at a different app; add the wedding site URL to the auth redirect allow-list (uri_allow_list) via management API and always pass an explicit redirect_to in the magic-link flow. One API call, do it when the preview URL exists.
- Orientation scan of the real archive: complete, 1,721 of 1,721 files are Orientation=1. No derivative regeneration needed; the importer orientation fix is for correctness only.

## Resend sender domain (decided 2026-07-22: rachandzach.com)

- [ ] Register rachandzach.com in Resend (needs the real re_ API key or a dashboard click by Zach; the SMTP credential readable from Supabase config is masked and cannot manage domains).
- [ ] Add the DNS records Resend emits: MX + SPF TXT on send.rachandzach.com, DKIM TXT on resend._domainkey.rachandzach.com, optional DMARC p=none on _dmarc. None touch existing root mail records (full detail in docs/0719_Launch_Ops_v1.md).
- [ ] After verification: from identity is "0719 + co. <wedding@rachandzach.com>" (wired into packet 10's config). Outbound sending still requires Zach's explicit approval.

## Data note for search/display packets (no action yet)

- Keywords duplicate people names on 1,476 of 1,721 photos (prepare-clean-master baked final_people into embedded Keywords). Packet 06/07 display and search should dedupe keywords against peopleSlugs rather than showing both.
