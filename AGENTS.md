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

- **Source pixels are immutable.** Never recompress, resize, crop, convert the
  format of, rename, move, or delete anything in the wedding clean master or
  any source original, and never upload source media to an external tool.
  There is exactly one wedding day; a lost or degraded frame does not come
  back. This half is non-negotiable.
- **Embedded metadata on the master may be written.** Names in
  `XMP-iptcExt:PersonInImage`, `XMP-dc:Subject`, and `IPTC:Keywords` are the
  point of having those fields: they travel with the photograph into Apple
  Photos, Lightroom, or whatever exists in twenty years, long outliving this
  site. Several scripts already do this (`normalize-clean-master-metadata.py`,
  `write-additions-to-master.py`, and others); that is intended, not a
  violation.
  - Zach keeps multiple independent backups of the originals (confirmed
    2026-07-28), which is what makes in-place metadata writes acceptable. If
    that ever stops being true, this permission stops with it.
  - Still write metadata additively, never destructively: union new names onto
    what a photo already carries rather than replacing the set, and do not
    strip fields you did not write.
  - A metadata write must never alter the image data. exiftool's tag writes do
    not, but a resize/recompress dressed up as a "metadata pass" would, so
    keep the two operations separate and obvious.

  This used to read "treat the master as read-only, never overwrite", which
  swept metadata writes in with recompression. Ten scripts broke it routinely,
  so the rule flagged everything and therefore protected nothing. It is split
  here so the prohibition that matters is the one that gets enforced.
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
  `src/app/globals.css`: archive design and shared visual system. Public
  again, and this time literally: the password gate was removed on 2026-08-09
  and there is no `PUBLIC_ROUTES` allowlist any more, because every route is
  public. `robots.txt` still keeps it out of search indexes.
- `src/lib/auth/`: guest identity (`guest-session.ts` -- a signed session id
  that favorites and uploads are keyed to, NOT a permission), admin
  authentication (`admin-session.ts` -- the only real gate left), security
  headers, and rate limiting.
- `src/app/(guest)/`, `src/components/gallery/`, and `src/lib/gallery/`:
  the archive, filters, viewer, and personalized experiences.
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
- Preserve the photo-first layout and forward-looking copy. Do not reintroduce
  event-summary or weekend-recap sections.
- Typography is a three-role system, set in `src/components/brand/Wordmark.tsx`
  and exposed through `src/styles/tokens.css`: Fraunces for display, Inter for
  body and controls, IBM Plex Mono for archive data (counts, times, positions,
  eyebrows). This replaced a Manrope/Inter pairing on 2026-07-26 at Zach's
  explicit direction, superseding the earlier "preserve the modern sans-serif"
  rule: the `0719 + co.` mark has always been a serif, and the headlines now
  match it. Body copy must not borrow `--rz-font-display`; `/nyc` is the one
  deliberate exception, where Rachel's letter is long-form prose set as an
  essay.
- For a bounded code change, run the closest focused test first, then:

  ```bash
  npm run verify:vercel
  npm run typecheck
  npm run lint
  npm run test
  npm run verify:build
  npx playwright test tests/e2e --project=chromium
  git diff --check
  ```

  `verify:vercel` leads because `npm run verify` runs it first: it is the
  validator added after a malformed `vercel.json` broke deploys, and leaving
  it out of this list let exactly that class of regression through the
  bounded check.

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
- `main` auto-deploys to Vercel Production. Every other Git branch auto-deploys
  to Vercel Preview so pull requests always have a runnable test build.
- GitHub CI runs for every pull request. A green Vercel status must point to a
  `READY` Preview, not an ignored/canceled build.
- After an authorized production push, verify the exact commit is `READY`, the
  custom-domain aliases are attached, the homepage returns `200`, protected
  routes still gate correctly, and recent runtime errors are empty.

## Definition of done

A handoff is complete only when the intended behavior is implemented, the
relevant tests and browser checks pass, the worktree state is explicit, the
commit is pushed to the intended branch, deployment claims are freshly
verified, and `docs/ONLINE_HANDOFF.md` matches reality.
