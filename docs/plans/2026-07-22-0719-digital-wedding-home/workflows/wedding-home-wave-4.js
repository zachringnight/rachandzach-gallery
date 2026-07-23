export const meta = {
  name: 'wedding-home-wave-4',
  description: 'Wave 4 of the 0719 digital wedding home: packets 07 my-weekend/search, 09 downloads/favorites/slideshow, 10 moderation in parallel, then one integration build',
  phases: [
    { title: 'Preflight', detail: 'boundary install: heic-decode + @types/heic-decode' },
    { title: 'Build', detail: 'packets 07, 09, 10 in parallel, tests only' },
    { title: 'Integrate', detail: 'single agent: typecheck, full vitest, one next build' },
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
- Waves 1-3 landed: 01 brand/content, 02 importer, 03 supabase schema/clients, 04 auth (requireGalleryAccess/requireAdmin, default-deny proxy), 05 public site, 13 sync, 06 gallery (getGalleryPage, getPhotoDetail, getGalleryFacets, Lightbox), 08 uploads. Dependencies installed, including heic-decode and @types/heic-decode (this workflow's Preflight phase installed them); package.json is NOT yours to edit. Missing dep = concern, not an install.
- NO Docker/container runtime, no local Postgres: database-dependent logic is tested against mocks/fixtures and degrades loudly.
- uv IS installed and verified. System python3 is 3.14 (transformers has a documented import bug there); all Python execution goes through uv run --python 3.12. Do not install global tools.
- SYNTHETIC BUILD ENV: if you ever run npm run build or npm run start, export the synthetic env first: GALLERY_PASSWORD_HASH (a REAL Argon2id hash of the synthetic password test-password-0719, generate with a @node-rs/argon2 one-liner), GALLERY_SESSION_SECRET (64 synthetic hex chars), and the synthetic Supabase values from .env.example. NEVER weaken, bypass, or delete env validation to make a build or server pass; build succeeds without secrets, runtime fails closed, by design.
- FIXTURES: new test fixtures go under tests/fixtures/<your-area>/ (search, downloads, moderation). Treat tests/fixtures/shared/ as read-only (synthetic JPEG/PNG/WebP/HEIC with manifest.json live there; the HEIC fixture synthetic-4.heic has verified ftyp/heic magic bytes; reuse them). tests/fixtures/catalog.json and tests/fixtures/photos belong to packet 13.
- src/app/(guest)/layout.tsx is owned by packet 06 (already landed); do NOT create or edit it. Nav entries for your new routes are integration-agent work.
- Wedding source master is READ-ONLY: /Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean.
- HARD GATES: no deploy, no publish, no email, no cloud resources, no uploads to cloud storage, no production secrets, local only. Never send a real email; Resend stays disabled without RESEND_API_KEY and explicit approval.
- ZACH DIRECTIVE: no visual photo review. Never open images to judge them.
RULES:
- Read ${PLAN}/manifest.md and your packet file FIRST.
- Consume upstream interfaces as they ACTUALLY landed: read the real source files. Trivial drift: adapt. Real mismatch: NEEDS_CONTEXT with specifics.
- Touch ONLY files your packet owns. Two other packets run in parallel with you in this working tree.
- Tests first, then implement until green.
- Status contract: DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT.
`

// This line is intentionally NOT in COMMON: COMMON is also injected into the
// Integrate agent's prompt below, and an earlier wave learned the hard way
// that a shared "do NOT run npm run build" line makes the Integrate agent
// skip its OWN required build (it reads as a self-instruction). Only the
// three parallel packet-builder prompts get this line, appended per-prompt.
const SKIP_BUILD_NOTE = `
IMPORTANT deviation from your packet's done-check: do NOT run npm run build (siblings run concurrently; the integration phase runs the single build). Run only the non-build portion of your done-check and say so in doneCheckOutput.`

phase('Preflight')
log('Boundary install: heic-decode + @types/heic-decode while the tree is quiet')
const preflight = await agent(`You are the wave 3-to-4 boundary installer for /Users/zsoskin/Downloads/rachandzach-gallery. The tree is quiet; no other agents are running. YOUR ONLY JOB:
1. In that directory run: npm install heic-decode && npm install -D @types/heic-decode
2. Verify: node -e "import('heic-decode').then(m => console.log('heic-decode loads:', typeof (m.default ?? m)))" prints a function/object, and a scratch .ts file importing decode from 'heic-decode' passes npx tsc --noEmit on it.
3. Confirm package.json and package-lock.json are the ONLY files changed. Touch nothing else. No git, no commits.
Report packet as "preflight-install" with the real command output.`,
  { label: 'preflight-install', phase: 'Preflight', schema: REPORT })
if (!preflight || preflight.status === 'BLOCKED') {
  return { preflight, aborted: 'boundary install failed, wave not dispatched' }
}

phase('Build')
log('Fanning out packets 07, 09, 10')

const packets = [
  {
    label: 'packet-07-search',
    prompt: `You are executing packet 07 (My Weekend and Moment Search).
${COMMON}
Your packet: ${PLAN}/packets/07-my-weekend-moment-search.md (already patched with the spike decisions).
ADDITIONAL FACTS:
- MANDATORY FIRST READ: ${SPIKES}/clip-model.md. Pinned models and revisions are recorded there. Text encoder runs in the Vercel Node route via src/lib/search/query-embedding.ts, NOT a Supabase Edge Function. L2-normalize both sides. The 5-string parity check gates ingestion.
- pgvector migration is separate and reversible (202607220003_moment_search.sql). It cannot be applied locally (no Docker); static-assert its SQL in tests like packet 03 did.
- SHARED-PROJECT PREFIX (binding): the cloud target is a shared Supabase project; every wedding table carries the rachandzach_ prefix and every bucket the rachandzach- prefix as landed. Your new table is rachandzach_photo_embeddings and your RPC is rachandzach_search_gallery_moments. Read src/lib/supabase/ for the landed naming convention.
- The Slideshow component from packet 09 is generic; you wire the My Weekend list into it. Packet 09 runs in parallel, so code against this EXACT contract (it is pinned in packet 09's Interfaces; do not improvise): SlideshowProps { photos: GalleryPhotoView[]; modeLabel: string; startIndex?: number; intervalMs?: number; onClose?: () => void }. If the component file does not exist yet when you finish, leave your import in place and note it for the integration agent.
- Do not log query text. My Weekend preference is client-only local storage.
Run the non-build portion: npm run test -- tests/search/moment-search.test.ts tests/personalization/my-weekend.test.ts && uv run --python 3.12 scripts/build-embeddings.py --fixture tests/fixtures/search --verify. Report honestly.${SKIP_BUILD_NOTE}`,
  },
  {
    label: 'packet-09-downloads',
    prompt: `You are executing packet 09 (originals, favorites, ZIP, and slideshow).
${COMMON}
Your packet: ${PLAN}/packets/09-downloads-favorites-slideshow.md (patched: Slideshow is generic, favorites render via GalleryQueryInput.ids).
ADDITIONAL FACTS:
- Read ${SPIKES}/platform-apis.md for signed URL APIs. One-photo download redirects to a 10-minute signed original URL; ZIP streams signed originals client-side via @zip.js/zip.js (installed); never proxy media through Vercel.
- Build Slideshow with this EXACT prop contract (pinned in your packet's Interfaces; packet 07 is coding against it in parallel, so no renames): SlideshowProps { photos: GalleryPhotoView[]; modeLabel: string; startIndex?: number; intervalMs?: number; onClose?: () => void }. Do not import anything from packet 07 (it consumes YOUR component).
- Favorites are device-local (FavoriteStore in src/lib/favorites/store.ts) with schema versioning and storage-disabled fallbacks.
- Integrity test compares a downloaded fixture's SHA-256 with GalleryPhotoRecord.fileSha256 using local fixtures only; do not touch the real archive.
Run the non-build portion: npm run test -- tests/downloads/original-integrity.test.ts tests/downloads/selection.test.ts tests/favorites/store.test.ts. Report honestly.${SKIP_BUILD_NOTE}`,
  },
  {
    label: 'packet-10-moderation',
    prompt: `You are executing packet 10 (moderation and notifications).
${COMMON}
Your packet: ${PLAN}/packets/10-moderation-notifications.md (patched: notification history rendered in BatchReviewer, HEIC wasm decode path).
ADDITIONAL FACTS:
- MANDATORY FIRST READ: ${SPIKES}/heic-decode.md. heic-decode (wasm libheif) is installed; use it exactly as the note prescribes: decode HEIC to raw RGBA, pipe into sharp via raw input for derivatives. Decode failure surfaces a moderation error; never approve without a derivative.
- requireAdmin() comes from packet 04 as landed. Upload states and validation results come from packet 08 as landed; read src/lib/uploads/ first.
- Email: React Email templates + Resend client behind a test transport. Notification idempotency via notification_log idempotency_key. NEVER send a real email; no RESEND_API_KEY exists locally and that is correct.
- SENDER IDENTITY (Zach's decision, 2026-07-22): from address is "0719 + co. <wedding@rachandzach.com>", sender domain rachandzach.com (Resend verification pending DNS). Hardcode the identity in one config constant; sends stay disabled until the domain verifies and Zach approves outbound email.
- State machine transitions and retry-safety are the heart of this packet: approval retries must produce one photo, one preview set, one audit trail.
Run the non-build portion: npm run test -- tests/moderation/state-machine.test.ts tests/moderation/visibility.test.ts tests/notifications/idempotency.test.ts. Report honestly.${SKIP_BUILD_NOTE}`,
  },
]

const results = await parallel(packets.map(p => () =>
  agent(p.prompt, { label: p.label, phase: 'Build', schema: REPORT })
))

phase('Integrate')
log('Single integration pass: typecheck, full unit suite, one production build')
const integration = await agent(`You are the wave 4 integration check for ${REPO}.
${COMMON}
YOUR JOB (read-mostly; edit only to fix genuine seam breakage, list every edit):
1. npm run typecheck
2. npm run test (full unit suite)
3. npm run build ONCE, with the SYNTHETIC BUILD ENV exported as described above. Never weaken env validation to make it pass.
4. Verify the packet 07 <-> 09 Slideshow seam compiles against the pinned SlideshowProps contract; fix minimal drift if needed.
5. Grep for accidental service-role or raw private object path exposure in client components.
Report packet as "wave-4-integration" with the real combined output.`,
  { label: 'integration', phase: 'Integrate', schema: REPORT })

return { results: results.filter(Boolean), integration }
