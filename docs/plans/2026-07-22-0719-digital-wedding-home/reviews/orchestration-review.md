# Orchestration review: staged waves 2 through 6

Reviewed 2026-07-22, before wave 2 launch. Inputs: manifest.md, all 13 packets, all 4 staged wave scripts, all 4 spike notes, plus the live repo state (package.json, vitest.config.ts, next.config.ts, vercel.json, tests/, docs/, src/) and the external assets the prompts reference.

## Recommendation

Do not launch wave 2 as staged. Two defects will fire with near certainty: the packet 04 fail-closed build contract breaks every later `npm run build` that lacks synthetic env values (findings 1), and wave 2 runs whole-tree builds and typechecks in parallel with agents mid-edit, the exact problem waves 3 and 4 already solved (finding 2). Fix findings 1 through 5 in the wave scripts and packets before running; findings 6 through 12 are cheap one-line prompt patches worth applying in the same pass. Interface claims in the wave prompts otherwise trace cleanly to packet promises, and every environment fact asserted in the COMMON blocks checked out true on this machine.

## Findings, ranked

### 1. HIGH: Packet 04's build-time fail-closed contract contradicts every later build done-check

- Files: packets/04-guest-admin-access.md (done-check), workflows/wedding-home-wave-2.js (packet 05 done-check), wave-3.js and wave-4.js (integration prompts), wave-5-6.js (packet 11 done-check, final-verify)
- Quote (packet 04 expected): "Starting a production build without required credentials fails with a clear configuration error."
- Quote (packet 05, same wave, parallel): "run the done-check (npm run test -- tests/content/public-routes.test.tsx && npm run build)"
- Failure scenario: Packet 04 lands env validation that makes `next build` fail when GALLERY_PASSWORD_HASH and GALLERY_SESSION_SECRET are absent. They are absent locally by design (no production secrets). Packet 05's parallel build then fails through no fault of its own. Worse, the wave 3 and wave 4 integration agents, instructed to "fix genuine integration breakage" to get typecheck, tests, and one build green, have exactly one obvious edit available: weaken or delete the fail-closed check. That silently destroys the packet 04 security contract while looking like a seam fix. Wave 5's packet 11 build and the final-verify `npm run start` smoke hit the same wall. Only wave 6 workstream A mentions synthetic env values; nothing else does.
- Minimal fix: two edits. (a) In the wave 2 packet 04 prompt, pin the semantics: fail closed at runtime (server start or first auth code path), with `next build` succeeding; or, if build-time failure is truly wanted, define it as an explicit env-validation script, not a broken build. (b) Add one shared line to the COMMON block of waves 2 through 5 and the final-verify prompt: "For any npm run build or npm run start, set the documented synthetic env values (GALLERY_PASSWORD_HASH=<argon2 hash of a synthetic password>, GALLERY_SESSION_SECRET=<32 synthetic bytes>, synthetic SUPABASE URLs and keys) exactly as wave 6 workstream A does. Never weaken env validation to make a build pass."

### 2. HIGH: Wave 2 has no build/typecheck serialization and no integration phase

- File: workflows/wedding-home-wave-2.js
- Quote (packet 05 prompt): "run the done-check (... && npm run build)"; quote (packet 04 prompt): "run the done-check (... && npm run typecheck)". Compare wave 3 COMMON: "do NOT run npm run build (a sibling agent is running concurrently; the integration phase runs the single build)."
- Failure scenario: `next build` and `tsc --noEmit` scan the whole tree. Packet 05's build runs while packet 04 is mid-deleting middleware.ts, replacing src/lib/session.ts, and editing next.config.ts, and while packet 13 is mid-writing src/lib/import/. A half-written sibling file fails 05's build or 04's typecheck; the failing agent then either edits a file it does not own to unblock itself or reports a false BLOCKED. Waves 3 and 4 solved this exact hazard; wave 2 skipped the pattern.
- Minimal fix: mirror waves 3 and 4 in wedding-home-wave-2.js. Build-phase prompts run only their own test subsets (04: auth tests; 05: public-routes test; 13: unchanged, its done-check has no build). Add an Integrate phase agent that runs `npm run typecheck`, full `npm run test`, and the single `npm run build` (with the synthetic env from finding 1), and performs the redirects merge from finding 3.

### 3. MEDIUM-HIGH: The legacy-redirects merge is homeless

- Files: workflows/wedding-home-wave-2.js (packet 05 prompt), packets/05-public-site-weekend-story.md (route contract)
- Quote: "write your redirect entries to src/lib/redirects.ts as data and add a one-line integration note in your report for the orchestrator to merge into next.config.ts afterward. Do not edit next.config.ts yourself."
- Failure scenario: no staged step ever performs the merge. Packet 04 owns next.config.ts but is never told a redirects map may be waiting; the wave 3 integration prompt does not mention it. /overview, /schedule-1, /gallery, /faq-1, and /travel silently never redirect. First possible detection is wave 6 e2e, four waves later, where it either fails late or gets test.fixme'd and shipped to handoff as broken.
- Minimal fix: one instruction in the new wave 2 Integrate agent (or, failing that, the wave 3 integration prompt): "If src/lib/redirects.ts exists with a packet 05 integration note, merge its entries into next.config.ts redirects() and rerun tests/content/public-routes.test.tsx."

### 4. MEDIUM-HIGH: The Slideshow props contract does not exist anywhere

- Files: workflows/wedding-home-wave-4.js (packet 07 prompt), packets/09-downloads-favorites-slideshow.md
- Quote (wave 4, packet 07): "code against its documented props contract from ${PLAN}/packets/09-downloads-favorites-slideshow.md". But packet 09's only "contract" is prose: "Build Slideshow as a generic component that accepts any ordered photo list and a mode label." No prop names, no types, nothing in packet 09's Interfaces section.
- Failure scenario: packets 07 and 09 run in parallel and each invents the shape (photos vs items vs list; modeLabel vs title; GalleryPhotoView vs a slimmer type; interval and caption props or not). The integration agent is told to "fix minimal drift," but with no written contract there is no arbiter, and the "adapt to landed reality" rule invites packet 07 to wrap or fork the component instead of surfacing the mismatch.
- Minimal fix: add an exact signature to packet 09's Interfaces section, for example `SlideshowProps { photos: GalleryPhotoView[]; modeLabel: string; startIndex?: number; intervalMs?: number; onClose?: () => void }`, and quote that same block verbatim in the wave 4 packet 07 prompt.

### 5. MEDIUM: heic-decode boundary install is one wave late, is performed by nobody, and omits @types/heic-decode

- Files: workflows/wedding-home-wave-4.js (COMMON), workflows/wedding-home-wave-3.js (packet 08 prompt), packets/08-resumable-guest-uploads.md, spikes/heic-decode.md
- Quote (wave 4 COMMON): "Dependencies installed, including heic-decode; package.json is NOT yours to edit." Quote (packet 08, wave 3): "Validate uploaded bytes with a decoder job before a batch can enter submitted. HEIC validation decodes via wasm libheif; stock sharp cannot read HEIC."
- Failure scenario: three parts. (a) Packet 08 runs in wave 3, where heic-decode is not yet installed and "Missing dep = concern, not an install" applies, so it either stubs HEIC decode against its own binding step or burns time on NEEDS_CONTEXT. (b) No staged script actually runs the install; wave-4.js simply asserts it happened. If the orchestrator forgets, packet 10 stubs the decode path and the contract break is masked as a concern line. (c) The spike explicitly requires `npm i -D @types/heic-decode`; without it, packet 10's `import decode from 'heic-decode'` fails strict typecheck in wave 4 integration, and the integration agent's cheapest "seam fix" is a hand-rolled d.ts or a ts-ignore.
- Minimal fix: amend the wave 3 packet 08 prompt to match the spike's actual recommendation: "At submit time do magic-byte sniffing only (sniffImage per heic-decode.md); full HEIC decode happens at approval in packet 10. Do not import heic-decode in this packet." Then add an explicit preflight step (in wedding-home-wave-4.js before fan-out, or the orchestrator runbook) that runs `npm i heic-decode && npm i -D @types/heic-decode` at the wave 3 to 4 boundary.

### 6. MEDIUM: msw is named first in the packet 08 prompt but is not installed and never will be

- File: workflows/wedding-home-wave-3.js (packet 08 prompt)
- Quote: "the TUS client flow is exercised with a mock TUS endpoint (msw or a local http server in the test)."
- Failure scenario: msw is not in package.json, package.json is off-limits, and no boundary install flags it. An agent following the prompt's first-listed option hits the missing-dep wall and thrashes before falling back. The fallback works, so this is friction, not breakage.
- Minimal fix: delete "msw or" from the prompt, leaving "a local http server in the test", or add msw to the finding 5 boundary install.

### 7. MEDIUM: Wave 6 fan-out races workstream A's production build against workstream B's package.json edits, and the "bounded Playwright suite" is undefined

- File: workflows/wedding-home-wave-5-6.js
- Quote (A): "use Playwright webServer with a production build and serve"; quote (B): "you MAY edit package.json scripts only" and "Wire npm run verify to: typecheck, lint, unit tests, build, and the bounded Playwright suite (workstream A owns the specs; reference them, do not create them)."
- Failure scenario: A builds and runs e2e while B is editing package.json in the same tree, the exact npm-run concurrency that waves 3 and 4 forbid. Separately, "bounded Playwright suite" has no definition: B must guess A's spec naming and projects while A is still writing them, so `npm run verify` can reference a command shape A never produced, and the mismatch surfaces only in final-verify.
- Minimal fix: pin the invocation verbatim in both prompts (for example `playwright test tests/e2e --project=chromium`), and add to A: "run your production build once at the start; if it fails on a transient package.json read, retry once."

### 8. MEDIUM: final-verify's serve-and-curl smoke needs the synthetic env and is not given it

- File: workflows/wedding-home-wave-5-6.js (final-verify prompt)
- Quote: "Serve the production build locally (npm run start) and smoke-check: / renders, /photos redirects unauthenticated to /enter".
- Failure scenario: with fail-closed credentials absent, the server refuses to start or 500s instead of redirecting. The final agent reports BLOCKED at the last step of the whole build, or worse, edits env validation under its "fix trivial seam breakage" license. Workstream A got the synthetic-env instruction; final-verify did not.
- Minimal fix: copy A's line into the final-verify prompt: "with fail-closed env vars set to synthetic test values." (Subsumed by the finding 1 COMMON fix if applied globally.)

### 9. LOW-MEDIUM: src/app/(guest)/layout.tsx has no owner and two same-wave creators

- Files: packets/06-gallery-discovery-lightbox.md, packets/08-resumable-guest-uploads.md (wave 3); packets/07 and 09 (wave 4)
- Quote: packet 06 creates "src/app/(guest)/photos/page.tsx"; packet 08 creates "src/app/(guest)/add-yours/page.tsx". Neither file list includes src/app/(guest)/layout.tsx.
- Failure scenario: both wave 3 agents plausibly decide the route group needs a shared layout (guest nav, session boundary) and create it simultaneously; ownership rules say neither may, so either a collision or a missing shell. In wave 4, packets 07 and 09 both add (guest) routes and may both try to add their nav entry to the file.
- Minimal fix: one line in the wave 3 packet 06 prompt: "You also own src/app/(guest)/layout.tsx; packet 08 must not create or edit it." Mirror the prohibition in the 08, 07, and 09 prompts; nav entries for later routes are integration-agent work.

### 10. LOW: fixture namespace convention exists on disk but not in the prompts

- Files: workflows wave-2 through wave-5-6 (COMMON blocks); tests/fixtures/shared/ (already landed from wave 1)
- Quote (packet 13 done-check): "--catalog tests/fixtures/catalog.json --source tests/fixtures/photos" (root-level generic names).
- Failure scenario: 06 and 08 (wave 3), then 07, 09, 10 (wave 4) all add fixtures with no assigned directories; two same-wave agents writing generic names (a synthetic image, an index helper) at the fixtures root collide, and later packets mutating tests/fixtures/photos break packet 13's rerunnable done-check.
- Minimal fix: one COMMON line per wave: "New fixtures go under tests/fixtures/<your-area>/ (gallery, uploads, search, downloads, moderation). Treat tests/fixtures/shared/ as read-only."

### 11. LOW: the Lighthouse acceptance target has no tool, no owner, and no install flag

- File: packets/12-production-qa-handoff.md (acceptance matrix); workflows/wedding-home-wave-5-6.js
- Quote: "mobile Lighthouse targets of at least 90 accessibility and 85 performance on a representative protected page."
- Failure scenario: lighthouse is not in package.json, no workstream is told to measure it, and no boundary install is flagged; final-verify can report the acceptance matrix satisfied with this row silently untested.
- Minimal fix: either add lighthouse to a boundary install and assign the measurement to final-verify, or move the row into docs/0719_Launch_Checklist_v1.md as a manual pre-launch check (workstream C's file).

### 12. LOW: packet 07's python invocation still points at Python 3.14 in two places

- Files: packets/07-my-weekend-moment-search.md (done-check: "python3 scripts/build-embeddings.py"), package.json ("embeddings:import": "python3 scripts/build-embeddings.py")
- Failure scenario: bare python3 is 3.14.3 on this machine, where transformers has the documented import bug the spike pins away from. The wave 4 prompt's "prefer uv with Python 3.12" note covers the agent's own run (uv is present, verified), but an agent following the packet's literal done-check or the npm script wastes a failure loop, and the stale npm script survives into handoff.
- Minimal fix: in the wave 4 packet 07 prompt, replace the fixture-verify command with `uv run --python 3.12 scripts/build-embeddings.py --fixture tests/fixtures/search --verify`; assign the `embeddings:import` script correction to workstream B's package.json scripts pass.

## Areas checked and clean

- Interface drift, everything else: every hardcoded claim in the wave prompts traces to an actual packet promise. Checked pairwise: GalleryQueryInput.ids max 100 exact-order (06 patched, consumed by 09), getGalleryFacets live group-by (06), PUBLIC_ROUTES export from src/lib/auth/guest-session.ts (04), consume_rate_limit signature (03 to 04), requireGalleryAccess/requireAdmin (04 to 06/08/09/10), upload states list (08 to 10), getUploadStatus (08 to 11), getGalleryPage/getPhotoDetail (06 to 07/09/11), migration filename 202607220003 (07), src/generated/gallery-v2.json (02 to 12B). Only the Slideshow contract (finding 4) failed this trace.
- Shared test config: vitest.config.ts already routes tests/**/*.test.ts and .test.mjs to the node environment and .test.tsx to jsdom, excluding tests/e2e. Every staged test filename lands in the correct environment by extension; no packet needs to touch vitest.config.ts.
- globals.css and src/app/layout.tsx: single owner per wave (01 in wave 1, 05 in wave 2); no same-wave contention.
- src/lib barrels: no packet creates or shares an index barrel; module paths are disjoint per packet.
- next.config.ts wave 2 contention: explicitly handled in the wave 2 packet 05 prompt (except the merge gap, finding 3).
- npm-run-build serialization in waves 3, 4, and 5: correctly handled (test-only fan-out, single integration build; packet 11 runs solo).
- Environment facts asserted in COMMON blocks, all verified true on this machine: node v26.3.0, npm 11.16.0, no Docker assumption consistent, Python 3.14.3 with uv present, Playwright chromium and webkit browsers downloaded, sitemap PDF and clean-master CSV exist at the quoted paths, docs drafts and tests/deploy/vercel-ignore-build.test.mjs and vercel.json ignoreCommand all present, 071925 literals confirmed in exactly the two files the wave 2 prompt names (src/app/api/login/route.ts, src/lib/session.ts).
- Dependency scan beyond findings 5, 6, 11: all other packages named by packets 04 through 12 are already in package.json (@node-rs/argon2, sharp, @tanstack/react-virtual, @huggingface/transformers 4.2.0, Uppy trio, tus-js-client, @zip.js/zip.js, resend, @react-email/components, @playwright/test, @axe-core/playwright, exifr, zod).
- Hard gates: consistently restated in every COMMON block; packet 13 dry-run done-check touches no network; no staged step deploys, emails, or creates cloud resources.
- Transitional orphan, noted not flagged: after wave 2 deletes /api/login, the old LoginScreen.tsx and GalleryApp.tsx are dead code until packet 06 replaces them in wave 3; harmless to build and typecheck, and integration agents should leave them alone.
