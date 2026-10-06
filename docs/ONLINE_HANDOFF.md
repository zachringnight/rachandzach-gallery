# Rach & Zach gallery: online handoff

Updated 2026-10-06 (PDT). This is the canonical current-state record.
Historical plans and unchecked backlog items are not automatically active work.

## Release and product state

- Production: <https://rachandzach.com>. `main` auto-deploys to Production;
  every other branch receives a runnable Vercel Preview.
- Application release: `4f68ecf6e659f70bb6f3352bcf7ad2804a79aea6`,
  [PR #34](https://github.com/zachringnight/rachandzach-gallery/pull/34).
  The October 5 NYC snapshot shows $8,770.50 of $10,000, 81 donations,
  and $1,229.50 remaining. Donation and race dates remain October 7 and
  November 1. The approved 53-entry supporter wall is separately dated August 17.
- Last verified deployment before the operating-guide change: docs release
  `b792c279ccd31ebda534fd1df32979fa21aabc9d`, deployment
  `dpl_3NU4oUe1fVLpUv37WWCHF51SjAd9`, READY with apex, www, and project
  aliases on October 5. Public routes returned 200; admin routes redirected
  anonymous visitors; runtime-error queries were empty. Recheck Vercel for
  the current deployment ID rather than treating this dated record as live.
- The 1,721-photo archive and guest routes are public; admin routes require
  authentication. Private originals leave through short-lived signed URLs.
  Gallery text uses `gallery_q`; semantic Moment Search uses `q`.
- Google Drive and Dropbox identifiers are configured in Production and
  Preview (`NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID`, `NEXT_PUBLIC_DROPBOX_APP_KEY`).
  Consent/folder handoffs were verified historically; a completed file transfer
  into a guest account has not been established by those checks.
- Supabase is shared with other products. Change only authorized gallery
  resources after tracing current readers, writers, RLS, and storage policy.

## Operating-guide and CI review

[PR #33](https://github.com/zachringnight/rachandzach-gallery/pull/33) compacts
agent guidance, adds the Claude pointer and PR template, and archives the
historical handoffs. Its review reconciles the branch with the October 5
application release without changing application code or the dependency lockfile.

- Every pull request runs the required `npm run verify` check. Workflow-level
  PR path filters were removed because they could leave documentation-only PRs
  waiting forever for a required check that never started.
- Documentation-only pushes skip the duplicate CI run; scripts and other
  non-Markdown files under `docs/` still trigger verification. The redundant
  preview-branch push trigger is removed. Vercel Preview behavior is unchanged.
- `main` remains protected by `npm run verify` and `Vercel`. Confirm a READY
  Preview for the exact head before merging. PR #33's checks and deployment
  links identify its final tested revision and release outcome.
- PASS on the October 6 review: `npm run verify` under Node 24 completed
  Vercel validation, typecheck, lint (0 errors, 16 existing warnings), 1,163
  unit tests / 17 documented skips, build, ONNX tracing, and 48 Chromium
  tests / 26 documented skips. `git diff --check`, workflow YAML/required-check
  assertions, and byte-for-byte archive checks also passed. The diff against
  current main contains no application, test, dependency, or runtime-config edits.
- No production data, provider credentials, source media, or schema change is
  part of this operating-guide release. Rollback is a revert of PR #33.

## Open work and next actions

- Prioritize a separate dependency security patch. The October 5 audit found
  16 advisories (1 critical, 12 high, 3 moderate), including installed Next
  16.3.1. This review does not alter dependencies or claim those findings fixed.
- The old detached handoff checkout at `4cefe66` is preserved under
  `/Users/zsoskin/Codex/archives/rachandzach-gallery/2026-10-05/handoff-4cefe66`.
  Its recovery branch remains; it had no unique work or stash to rescue.
- Guest-account Drive/Dropbox transfers and the intentional live-database
  test gaps remain unverified. Use safe records and authorized environments
  for any acceptance pass; never equate configuration with completed transfer.

## Read by task

- Release and rollback: `docs/VERCEL_CONFIG.md`, the active PR, and current
  Vercel deployment state. Report deployed commit, aliases, smoke checks, and
  runtime errors separately from local tests.
- Catalog or originals: current import/integrity scripts and
  `docs/FACE_TAGGING_TOOL.md`; source pixels remain immutable.
- Latest detailed release and acceptance history:
  [October 5 state preserved before compaction](archive/ONLINE_HANDOFF_pre-compaction_2026-10-06.md).
- Earlier operating-guide and launch history:
  `docs/archive/AGENTS_pre-token-cleanup_2026-08-26.md`,
  `docs/archive/ONLINE_HANDOFF_pre-token-cleanup_2026-08-26.md`, and
  `docs/archive/HANDOFF_CURRENT_pre-token-cleanup_2026-08-26.md`.

Current code and observed behavior outrank archived prose. Read only the
specific historical section needed; do not load the documentation tree by default.
