export const meta = {
  name: 'wedding-home-wave-2',
  description: 'Wave 2 of the 0719 digital wedding home: packets 04 access layer, 05 public site, 13 catalog sync in parallel (tests only), then one integration build',
  phases: [
    { title: 'Preflight', detail: 'rachandzach_ table prefix retarget of packet 03 artifacts' },
    { title: 'Build', detail: 'packets 04, 05, 13 in parallel, tests only' },
    { title: 'Integrate', detail: 'single agent: redirects merge, typecheck, full vitest, one next build' },
  ],
}

const REPO = '/Users/zsoskin/Downloads/rachandzach-gallery'
const PLAN = REPO + '/docs/plans/2026-07-22-0719-digital-wedding-home'
const SPIKES = PLAN + '/spikes'

const REPORT = {
  type: 'object',
  properties: {
    packet: { type: 'string' },
    status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] },
    summary: { type: 'string' },
    concerns: { type: 'array', items: { type: 'string' } },
    doneCheckPassed: { type: 'boolean' },
    doneCheckOutput: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
  },
  required: ['packet', 'status', 'summary', 'concerns', 'doneCheckPassed', 'doneCheckOutput', 'filesTouched'],
  additionalProperties: false,
}

const COMMON = `
ENVIRONMENT FACTS (verified, do not re-litigate):
- Working directory: ${REPO}. NOT a git repository. Do not git init, do not commit.
- Wave 1 landed: packet 01 (tokens, content, brand, fonts), packet 02 (importer, src/types/gallery.ts), packet 03 (supabase migrations, clients, database.types.ts). Dependencies installed; package.json is NOT yours to edit. Missing dep = concern, not an install.
- Supabase CLI 2.106.0 installed, but NO Docker/container runtime and no local Postgres: supabase start / db reset CANNOT run. Anything needing a live database runs against mocks/fixtures and degrades loudly, not silently.
- uv IS installed; system python3 is 3.14 (avoid for ML work; use uv --python 3.12 when relevant).
- zod is v4 in this repo; write validation against the zod 4 API, not zod 3.
- CLOUD TARGET (Zach's decision, 2026-07-22): the existing shared Supabase project PrizmLounge, ref rnfvmqflktghriqefatc. All wedding tables carry the rachandzach_ prefix (the Preflight agent renamed packet 03's artifacts before you started; read landed source for exact names). Real credentials live in .env.cloud at the repo root, which Next.js does NOT auto-load; it exists for later deliberate cloud operations that remain gated behind Zach's explicit go. NEVER read .env.cloud values into builds, tests, prompts, reports, or logs.
- Wedding source master (READ-ONLY, never write into it): /Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean (1,721 unique photos, 14 events, _Metadata/photo-manifest.csv canonical; header includes event, filename, image_data_hash, width, height, final_people).
- HARD GATES: no deploy, no publish, no email, no cloud resource creation, no uploads to any cloud storage, no production secrets, local work only.
- ZACH DIRECTIVE: do NOT view or visually review photos. Choose images only via CSV metadata (event, width/height orientation) and the three pre-flagged references.
- SYNTHETIC BUILD ENV: if you ever run npm run build or npm run start, export the synthetic env first: GALLERY_PASSWORD_HASH (a REAL Argon2id hash of the synthetic password test-password-0719, generate with a @node-rs/argon2 one-liner), GALLERY_SESSION_SECRET (64 synthetic hex chars), and the synthetic Supabase values from .env.example. NEVER weaken, bypass, or delete env validation to make a build or server pass; missing-secret behavior is runtime fail-closed by design and build must succeed without secrets.
- FIXTURES: new test fixtures go under tests/fixtures/<your-area>/ (auth, site, sync). Treat tests/fixtures/shared/ as read-only (synthetic images with manifest.json live there; reuse them). tests/fixtures/catalog.json and tests/fixtures/photos belong to packet 13 only.
RULES:
- Read ${PLAN}/manifest.md and your packet file FIRST. The packet is your contract: exact files, interfaces with exact signatures, steps, done-check.
- Read the spike notes in ${SPIKES}/ that this prompt names before implementing the affected area; they contain verified current platform behavior.
- Touch ONLY files your packet owns plus files this prompt explicitly grants. Other packets run in parallel with you in the same working tree.
- Consume interfaces from Wave 1 exactly as they landed: read the actual source files (src/content/, src/types/gallery.ts, src/lib/supabase/) rather than assuming the packet text matched reality. If an interface you depend on is missing or different, adapt if trivial, otherwise report NEEDS_CONTEXT with specifics.
- Write failing tests first where the packet asks for tests, then implement until green.
- IMPORTANT deviation from your packet's done-check: do NOT run npm run build and do NOT run npm run typecheck (siblings are editing the tree concurrently; the Integrate phase runs both once). Run only the test portion of your done-check and say so in doneCheckOutput.
- Status contract: DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT.
`

phase('Preflight')
log('Retargeting packet 03 artifacts to the rachandzach_ table prefix (shared PrizmLounge project)')
const preflight = await agent(`You are the schema-retarget agent for ${REPO}. The tree is quiet; no other agents are running. Zach decided the wedding tables live in an existing SHARED Supabase project, so every wedding table gets the rachandzach_ prefix. A bare public.events table already exists in that project; unprefixed names are forbidden.
YOUR ONLY JOB, mechanical and complete:
1. Rename these tables everywhere they appear in supabase/migrations/*.sql, supabase/seed.sql, src/lib/supabase/database.types.ts, src/lib/supabase/schema.ts, and tests/database/schema.test.ts: events, people, photos, photo_people, photo_keywords, photo_previews, upload_batches, upload_items, moderation_actions, notification_log, rate_limit_buckets, gallery_events -> each becomes rachandzach_<name>. Also rename the Postgres function consume_rate_limit -> rachandzach_consume_rate_limit, and any indexes, constraints, triggers, and policies whose names embed the old table names (prefix those too, keeping them under Postgres's 63-char identifier limit).
2. Do NOT rename TypeScript-side type/interface/helper names (PhotoRow, createAdminClient, etc.); only SQL identifiers and table-name strings passed to the client (.from('...'), .rpc('...')) change.
3. Storage buckets are ALSO renamed (Zach's call): wedding-originals -> rachandzach-originals, wedding-previews -> rachandzach-previews, guest-pending -> rachandzach-guest-pending, guest-approved -> rachandzach-guest-approved, download-exports -> rachandzach-download-exports. Apply across the same files: bucket declarations, storage policies, any bucket-name constants in src/lib/supabase/, and tests.
4. Grep the whole repo (src, tests, scripts, supabase) for any remaining bare references to the old table OR bucket names in Supabase call sites and fix them. Legacy non-Supabase code (e.g. old gallery scripts) is out of scope. Note: you may find table renames already applied from an earlier partial run; verify and complete rather than redo.
5. Rerun npm run test -- tests/database/schema.test.ts and paste the real output.
Do not touch package.json, do not run builds, no git, no cloud calls. Report packet as "preflight-prefix".`,
  { label: 'preflight-prefix', phase: 'Preflight', schema: REPORT })
if (!preflight || preflight.status === 'BLOCKED') {
  return { preflight, aborted: 'prefix retarget failed, wave not dispatched' }
}

phase('Build')
log('Fanning out packets 04, 05, 13')

const packets = [
  {
    label: 'packet-04-access',
    prompt: `You are executing packet 04 (guest and admin access layer).
${COMMON}
Your packet: ${PLAN}/packets/04-guest-admin-access.md
ADDITIONAL FACTS:
- Read ${SPIKES}/platform-apis.md first for the verified Next.js 16 proxy.ts contract and skeleton.
- Default-deny is the patched contract: PUBLIC_ROUTES allowlist exported from src/lib/auth/guest-session.ts; everything not listed requires a guest session; /admin and /api/admin require requireAdmin.
- FAIL-CLOSED SEMANTICS (pinned by review, binding): next build MUST succeed with no credentials present. Missing GALLERY_PASSWORD_HASH or GALLERY_SESSION_SECRET fails closed at RUNTIME with a clear configuration error on server start or the first auth code path. Do not make the build itself require secrets.
- The literals 071925 and 071925-local-dev currently live in src/app/api/login/route.ts and src/lib/session.ts. Your done-check greps them to zero under src, proxy.ts, and middleware.ts.
- @node-rs/argon2 is installed. Argon2id verification runs in the Node runtime login route only.
- The rate-limit RPC is named rachandzach_consume_rate_limit as landed (Preflight renamed it); with no live DB locally, unit tests mock the Supabase RPC boundary. Structure rate-limit code so the mock seam is the client, not the logic.
- You own next.config.ts changes and the removal of middleware.ts and the old login/logout routes after your replacement passes tests. Heads up: packet 05 (parallel) writes legacy-redirect DATA to src/lib/redirects.ts; the Integrate agent merges it into next.config.ts after you both land, so leave redirects() alone unless you already need it.
Run only the test portion: npm run test -- tests/auth/guest-session.test.ts tests/auth/route-protection.test.ts. Report honestly.`,
  },
  {
    label: 'packet-05-public-site',
    prompt: `You are executing packet 05 (public site and weekend story).
${COMMON}
Your packet: ${PLAN}/packets/05-public-site-weekend-story.md
ADDITIONAL FACTS:
- Consume SiteConfig, FeatureFlags, BrandMark, Wordmark, and the CSS tokens exactly as packet 01 landed them: read src/content/site.ts, src/content/features.ts, src/components/brand/, src/styles/tokens.css first.
- PACKET 01 HANDOFFS (binding): attach displayFont.variable and bodyFont.variable (exported from src/components/brand/Wordmark.tsx; Fraunces display + Inter body via next/font) to the <html> element in src/app/layout.tsx, or the token font stacks stay on fallbacks. Tailwind source scanning is scoped to src/app, src/components, and src/lib via @source in globals.css; if you put Tailwind classes anywhere else, add a matching @source line.
- IMAGE SELECTION WITHOUT VIEWING (Zach directive): use the three pre-flagged references as primary dev images: "11 Sunset/rachelzach-768.jpg" (hero), "10 Dancing/rachelzach-941.jpg", "12 After Party/rachelzach-1164.jpg". For remaining chapter slots (coast/arrival, ceremony, dinner), pick landscape-oriented files (width > height) from the matching event folders using ONLY _Metadata/photo-manifest.csv metadata. Record every chosen source path in site content and mark all picks "dev placeholder, pending Zach's visual approval".
- Create web-only derivatives for those chosen references with sharp into public/ (small, optimized, sRGB). Never modify or move originals.
- Legacy redirects: do NOT edit next.config.ts (packet 04 owns it this wave). Write the redirect entries as data to src/lib/redirects.ts (/overview -> /, /schedule-1 -> /weekend, /gallery -> /photos, /faq-1 -> /weekend#faq, /travel -> /weekend#travel) with a top-of-file note that the Integrate agent merges them into next.config.ts redirects(). Write your public-routes test so redirect assertions read the data map (they go live after the merge).
- Voice source: the copy already mined into src/content/site.ts by packet 01; the PDF at /Users/zsoskin/Downloads/rachandzach-sitemap-copy-ai-coder.pdf is available for additional facts. Do not invent facts, playlists, or marathon details.
Run only the test portion: npm run test -- tests/content/public-routes.test.tsx. Report honestly.`,
  },
  {
    label: 'packet-13-sync',
    prompt: `You are executing packet 13 (catalog and private-media sync).
${COMMON}
Your packet: ${PLAN}/packets/13-catalog-private-media-sync.md
ADDITIONAL FACTS:
- Read ${SPIKES}/platform-apis.md first for the verified supabase-js batch signed URL, upload metadata, and object info APIs (how to prove remote identity without downloading).
- Consume GalleryCatalog, GalleryPhotoRecord, DerivativePlan from src/types/gallery.ts and the packet 02 importer modules as they actually landed. Consume Database types, createAdminClient(), bucket names from src/lib/supabase/ as packet 03 landed them.
- With no Docker, the "local Supabase execution mode" cannot hit a live stack today: build it behind a flag, prove behavior with mocked storage/database clients and synthetic fixtures, and state in concerns that the live-local pass runs once Docker exists.
- Default mode is dry-run. Real execution additionally requires --execute AND --project-ref matching an allowlist supplied at runtime; the allowlist will contain exactly rnfvmqflktghriqefatc (PrizmLounge), and the sync reads credentials from .env.cloud via an explicit --env-file flag, never from ambient env. Nothing in your tests or done-check may attempt a network write; real execution remains gated behind Zach's explicit go. The patched packet also has you recompute people.photo_count and per-event counts after each catalog batch.
- Checkpoint state file contains hashes and object paths only, never secrets.
- You own tests/fixtures/catalog.json and tests/fixtures/photos/ (seed from tests/fixtures/shared/ images if useful, copy not mutate).
Your done-check has no build step; run it as written: npm run test -- tests/import/storage-sync.test.mjs tests/import/catalog-sync.test.mjs && node scripts/sync-gallery-storage.mjs --catalog tests/fixtures/catalog.json --source tests/fixtures/photos --dry-run. Report honestly.`,
  },
]

const results = await parallel(packets.map(p => () =>
  agent(p.prompt, { label: p.label, phase: 'Build', schema: REPORT })
))

phase('Integrate')
log('Single integration pass: redirects merge, typecheck, full unit suite, one production build')
const integration = await agent(`You are the wave 2 integration agent for ${REPO}.
${COMMON}
YOUR JOB (read-mostly; you may only edit files to fix genuine integration breakage or perform the named merge, and every edit must be listed):
1. REDIRECTS MERGE: if src/lib/redirects.ts exists with packet 05's integration note, merge its entries into next.config.ts redirects() (packet 04 has finished with the file by now), then rerun npm run test -- tests/content/public-routes.test.tsx.
2. npm run typecheck
3. npm run test (full unit suite)
4. npm run build ONCE, with the SYNTHETIC BUILD ENV exported as described above. The build must succeed without weakening any env validation; if it fails on missing credentials, the bug is in packet 04's runtime/build split and you report it, not patch it away.
5. Confirm the fail-closed grep: no literal 071925 or 071925-local-dev under src, proxy.ts, or middleware.ts.
6. If something fails at a seam between packets (import path drift, type mismatch), make the minimal fix, note exactly what and why, and rerun.
Report packet as "wave-2-integration" with the real combined output.`,
  { label: 'integration', phase: 'Integrate', schema: REPORT })

return { results: results.filter(Boolean), integration }
