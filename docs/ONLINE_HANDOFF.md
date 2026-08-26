# Online handoff

Updated: 2026-08-26

## Current truth

- `main` is canonical and deploys production at `rachandzach.com`.
- The current user request defines the active objective.
- Current code, tests, catalog data, authenticated provider behavior, and observed deployment state outrank historical documents.
- No unchecked item in an old plan, backlog, design review, or handoff is implicitly active.

## Read by task

- Release, deployment, domains, or rollback: `docs/VERCEL_CONFIG.md` and current Vercel state
- Catalog or original-image work: inspect the current import and integrity scripts before acting
- Google Drive or Dropbox work: verify the live consent flow and exact provider behavior
- Supabase work: trace current readers, writers, policies, and migrations before changing anything
- Historical architecture or product rationale: read only the specific document named by the task

Do not load the entire documentation folder by default.

## Review and release behavior

- Use one branch and one draft PR per coherent objective.
- Runtime branches retain Vercel previews because rendered review is important for this product.
- Documentation-only changes should skip CI and Vercel builds.
- Use targeted checks during implementation and `npm run verify` before a runtime PR is ready.
- Merge, deployment, provider writes, production mutation, and external communication require explicit authorization.

## Provider claim standard

Configured credentials or a healthy callback are not proof of a completed guest file transfer. Report only the behavior actually observed.

The detailed pre-compaction handoff is preserved at `docs/archive/ONLINE_HANDOFF_pre-token-cleanup_2026-08-26.md`.
