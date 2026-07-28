# 0719 + co. -- Rachel & Zach's private photo archive

A private, password-gated wedding photo archive: browse the full catalog, find
yourself by event or person, search moments in plain language, keep favorites,
save original photographs to your own cloud account, and contribute new photos
for approval. Built with Next.js and Supabase. Guests and admin both
authenticate; nothing here is public except the marketing pages.

**Status: LIVE.** The premium gallery is deployed on Vercel at
[rachandzach.com](https://rachandzach.com), backed by this private GitHub
repository and the reconciled 1,721-photo Supabase catalog. Start with
`docs/ONLINE_HANDOFF.md` for the current production, branch, DNS, environment,
and continuation state. Older planning documents, including the explicitly
historical `docs/HANDOFF_CURRENT.md`, remain useful history, but their
pre-launch status language is superseded by that live handoff.

## Stack

Next.js 16.2.x (App Router, Turbopack), React 19.2.x, TypeScript 5.9.x, Tailwind CSS 4, Supabase Postgres and private Storage, Supabase Auth (admin magic links), Uppy/TUS (resumable guest uploads), Resend + React Email (notifications), Vitest, Playwright, axe-core. Full architecture, data flow, and auth model: `docs/0719_Architecture_v1.md`.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in real values for local Supabase dev, see below
npm run dev                  # http://localhost:3000
```

`npm run dev` and `npm run test` do not require Supabase credentials to start; routes that touch the database fail closed with a clear error until they're configured. A full local stack (`supabase start`) requires Docker, which is not installed on this development machine as of this writing -- see `docs/0719_Content_Needed_v1.md`.

### Environment variables

Copy `.env.example` to `.env.local` and fill in real values for local development. Every value in `.env.example` is a placeholder; production credentials are never committed and fail closed if missing (no fallback passwords or session secrets, by design -- see `docs/0719_Privacy_Operations_v1.md`).

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-side Supabase client |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-only admin client; never sent to the browser |
| `SUPABASE_DB_URL` | Optional direct Postgres access for local tooling |
| `GALLERY_PASSWORD_HASH` | Argon2id hash of the shared guest password. Generate with `node -e "require('@node-rs/argon2').hash('the-password').then(console.log)"` -- never store the plaintext |
| `GALLERY_SESSION_SECRET` | At least 32 random bytes: `openssl rand -hex 32` |
| `SOURCE_PHOTO_DIR` | Read-only path to the wedding master catalog source, used only by import scripts |
| `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` | Optional public Google Web OAuth client ID; enables Google Drive save |
| `NEXT_PUBLIC_DROPBOX_APP_KEY` | Optional public Dropbox Saver app key; enables Dropbox save |

Both public provider identifiers are configured in Vercel Production and
Preview. They remain optional for local development, and their values must not
be copied into source control or printed in logs.

Real production values (guest password, Supabase project keys) are staged in `.env.cloud` at the repo root, which is gitignored and never auto-loaded by Next -- see `docs/0719_Content_Needed_v1.md` for what's decided and `docs/0719_Launch_Checklist_v1.md` for how they get into Vercel.

## Scripts

Development:
- `npm run dev` / `npm run build` / `npm run start` -- Next.js dev server, production build, production server
- `npm run typecheck` / `npm run lint` -- `tsc --noEmit` / ESLint
- `npm run test` / `npm run test:watch` -- Vitest (unit and component tests under `tests/`)
- `npm run e2e` -- Playwright, all projects (chromium, webkit, tablet, mobile viewports)

Verification (packet 12):
- `npm run verify` -- the full local gate: typecheck, lint, unit tests, a production build with a synthetic environment, then the bounded e2e suite (`playwright test tests/e2e --project=chromium`)
- `npm run verify:catalog` -- reconciles the read-only clean-master manifest against the local catalog; an optional `-- --db-env-file <file>` may target a loopback Supabase stack only
- `npm run verify:originals` -- sampled SHA-256 integrity check of local source files against the catalog; its optional metadata check is also loopback-only and intentionally rejects cloud credentials
- `npm run verify:egress` -- storage/egress cost estimator, takes current plan rates as input rather than hardcoding prices

The reproducible live Supabase and deployed-domain checks are documented in
`docs/ONLINE_HANDOFF.md`; the two media commands above are deliberately local.

Face tagging (local only, never deployed):
- `npm run tag` -- opens the face naming tool at **http://127.0.0.1:4310/**, bound to loopback so only this machine can reach it. Keyboard-driven, decisions save as you go. Full guide, shortcuts, and the post-session steps: `docs/FACE_TAGGING_TOOL.md`

Import and sync (read-only against the source; writes are opt-in and explicit):
- `npm run gallery:import` -- builds the catalog from the read-only wedding master (`scripts/build-gallery-v2.mjs`)
- `npm run embeddings:import` -- generates local CLIP embeddings for Moment Search (`uv run --python 3.12`)
- `node scripts/sync-gallery-storage.mjs` / `node scripts/sync-gallery-catalog.mjs` -- dry-run by default; real cloud writes require both `--execute` and an explicit `--project-ref` on the allowlist
- `npm run types:generate` -- regenerates `src/lib/supabase/database.types.ts` from a local Supabase stack

See each script's own `--help` for its full flag set.

## Testing

- Unit and component tests: `npm run test` (Vitest, `tests/**/*.test.{ts,tsx,mjs}`, excludes `tests/e2e/`)
- End-to-end: `npm run e2e` for the full cross-browser/viewport matrix, or `npx playwright test tests/e2e --project=chromium` for the bounded suite `npm run verify` runs. The e2e suite is designed to run without a live database: most specs assert on documented fail-closed behavior against an unreachable synthetic Supabase endpoint (see `tests/e2e/support/env.ts`); a smaller set of specs are explicitly out of scope until a live database exists.
- A local Supabase stack (`supabase start && supabase db reset`) requires Docker, not available on this development machine as of this writing; the schema test layer degrades to static SQL assertions without it and says so loudly when run.

Current test health: fully green at the premium archive release head.
`npm run verify` exits 0: typecheck passes; lint reports 0 errors and 14
existing warnings; Vitest passes 947 tests with 11 intentional live-database
skips; the production build passes; and the bounded Chromium e2e suite passes
80 tests with 28 documented skips and 0 failures. Current release evidence is in
`docs/ONLINE_HANDOFF.md`.

## Project structure

```
src/app/          Next.js App Router routes: (public), (access), (guest), admin, api
src/components/    UI components by feature area (gallery, uploads, favorites, slideshow, site, admin)
src/lib/           Server logic: auth, gallery queries, uploads, downloads, moderation, search, supabase clients
src/content/       Site copy and structured content (siteConfig, story photos, feature flags)
supabase/          Postgres migrations and storage policies (rachandzach_ / rachandzach- prefixed, shared project)
scripts/           Import, sync, and verification scripts (see Scripts above)
tests/             Unit/component tests (Vitest) and e2e specs (Playwright, tests/e2e/)
docs/              Architecture, privacy, content-needed, and launch-checklist docs (below)
docs/plans/2026-07-22-0719-digital-wedding-home/   The build plan: manifest, per-task packets, and integration reviews
```

## Documentation

- `AGENTS.md` -- concise operating rules, product truth, code map, protected-data boundaries, verification commands, and deployment behavior for coding agents
- `docs/ONLINE_HANDOFF.md` -- **read this one first.** Canonical production state, release evidence, next-step owners and dates, provider activation, and continuation commands
- `docs/HANDOFF_CURRENT.md` -- historical pre-launch build, media, and reconciliation record
- `docs/0719_Architecture_v1.md` -- system design: stack, data flow, storage buckets, table model, auth, import/sync pipeline, moderation state machine, feature flags, and current known issues
- `docs/0719_Privacy_Operations_v1.md` -- every privacy commitment and exactly how it's enforced
- `docs/BACKLOG.md` -- known unshipped work: audited mobile/touch issues, guest-journey gaps, and technical debt, each with the file to look at and why it matters
- `docs/FACE_TAGGING_TOOL.md` -- the local face naming tool: `npm run tag`, served at **http://127.0.0.1:4310/**, plus keyboard shortcuts, where answers are written, and the commands to run afterwards
- `docs/0719_Content_Needed_v1.md` -- everything still waiting on Zach (content, approvals, decisions) plus engineering findings discovered during integration
- `docs/0719_Launch_Checklist_v1.md` -- historical pre-launch checklist; superseded operationally by `docs/ONLINE_HANDOFF.md`
- `docs/0719_Round_Two_Features_v1.md` -- every round-two feature shipped on top of the original plan, plus what's still a fast-follow
- `docs/0719_Supabase_Decision_v1.md`, `docs/0719_Launch_Ops_v1.md` -- earlier planning briefs; superseded in places by the actual decisions recorded in Content Needed and the Launch Checklist (noted inline where that applies)
- `docs/plans/2026-07-22-0719-digital-wedding-home/manifest.md` -- the original build plan this repository implements

## Guardrails

This project follows a few hard rules throughout its build, enforced by convention and by the docs above, not by this README:

- No deploy, publish, email send, or cloud-resource creation without Zach's explicit, separate approval -- see the Launch Checklist's gate sequence.
- The wedding photo source master is read-only; nothing in this repo ever writes to it.
- Original photo downloads must reproduce their source file byte for byte (`npm run verify:originals`).
- Production credentials fail closed: there is no fallback password or session secret.
- Private storage buckets are never public; every access goes through a short-lived, server-issued signed URL.
