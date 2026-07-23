export const meta = {
  name: 'wedding-home-wave-5-6',
  description: 'Waves 5 and 6 of the 0719 digital wedding home: packet 11 feature modules, then packet 12 QA/handoff decomposed into parallel workstreams plus one final verify',
  phases: [
    { title: 'Wave 5', detail: 'packet 11 feature-flagged modules' },
    { title: 'Wave 6 fan-out', detail: 'e2e specs, verification scripts, handoff docs in parallel' },
    { title: 'Final verify', detail: 'npm run verify + verify:catalog + verify:originals, HANDOFF_CURRENT.md' },
  ],
}

const REPO = '/Users/zsoskin/Downloads/rachandzach-gallery'
const PLAN = REPO + '/docs/plans/2026-07-22-0719-digital-wedding-home'

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
- Working directory: ${REPO}. NOT a git repository. Do not git init, do not commit. Document git/remote/Vercel connection as SEPARATE FUTURE APPROVAL STEPS wherever relevant.
- Waves 1-4 landed every packet except 11 and 12. Dependencies installed; package.json edits only if this prompt grants them. Playwright chromium and webkit browsers were already downloaded on this machine.
- Prebuilt pieces from earlier (do NOT recreate; verify and extend): docs/0719_Architecture_v1.md, docs/0719_Privacy_Operations_v1.md, docs/0719_Content_Needed_v1.md (drafts), scripts/vercel-ignore-build.mjs + vercel.json + tests/deploy/vercel-ignore-build.test.mjs (23 tests passing).
- NO Docker/container runtime, no local Postgres. Database-backed e2e flows run against mocks/fixtures or degrade loudly with the unblock command recorded.
- Wedding source master is READ-ONLY: /Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean (1,721 photos; catalog verification reads it read-only).
- HARD GATES: no deploy, no publish, no email, no cloud resources, no uploads to cloud storage, no production secrets, local only.
- ZACH DIRECTIVE: no visual photo review by agents.
- SYNTHETIC BUILD ENV: for any npm run build or npm run start, export the synthetic env first: GALLERY_PASSWORD_HASH (a REAL Argon2id hash of the synthetic password test-password-0719, generate with a @node-rs/argon2 one-liner), GALLERY_SESSION_SECRET (64 synthetic hex chars), and the synthetic Supabase values from .env.example. NEVER weaken, bypass, or delete env validation to make a build or server pass; build succeeds without secrets, runtime fails closed, by design.
- FIXTURES: new test fixtures go under tests/fixtures/<your-area>/ (e2e, verify). Treat tests/fixtures/shared/ as read-only. tests/fixtures/catalog.json and tests/fixtures/photos belong to packet 13.
- BOUNDED PLAYWRIGHT SUITE, exact definition both workstreams use verbatim: npx playwright test tests/e2e --project=chromium
RULES:
- Read ${PLAN}/manifest.md and the relevant packet FIRST. Consume interfaces as they actually landed (read real source).
- Tests first where applicable. Run real commands; paste real output. Status contract: DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT.
`

phase('Wave 5')
log('Packet 11: feature-flagged experience modules')
const p11 = await agent(`You are executing packet 11 (feature-flagged experience modules).
${COMMON}
Your packet: ${PLAN}/packets/11-feature-flagged-experiences.md
ADDITIONAL FACTS:
- Playlists, marathon, anniversary capsule, memory notes all launch DISABLED; missing content is expected and must not block DONE.
- Disabled modules have no navigation entry, no sitemap entry, no placeholder card; flag tests prove it.
- Receipt page: a batch ID without its receipt token reveals nothing.
- Shuffle: event diversity, no repeats until recent-history queue exhausts. Recently Added: approved guest photos only, home rail capped at 12.
Done-check: npm run test -- tests/modules/feature-flags.test.tsx tests/modules/submission-status.test.ts && npm run build. You are the only agent running; the build is yours to run.`,
  { label: 'packet-11-modules', phase: 'Wave 5', schema: REPORT })

phase('Wave 6 fan-out')
log('Packet 12 decomposed: e2e specs, verification scripts, docs/CI in parallel')

const w6 = await parallel([
  () => agent(`You are workstream A of packet 12 (production QA and handoff): the Playwright e2e suite.
${COMMON}
Your packet: ${PLAN}/packets/12-production-qa-handoff.md. You own ONLY: tests/e2e/access.spec.ts, gallery.spec.ts, uploads.spec.ts, downloads.spec.ts, admin.spec.ts, accessibility.spec.ts, visual.spec.ts, plus a playwright.config.ts if none exists.
- Synthetic fixtures only: synthetic images, synthetic people, never real guest emails. Browsers already installed (chromium, webkit). Mobile viewport project at 390x844 plus 1440x1024 and 1024x768.
- The app needs a running server: use Playwright webServer with a production build and serve, with the SYNTHETIC BUILD ENV set. Run your production build ONCE at the start; if it fails on a transient package.json read (workstream B edits scripts in parallel), retry once before reporting.
- Name your Playwright projects so the bounded-suite command in COMMON works exactly as written (a project named chromium plus whatever else you add).
- Flows that need a live database: drive them against the app's mock/fixture seams where they exist; where impossible without Docker, mark the spec test.fixme with the exact unblock note rather than faking a pass.
- Accessibility spec uses @axe-core/playwright, WCAG AA.
Run what runs: npx playwright test --list first to prove collection, then run the specs that can execute. Report packet as "12A-e2e" honestly.`,
    { label: '12A-e2e', phase: 'Wave 6 fan-out', schema: REPORT }),
  () => agent(`You are workstream B of packet 12 (production QA and handoff): verification and cost scripts.
${COMMON}
Your packet: ${PLAN}/packets/12-production-qa-handoff.md. You own ONLY: scripts/verify-original-integrity.mjs, scripts/verify-gallery-catalog.mjs, scripts/estimate-storage-egress.mjs, and their npm script wiring (verify:originals, verify:catalog; you MAY edit package.json scripts only, nothing else in it).
- verify-gallery-catalog.mjs: reconcile clean-master CSV against the local catalog (src/generated/gallery-v2.json and, when a DB exists, the photos table). Read-only on the master.
- verify-original-integrity.mjs: recompute SHA-256 over SAMPLED source originals (default --sample 100) and compare with recorded file_sha256, plus compare catalog rows against REMOTE object metadata (size + sha metadata via SQL/API, never downloading objects back). Full-archive mode exists behind --full for manual launch-day use only; automated verification always samples. Zero mismatches expected in samples.
- estimate-storage-egress.mjs: plan rates as INPUTS (flags or a rates.json), never hardcoded truth; model preview egress under hourly signed URL rotation plus a longer-TTL scenario; output a table.
- Wire npm run verify to: typecheck, lint, unit tests, build (with synthetic env documented in the script or README), and the bounded Playwright suite EXACTLY as defined in COMMON: npx playwright test tests/e2e --project=chromium (workstream A owns the specs; reference them, do not create them).
- Also fix the embeddings:import npm script to: uv run --python 3.12 scripts/build-embeddings.py (it currently points at bare python3, which is 3.14 and broken for transformers).
Run: npm run verify:catalog and npm run verify:originals -- --sample 25 for real, paste output. Report packet as "12B-verify" honestly.`,
    { label: '12B-verify', phase: 'Wave 6 fan-out', schema: REPORT }),
  () => agent(`You are workstream C of packet 12 (production QA and handoff): CI, headers, and handoff docs.
${COMMON}
Your packet: ${PLAN}/packets/12-production-qa-handoff.md. You own ONLY: .github/workflows/ci.yml, docs/0719_Launch_Checklist_v1.md, finalizing the three existing draft docs (Architecture, Privacy_Operations, Content_Needed: update to match landed reality, remove DRAFT marker only if accurate), README.md updates, and the headers portion of vercel.json (immutable preview headers, no-store for signed-URL/auth endpoints; keep the existing ignoreCommand untouched).
- ci.yml runs npm run verify on push to main/staging/preview branches; note the repo is not yet on GitHub and CI activates only after the separate git/remote approval.
- docs/0719_Launch_Checklist_v1.md: every remaining human approval as a checklist (from the manifest end-review list plus reality), each with its exact command or action. Include a manual pre-launch item: run Lighthouse on a representative protected page (mobile, targets >= 90 accessibility / 85 performance); it is deliberately not automated in this environment.
- No em dashes in prose anywhere.
Verify: node --check on any scripts you touch, JSON-validate vercel.json, and confirm docs reference only files that exist. Report packet as "12C-docs" honestly.`,
    { label: '12C-docs', phase: 'Wave 6 fan-out', schema: REPORT }),
])

phase('Final verify')
log('Single final agent: npm run verify, catalog + originals verification, HANDOFF_CURRENT.md')
const finalVerify = await agent(`You are the final verification and handoff agent for the whole build.
${COMMON}
YOUR JOB:
1. Run npm run verify (typecheck, lint, unit tests, build, bounded e2e). Fix nothing except trivial seam breakage; list every edit.
2. Run npm run verify:catalog and npm run verify:originals -- --sample 100. Paste real numbers.
3. Serve the production build locally (npm run start) WITH the SYNTHETIC BUILD ENV exported, and smoke-check: / renders, /photos redirects unauthenticated to /enter, robots.txt and sitemap exclude protected routes. Use curl, not a browser, no visual review. If the server refuses to start with synthetic env set, that is a packet 04 bug to report, not an env check to delete.
4. Write docs/HANDOFF_CURRENT.md: packet-by-packet status table (pull from ${PLAN}/reports/ if present, otherwise from what you can verify), exact commands, performance/test numbers, schema state, NOT DEPLOYED status, every remaining human approval (Docker install, Supabase project, password, sender domain, hero approval, playlists/marathon content, git/remote/Vercel connection, launch).
5. Stop. No deploy, no git init, no email, no cloud.
Report packet as "final-verify" with the honest bottom line.`,
  { label: 'final-verify', phase: 'Final verify', schema: REPORT })

return { p11, w6: w6.filter(Boolean), finalVerify }
