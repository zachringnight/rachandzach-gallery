# Rach & Zach gallery agent guide

## Start here

The user request is the active task. Read this file. Read `docs/ONLINE_HANDOFF.md` only for release, deployment, provider, authentication, catalog, or production-status work.

Inspect `git status --short` before editing and preserve unrelated work.

## Non-negotiable safety

- Source image pixels are immutable. Never resize, recompress, crop, convert, rename, move, delete, or upload source originals to an external tool.
- Embedded person and keyword metadata may be added to the backed-up master only through existing additive workflows. Preserve image data and existing metadata.
- Never expose guest identities, private metadata, signed URLs, passwords, tokens, OAuth material, environment values, or private bucket contents.
- Originals leave through short-lived server-signed URLs only.
- The Supabase project is shared. Trace current readers and writers before changing any gallery schema, policy, function, bucket, or migration.
- Do not send email, messages, invitations, or notifications without explicit authorization for that exact send.
- Do not merge, deploy, mutate production data, or create cloud resources unless the current request explicitly authorizes it.

## Work and review flow

1. Start from current `main` on one branch for the coherent objective.
2. Use targeted tests while implementing.
3. Commit coherent changes and maintain one draft PR. Avoid serial checkpoint commits and review-only PRs.
4. Keep browser previews for runtime changes. Documentation-only changes should not build or deploy.
5. Prefer squash merge after required checks and conversations are complete.

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
