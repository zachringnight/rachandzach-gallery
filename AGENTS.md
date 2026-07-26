# Rach & Zach gallery agent guide

This file applies to the entire repository. Keep it short and operational.
The canonical release record is `docs/ONLINE_HANDOFF.md`; older launch and
planning documents are historical unless that handoff explicitly points to
them.

## Start here

1. Read `docs/ONLINE_HANDOFF.md` before changing code or reporting status.
2. Run `git status --short`, `git branch --show-current`, and
   `git log -5 --oneline --decorate`.
3. Preserve all existing work. Do not switch branches, overwrite files, or
   clean a dirty worktree until the owner and purpose of every change are
   understood.
4. Use `rg` and `rg --files` for discovery. Trace the current reader, writer,
   route, test, and migration before removing anything.
5. In a fresh checkout, run `npm ci`. Before handoff, run `npm run verify` and
   `git diff --check`.

## Current product truth

- Production is `https://rachandzach.com`; `main` auto-deploys to Vercel
  Production.
- The product is a premium private photo archive, not a weekend recap. Preserve
  the warm cream, wheat, sand, espresso, muted olive, and restrained terracotta
  system. `/weekend` permanently redirects to `/photos`.
- The primary guest jobs are Find me, search, favorites, original downloads,
  Google Drive and Dropbox saves, and contributing photos for moderation.
- The 1,721-photo catalog, personalized routes, uploads, moderation, signed
  originals, and private guest data are existing functionality—not redesign
  collateral.
- Google Drive and Dropbox public identifiers are configured in Vercel
  Production and Preview. Refer to them only by variable name:
  `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` and
  `NEXT_PUBLIC_DROPBOX_APP_KEY`. Never print or commit their values.
- Live provider readiness is verified through the Google consent handoff and
  Dropbox folder handoff. A real file transfer still requires the guest to
  authenticate and consent in their own account; do not claim that external
  write passed unless it was actually observed.

## Non-negotiable protections

- Treat the wedding clean master and every source original as read-only. Never
  rename, move, delete, overwrite, recompress, or upload source media to an
  external tool.
- Never expose guest identities, private metadata, signed media URLs, passwords,
  tokens, OAuth material, `.env.cloud`, or production environment values.
- Keep private Supabase buckets private. Originals leave through short-lived
  server-signed URLs only.
- The Supabase project is shared with other products. Do not alter unrelated
  tables, policies, functions, buckets, or migrations. Trace readers and
  writers before changing any `rachandzach_*` schema surface.
- Do not send email, messages, invitations, or notifications without Zach's
  explicit approval for that exact send.
- Do not deploy, publish, mutate production data, or create cloud resources
  without explicit authorization in the active task.

## Code map

- `src/app/page.tsx`, `src/components/site/`, `src/styles/tokens.css`, and
  `src/app/globals.css`: public archive design and shared visual system.
- `src/app/(access)/` and `src/lib/auth/`: guest gate and session security.
- `src/app/(guest)/`, `src/components/gallery/`, and `src/lib/gallery/`:
  authenticated archive, filters, viewer, and personalized experiences.
- `src/components/downloads/` and `src/lib/downloads/`: original downloads,
  native sharing, Google Drive, Dropbox, selection signing, and ZIP flows.
- `src/components/uploads/`, `src/lib/uploads/`, and `src/lib/moderation/`:
  resumable guest contributions and approval state.
- `supabase/migrations/`: wedding schema, RLS, storage, and RPC history.
- `tests/`: Vitest coverage and Playwright browser, accessibility, and visual
  regression checks.
- `scripts/`: local import, integrity, sync, and catalog tooling. Sync commands
  are dry-run by default; execution flags are intentionally explicit.

## Change and verification workflow

- Keep product claims exact: implemented is not reviewed, deployed is not
  accepted, and provider readiness is not a consented file transfer.
- Preserve the modern sans-serif, photo-first layout and forward-looking copy.
  Do not reintroduce event-summary or weekend-recap sections.
- For a bounded code change, run the closest focused test first, then:

  ```bash
  npm run typecheck
  npm run lint
  npm run test
  npm run verify:build
  npx playwright test tests/e2e --project=chromium
  git diff --check
  ```

- `npm run verify` runs that complete local gate. The suite intentionally
  includes documented live-database skips; report pass and skip counts
  separately.
- For visual changes, inspect desktop and 390px mobile screenshots yourself.
  Update snapshots only after confirming the rendered change is intentional;
  do not treat snapshot regeneration as visual approval.
- For cloud-save changes, test the lazy two-click states, signed-selection
  preparation, popup cancellation/error recovery, Dropbox's 100-file cap, CSP,
  and that provider tokens are never persisted.
- Update `docs/ONLINE_HANDOFF.md` whenever release state, environment scope,
  acceptance status, or a production blocker changes. Do not rewrite historical
  planning documents to make them look current.

## Branch and deployment behavior

- Start new work from a freshly verified `origin/main` on a `codex/<task>`
  branch unless Zach explicitly requests a direct `main` change.
- `main`, `staging`, and `preview/**` are Vercel build branches. Ordinary
  `codex/**`, `claude/**`, `wip/**`, and Dependabot branches are intentionally
  skipped.
- Keep `scripts/vercel-ignore-build.mjs` available to Vercel. If
  `.vercelignore` changes, preserve its explicit exception for that file.
- After an authorized production push, verify the exact commit is `READY`, the
  custom-domain aliases are attached, the homepage returns `200`, protected
  routes still gate correctly, and recent runtime errors are empty.

## Definition of done

A handoff is complete only when the intended behavior is implemented, the
relevant tests and browser checks pass, the worktree state is explicit, the
commit is pushed to the intended branch, deployment claims are freshly
verified, and `docs/ONLINE_HANDOFF.md` matches reality.
