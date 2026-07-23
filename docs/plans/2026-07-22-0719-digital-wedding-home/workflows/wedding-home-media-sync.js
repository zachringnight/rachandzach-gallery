export const meta = {
  name: 'wedding-home-media-sync',
  description: 'The real media sync: upload 1,721 originals + derivatives to PrizmLounge and upsert the catalog, supervised by a Sonnet agent with resume-on-failure',
  phases: [{ title: 'Sync', detail: 'Sonnet supervisor: storage sync (detached, polled), then catalog sync, then report' }],
}

const REPO = '/Users/zsoskin/Downloads/rachandzach-gallery'
const PLAN = REPO + '/docs/plans/2026-07-22-0719-digital-wedding-home'
const MASTER = '/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean'

const REPORT = {
  type: 'object',
  properties: {
    task: { type: 'string' },
    status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED'] },
    summary: { type: 'string' },
    uploadedOriginals: { type: 'number' },
    uploadedPreviews: { type: 'number' },
    skippedExisting: { type: 'number' },
    catalogRowsUpserted: { type: 'number' },
    failures: { type: 'array', items: { type: 'string' } },
    concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['task', 'status', 'summary', 'uploadedOriginals', 'uploadedPreviews', 'skippedExisting', 'catalogRowsUpserted', 'failures', 'concerns'],
  additionalProperties: false,
}

phase('Sync')
log('Sonnet supervisor launching the real media sync against PrizmLounge')

const result = await agent(`You supervise the REAL media sync for the 0719 digital wedding home: uploading all 1,721 original JPEGs (~11.6 GiB) plus their display derivatives from this Mac into the private rachandzach- buckets of Supabase project rnfvmqflktghriqefatc, then upserting the catalog rows. Zach approved this execution. The tool is packet 13's, already proven by a live smoke test (docs/plans/.../reviews/sync-smoke-test.md); the cloud schema is live-verified. Your job is careful supervision, not reimplementation.

READ FIRST: ${REPO}/scripts/sync-gallery-storage.mjs and ${REPO}/scripts/sync-gallery-catalog.mjs headers (CLI flags), and ${PLAN}/reviews/sync-smoke-test.md (what a healthy run looks like).

HISTORY AND ROOT CAUSE (fully diagnosed by hand outside this agent; read ${PLAN}/reviews/media-sync-run.md for the earlier timeline, then treat THIS section as superseding its "network is fine, just retry" conclusion): two prior supervised runs both failed near-totally at concurrency 4-6. Direct hands-on diagnosis found the real cause: concurrent large (multi-MB) HTTPS uploads get corrupted somewhere on this network's path (router, ISP, or a security middlebox), surfacing as a TLS "bad_record_mac" alert. This is NOT Node-specific: curl (a completely separate TLS stack) reproduces the identical failure under the same concurrency. It is NOT network-down, credential, or Supabase-side: single isolated large uploads succeed instantly and reliably via either client. The variable is concurrency, not the tool or the destination.
Two fixes are already IN PLACE in the repo. Do not re-diagnose or revert them:
  1. scripts/sync-gallery-storage.mjs now uploads real objects via a spawned curl subprocess (see uploadOriginalObjectViaCurl) instead of supabase-js's fetch-based upload, but ONLY on the real (non-test) path; 18/18 of the script's own unit tests still pass unchanged.
  2. The dominant fix, confirmed by a live 3-minute measurement: run at --concurrency 1. At concurrency 4-6, ~99.7-99.8% of operations failed near-instantly. At concurrency 1, only 1 failure occurred across 180 seconds while 6 objects (checkpoint 113 -> 119) uploaded cleanly, a background failure rate of roughly 10-20% per operation, not a healthy-vs-broken cliff. This residual rate is EXPECTED and NORMAL at concurrency 1 on this network, and is fully handled by the tool's own checkpoint: a failed operation is simply never recorded as verified, and rerunning the identical command skips everything already verified and retries only the remainder.
Your job is therefore much simpler than a fresh diagnosis: run the storage sync at --concurrency 1 to completion, expect it to report a nonzero handful of failures (that is NOT a BLOCKED signal, it is the known and accepted operating mode on this network), then relaunch the identical command as a plain retry pass, not incident response, as many times as it takes for the failure count to converge toward zero.

FACTS:
- Working dir: ${REPO}. Catalog: src/generated/gallery-v2.json, 1,721 photos, freshness already proven: metadata/import/full-import-run.log ends with "Result: 1721 unique primary photos ... Verification passed", gallery-import-report.json has the same mtime as the catalog, and a 60-file sampled decode check passed (the plan's old incremental-reverify-run.log marker was deliberately replaced by that cheaper check; do not look for that file). Only confirm the catalog exists with 1721 photos and matching report mtime; do not re-verify content.
- Source master (READ-ONLY): ${MASTER}
- Derivatives: metadata/import/derivatives
- Credentials: --env-file ${REPO}/.env.cloud (pass the PATH only; never print its contents, never copy values into your output).
- The default state/report paths under metadata/import/ are correct for this real run (the import process that owned that directory has exited; verify that with ps/pgrep before starting).
- Storage before catalog, always: run sync-gallery-storage.mjs to completion first, then sync-gallery-catalog.mjs.

EXECUTION PATTERN (each of your Bash calls must stay under ~8 minutes; the full upload at concurrency 1 will take considerably longer than an hour, plan for several hours across multiple retry passes):
1. Preflight: confirm no build-gallery process is still running; confirm src/generated/gallery-v2.json exists with 1721 photos (jq or node one-liner); confirm .env.cloud exists. Run a --dry-run of the storage sync first and sanity-check the planned counts.
2. Launch the real storage sync DETACHED at --concurrency 1 (not higher; see ROOT CAUSE above) so it survives your call boundaries: nohup node scripts/sync-gallery-storage.mjs --catalog src/generated/gallery-v2.json --source "${MASTER}" --derivatives metadata/import/derivatives --execute --project-ref rnfvmqflktghriqefatc --allowlist rnfvmqflktghriqefatc --env-file .env.cloud --concurrency 1 > metadata/import/media-sync-storage.log 2>&1 & then record its PID.
3. Poll in bounded waits (e.g. "timeout 420 bash -c 'until ! ps -p <PID> >/dev/null; do sleep 30; done'" per call, repeated), reading the log tail between waits, until the process exits. Do NOT kill it early and do NOT treat a nonzero failure count mid-run as a problem; a background rate of roughly 10-20% failed operations at concurrency 1 is the known, accepted, normal operating mode here (see ROOT CAUSE). Only escalate if the log shows a crash with no report written at all (rare; if so, just relaunch the identical command, the checkpoint makes this safe).
4. On exit: read the report JSON (metadata/import/gallery-sync-report.json). If failed > 0 (expected), relaunch the EXACT same command as a plain retry pass, no different flags, no lowering concurrency further, no probing. Repeat: each pass should shrink the failure count since checkpointed successes are skipped. Stop retrying and treat it as converged once a pass reports 0 failures, or once 3 consecutive passes each report roughly the same small residual count with no further shrinkage (genuine stuck failures, list them in your report). Generous relaunch budget: up to 15 passes total, since each pass only needs to mop up a shrinking minority, not redo everything. Only report BLOCKED if failures are NOT shrinking across passes or the plan itself looks wrong (not for the expected background failure rate).
5. When storage sync converges (0 failed, or a tiny explained residual you've documented): run the catalog sync the same detached way: nohup node scripts/sync-gallery-catalog.mjs --catalog src/generated/gallery-v2.json --execute --project-ref rnfvmqflktghriqefatc --allowlist rnfvmqflktghriqefatc --env-file .env.cloud > metadata/import/media-sync-catalog.log 2>&1 & and poll the same way (this one moves fast, no large bodies, concurrency is not the constraint here).
6. Verify from the tool's own outputs: final report JSON counts (uploadedOriginals, uploadedPreviews, skippedExisting, catalogRowsUpserted, failed, sourceHashMismatches must be 0). Then one independent spot check: load the Supabase MCP execute_sql tool via ToolSearch and run: select count(*) from rachandzach_photos; select count(*) from rachandzach_photo_previews; select count(*) from storage.objects where bucket_id = 'rachandzach-originals'; Expect 1721 photos and matching object counts. Read-only; touch nothing else.
7. HARD RULES: never modify the sync scripts or src/; never delete anything local or remote; never print credential values; the source master stays read-only; if anything looks structurally wrong (hash mismatches, unexpected collisions), STOP and report BLOCKED with the evidence instead of forcing through.

Write ${PLAN}/reviews/media-sync-run.md: timeline, commands, final counts, spot-check results, any retries. Report task "media-sync" with the real numbers.`,
  { label: 'media-sync-supervisor', phase: 'Sync', schema: REPORT, model: 'sonnet' })

return { result }
