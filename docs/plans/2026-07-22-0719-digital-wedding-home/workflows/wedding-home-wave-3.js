export const meta = {
  name: 'wedding-home-wave-3',
  description: 'Wave 3 of the 0719 digital wedding home: packet 06 gallery discovery + packet 08 guest uploads in parallel, then one integration build',
  phases: [
    { title: 'Build', detail: 'packets 06 and 08 in parallel, tests only' },
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
- Waves 1 and 2 landed: packet 01 (tokens/content/brand), 02 (importer + src/types/gallery.ts), 03 (supabase migrations + src/lib/supabase/), 04 (guest/admin auth, default-deny proxy.ts, requireGalleryAccess/requireAdmin), 05 (public site), 13 (sync). Dependencies installed; package.json is NOT yours to edit.
- NO Docker/container runtime and no local Postgres: anything needing a live database runs against mocks/fixtures and degrades loudly.
- Wedding source master is READ-ONLY: /Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean.
- HARD GATES: no deploy, no publish, no email, no cloud resources, no uploads to cloud storage, no production secrets, local only.
- ZACH DIRECTIVE: no visual photo review. Never open images to judge them.
- SYNTHETIC BUILD ENV: if you ever run npm run build or npm run start, export the synthetic env first: GALLERY_PASSWORD_HASH (a REAL Argon2id hash of the synthetic password test-password-0719, generate with a @node-rs/argon2 one-liner), GALLERY_SESSION_SECRET (64 synthetic hex chars), and the synthetic Supabase values from .env.example. NEVER weaken, bypass, or delete env validation to make a build or server pass; build succeeds without secrets, runtime fails closed, by design.
- FIXTURES: new test fixtures go under tests/fixtures/<your-area>/ (gallery, uploads). Treat tests/fixtures/shared/ as read-only (synthetic JPEG/PNG/WebP/HEIC with manifest.json live there; reuse them). tests/fixtures/catalog.json and tests/fixtures/photos belong to packet 13.
RULES:
- Read ${PLAN}/manifest.md and your packet file FIRST.
- Consume upstream interfaces as they ACTUALLY landed: read the real source files, do not trust packet prose. Trivial drift: adapt. Real mismatch: NEEDS_CONTEXT with specifics.
- Touch ONLY files your packet owns. Another packet runs in parallel with you in this working tree.
- Tests first, then implement until green.
- Status contract: DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT.
`

// NOT in COMMON on purpose: COMMON is also injected into the Integrate
// agent's prompt below, and a shared "do NOT run npm run build" line makes
// that agent read it as a self-instruction and skip its own required build
// (this actually happened on the first live run of this script; the build
// was recovered manually afterward). Only the two packet-builder prompts
// get this line, appended per-prompt.
const SKIP_BUILD_NOTE = `
IMPORTANT deviation from your packet's done-check: do NOT run npm run build (a sibling agent is running concurrently; the integration phase runs the single build). Run only the test portion of your done-check and say so in doneCheckOutput.`

phase('Build')
log('Fanning out packets 06 and 08')

const packets = [
  {
    label: 'packet-06-gallery',
    prompt: `You are executing packet 06 (gallery discovery and lightbox).
${COMMON}
Your packet: ${PLAN}/packets/06-gallery-discovery-lightbox.md
ADDITIONAL FACTS:
- Read ${SPIKES}/platform-apis.md for verified batch signed URL APIs before writing src/lib/gallery/signed-previews.ts.
- The patched contract includes: ids: string[] | null (max 100, exact-order lookup) on GalleryQueryInput, getGalleryFacets() via live group-by over approved photos, preview TTL as one tunable constant defaulting to 60 minutes.
- Query layer tests run against a mocked/fixture Supabase client (no live DB). Design src/lib/gallery/query.ts so the data boundary is injectable. A 1,721-photo synthetic fixture must page without duplicates or gaps; pending fixtures never appear.
- Virtualization uses @tanstack/react-virtual (installed). Justified-row layout math lives in src/lib/gallery/layout.ts with deterministic tests.
- requireGalleryAccess() comes from packet 04 as landed; read src/lib/auth/ first.
- You ALSO own src/app/(guest)/layout.tsx (the shared guest shell); packet 08 is prohibited from creating or editing it.
- Never expose original object paths or service keys to the client.
Run the test portion only: npm run test -- tests/gallery/query.test.ts tests/gallery/layout.test.ts. Report honestly.${SKIP_BUILD_NOTE}`,
  },
  {
    label: 'packet-08-uploads',
    prompt: `You are executing packet 08 (resumable guest uploads).
${COMMON}
Your packet: ${PLAN}/packets/08-resumable-guest-uploads.md
ADDITIONAL FACTS:
- MANDATORY FIRST READ: ${SPIKES}/tus-auth.md (verified TUS authorization decision: signed TUS token flow via createSignedUploadUrl token + x-signature at the /upload/resumable/sign endpoint, chunkSize exactly 6MB) and ${SPIKES}/heic-decode.md (HEIC handling). Implement the recommended paths; if a note is missing or inconclusive, do the packet's spike step yourself against live docs (load WebFetch via ToolSearch) before writing upload code.
- HEIC SCOPE FOR THIS PACKET (pinned by review): submit-time validation is magic-byte sniffing ONLY (ftyp + heic/heix/hevc/hevx/mif1/msf1 brands per the spike note). Full HEIC decode happens at approval time in packet 10, next wave. Do NOT import heic-decode here; it is not installed yet.
- BUCKET NAMES as landed carry the rachandzach- prefix (rachandzach-guest-pending is your quarantine bucket); where the packet or spike notes say guest-pending, map to the landed names in src/lib/supabase/.
- Uppy packages and tus-js-client are installed. requireGalleryAccess() and rate limiting come from packet 04 as landed; upload_batches/upload_items and clients come from packet 03 as landed. Read those source files first.
- No live DB or storage locally: server route logic is tested with mocked Supabase clients; the TUS client flow is exercised with a mock TUS endpoint (a local http server in the test). State clearly in concerns what remains unproven until Docker exists.
- src/app/(guest)/layout.tsx is owned by packet 06 (parallel sibling); do NOT create or edit it.
- Validation rules in the packet are binding: JPEG/PNG/WebP/HEIC only, magic-byte checks, 50 files/batch, 50MB/file, object path pending/{batchId}/{itemId}/{randomNonce}, never upsert, receipt tokens hashed before storage.
Run the test portion only: npm run test -- tests/uploads/contracts.test.ts tests/uploads/status-isolation.test.ts. Report honestly.${SKIP_BUILD_NOTE}`,
  },
]

const results = await parallel(packets.map(p => () =>
  agent(p.prompt, { label: p.label, phase: 'Build', schema: REPORT })
))

phase('Integrate')
log('Single integration pass: typecheck, full unit suite, one production build')
const integration = await agent(`You are the wave 3 integration check for ${REPO}.
${COMMON}
YOUR JOB (read-mostly; you may only edit files to fix genuine integration breakage, and every edit must be listed):
1. Safety net: if src/lib/redirects.ts still carries an unmerged packet 05 integration note (wave 2 should have merged it), merge its entries into next.config.ts redirects() and rerun tests/content/public-routes.test.tsx.
2. npm run typecheck
3. npm run test (full unit suite)
4. npm run build ONCE, with the SYNTHETIC BUILD ENV exported as described above. Never weaken env validation to make it pass.
5. If something fails at a seam between packets (import path drift, type mismatch), make the minimal fix, note exactly what and why in summary, and rerun.
6. Confirm no route exposes service-role keys or raw private object paths (grep the built route code under src for obvious leaks).
Report packet as "wave-3-integration" with the real combined output.`,
  { label: 'integration', phase: 'Integrate', schema: REPORT })

return { results: results.filter(Boolean), integration }
