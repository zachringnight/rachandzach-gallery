# Rach & Zach gallery agent guide

## Start here

The user request is the active task. Read this file. Read `docs/ONLINE_HANDOFF.md` only for release, deployment, provider, authentication, catalog, or production-status work.

Inspect `git status --short` before editing and preserve unrelated work.

## Non-negotiable safety

- Source image pixels are immutable. Never resize, recompress, crop, convert, rename, move, delete, or upload source originals to an external tool.
- Embedded person and keyword metadata may be added to the master only while independent backups exist and only through existing additive workflows. Preserve image data and existing metadata.
- Never expose guest identities, private metadata, signed URLs, passwords, tokens, OAuth material, environment values, or private bucket contents.
- Originals leave through short-lived server-signed URLs only.
- The Supabase project is shared. Trace current readers and writers before changing any gallery schema, policy, function, bucket, or migration. Do not alter unrelated product resources.
- Do not send email, messages, invitations, or notifications without explicit authorization for that exact send.
- Do not merge, deploy, mutate production data, or create cloud resources unless the current request explicitly authorizes it.

## Work and review flow

1. Start from freshly verified `origin/main` on a `codex/<task>` branch, or continue the existing PR branch for its authorized scope.
2. Use targeted tests while implementing.
3. Commit coherent changes and maintain one draft PR. Avoid serial checkpoint commits and review-only PRs.
4. Every non-main branch receives a runnable Vercel Preview. Every PR runs the required `npm run verify` check, including documentation-only PRs. Only duplicate documentation-only push runs are skipped.
5. Prefer squash merge after required checks and conversations are complete.

## Product and release invariants

- The public 1,721-photo archive and guest routes stay public; Production admin routes remain authenticated. See the handoff for the existing Preview-only `OPEN_ACCESS` exception. Originals and private guest data stay protected. `/weekend` redirects to `/photos`.
- Preserve the warm cream, wheat, sand, espresso, muted olive, and restrained terracotta design. Fraunces is display, Inter is body/controls, and IBM Plex Mono is archive data; Rachel's `/nyc` letter deliberately uses display type.
- `main` deploys to Production at `rachandzach.com`. Required PR checks are `npm run verify` and `Vercel`; the latter must identify a READY Preview for the exact head.
- After a production merge, verify the commit is READY, custom-domain aliases are attached, public pages return 200, admin routes still gate, and recent runtime errors are empty. Keep the canonical handoff current and distinguish deployed from accepted.

## Verification

For bounded source changes, run the closest test first, then:

```bash
npm run verify:vercel
npm run typecheck
npm run lint
npm run test
npm run verify:build
npm run verify:search-runtime
```

Run `npm run verify` before marking a runtime PR ready when the change affects guest flows, downloads, uploads, authentication, search, cloud saves, or presentation.

For visual work, inspect desktop and 390px mobile. For docs-only work, run `git diff --check`.

## Documentation routing

- Current release and provider state: `docs/ONLINE_HANDOFF.md`
- Architecture or feature history: read only the specific dated document named by the task
- Current code and tests outrank historical prose
