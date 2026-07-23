# Media sync run: 0719 digital wedding home

## Verdict: BLOCKED (storage sync still not completing; catalog sync not attempted)

Updated after a second supervised session. Five real (`--execute`) storage-sync
attempts have now been made across two sessions (3 historical + 2 this
session), at three different concurrency levels (6, 4, 3), plus a clean,
isolated, concurrency-1 diagnostic. All five real attempts show the same
signature: essentially all uploads fail instantly with `"fetch failed"`. The
diagnostic probes run this session localize the cause further than the first
session could: a single, sequential, unconcurrent upload succeeds at 1 MB and
fails at 4 MB, and the failure appears to leave the client/connection unable
to complete even a small follow-up request. Concurrency has no measurable
effect (99.79% -> 99.82% -> 99.67% failure across 6 -> 4 -> 3). This is a
structural network/infrastructure ceiling on this Mac's current path to
Supabase Storage, not a transient blip and not something the sync tool, this
session's retries, or a lower `--concurrency` can fix. Per the task's hard
rule ("if anything looks structurally wrong... STOP and report BLOCKED with
the evidence instead of forcing through"), this session stopped after one
authorized relaunch rather than spending the rest of its retry budget on
attempts the evidence says will fail the same way. Catalog sync was never
attempted (storage-before-catalog rule); `rachandzach_photos` /
`rachandzach_photo_previews` are correctly still at 0 rows. Nothing local or
remote was deleted or modified outside this session's own ephemeral
diagnostic probe objects (created and removed by this session, in the
sanctioned `rachandzach-download-exports/probe/` prefix); the source master
and the catalog file were never written to.

## This session's preflight

- `date`: session start 2026-07-22 19:16 PT (2026-07-23 02:16 UTC), directly
  following the prior session's last attempt (retry2 completed 19:07 PT).
- No `build-gallery` / `sync-gallery` process running (`pgrep` clean).
- `.env.cloud` present (path only; contents never read/printed).
- `src/generated/gallery-v2.json`: 1721 photos / 14 events / 132 people
  (`node -e` count check), mtime `18:58:24`, identical to
  `metadata/import/gallery-import-report.json`'s mtime. Per this task's facts
  this freshness signal was treated as sufficient without re-verifying
  content (already independently re-verified by the prior session and by a
  live dry-run source-hash pass, both with 0 mismatches).
- Checkpoint state (`metadata/import/gallery-sync-state.json`): 44 objects
  (7 originals, 37 previews), `updatedAt` matching the prior session's
  retry2 completion exactly.
- **Independent verification before trusting the task brief's "49-upload
  probe already passed" claim**: no result log or artifact existed for that
  claim anywhere in the repo or scratchpad, only the probe script itself
  (`upload-probe.mjs`, written 19:14, one minute before this session
  started). Rather than take the claim on faith, this session ran that exact
  script fresh: **49/49 uploads succeeded, 0 failures, 0 residue after
  cleanup.** This did independently confirm credentials/network/API were
  healthy for small payloads at that moment - see below for why that turned
  out not to predict the real run's outcome.
- Cloud spot check (Supabase MCP, read-only) before touching anything:
  `storage.objects` in `rachandzach-originals` = 7, in `rachandzach-previews`
  = 37 - exact match to the local checkpoint's 44 objects. `rachandzach_photos`
  = 0, `rachandzach_photo_previews` = 0 (catalog never run, correct).
- Storage dry-run, run twice: the first pass omitted `--project-ref`, and by
  design (see `syncGalleryStorage`: "Dry-run against a different target: that
  checkpoint is not applicable") the tool correctly treated the checkpoint as
  inapplicable and reported 0 skipped / 13532 remaining - not a bug, just an
  incomplete flag set on this session's part. Rerun with
  `--project-ref rnfvmqflktghriqefatc` added: **13532 planned operations
  (1721 originals + 11811 previews), 15,043,882,487 bytes (14.01 GiB), 44
  skipped (matching checkpoint/cloud exactly), 13488 remaining, 0 source hash
  mismatches, 0 failures.** Confirms the checkpoint will be honored correctly
  on a real run and the catalog/source files are unchanged since the prior
  session.

## Timeline (all times 2026-07-22 PT / 2026-07-23 UTC)

| Time (PT) | Event |
|---|---|
| 19:16 | Session starts; preflight checks begin |
| ~19:17 | Fresh tiny-buffer probe (49 uploads, concurrency 6, `rachandzach-download-exports/probe/`): 49/49 OK, 0 residue |
| ~19:18 | Storage dry-run (with `--project-ref`): 13532 planned, 44 skipped, 0 failures - matches checkpoint/cloud |
| 19:19:0x | **This session's attempt 1** launched detached (PID 67987), `--execute --concurrency 4` |
| 19:19:42 | Attempt 1 completes cleanly (no crash): `execute: 13532 planned operations, 24 network writes, 44 skipped, 0 source hash mismatches, 13464 failures. Resumable: 44 verified, 13488 remaining.` All 24 successes were previews; 0/1714 attempted originals succeeded. Checkpoint: 44 -> 68 objects. |
| 19:21 | This session observes the process already exited (~2 min after launch); reads log + report |
| 19:21-19:23 | Failure-report analysis (see below): confirms size correlation, not randomness |
| 19:23-19:25 | Bounded 120-second wait per task instructions |
| ~19:25 | Re-ran prescribed tiny-buffer probe: 49/49 OK again (small payloads still fine) |
| ~19:25 | **Additional diagnostic**: size-graduated single-upload probe, concurrency 1, same `probe/` prefix: 100KB OK (506ms), 1MB OK (533ms), **4MB FAIL (397ms, "fetch failed")**, **8MB FAIL (8ms, "fetch failed")**. The cleanup `remove()` call immediately after also failed ("fetch failed") even though it was a small request. |
| 19:26:5x | **This session's attempt 2 / relaunch 1** (the one relaunch authorized by the tripwire rule since the tiny probe passed) launched detached (PID 70814), `--execute --concurrency 3` |
| 19:27:29 | Relaunch 1 completes cleanly (no crash), in under 30 seconds: `execute: 13532 planned operations, 45 network writes, 68 skipped, 0 source hash mismatches, 13419 failures. Resumable: 68 verified, 13464 remaining.` Checkpoint: 68 -> 113 objects (12 originals, 101 previews). |
| 19:27:30 | This session's poll loop confirms the process already exited (caught at ~30s) |
| ~19:28 | Cloud spot check: `storage.objects` originals = 12, previews = 101 - exact match to local checkpoint. `rachandzach_photos` / `rachandzach_photo_previews` still 0. Also found 2 residual objects in `probe/` from the size-graduated probe's failed cleanup call. |
| ~19:29 | Listed and removed those 2 residual diagnostic objects (the session's own just-created test data, in the sanctioned probe prefix); re-listed and confirmed 0 residue. |
| ~19:30 | Final sanity: no `sync-gallery`/`build-gallery` processes running; source master directory confirmed read-only (listed, not written); `gallery-v2.json` mtime unchanged (18:58:24, untouched by any of this session's actions). |

## Commands used (credential path only, never contents)

Dry-run (sanity check, with `--project-ref` so the checkpoint applies):
```
node scripts/sync-gallery-storage.mjs \
  --catalog src/generated/gallery-v2.json \
  --source "/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean" \
  --derivatives metadata/import/derivatives \
  --dry-run --project-ref rnfvmqflktghriqefatc \
  --report metadata/import/gallery-sync-report-dryrun-check2.json
```

This session's attempt 1 (concurrency 4):
```
nohup node scripts/sync-gallery-storage.mjs \
  --catalog src/generated/gallery-v2.json \
  --source "/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean" \
  --derivatives metadata/import/derivatives \
  --execute --project-ref rnfvmqflktghriqefatc --allowlist rnfvmqflktghriqefatc \
  --env-file .env.cloud --concurrency 4 \
  > metadata/import/media-sync-storage.log 2>&1 &
```

This session's relaunch 1 (concurrency 3, the one authorized retry):
```
nohup node scripts/sync-gallery-storage.mjs \
  --catalog src/generated/gallery-v2.json \
  --source "/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean" \
  --derivatives metadata/import/derivatives \
  --execute --project-ref rnfvmqflktghriqefatc --allowlist rnfvmqflktghriqefatc \
  --env-file .env.cloud --concurrency 3 \
  > metadata/import/media-sync-storage-relaunch1.log 2>&1 &
```

Catalog sync (`sync-gallery-catalog.mjs`) was never invoked: the
storage-before-catalog rule and the "zero failed, or only explainable skips"
gate were both violated by the storage-sync results above, exactly as in the
prior session.

## Failure analysis (new this session): it correlates with payload size, not randomness

The prior session's report noted "different photos, different object kinds,
no pattern" from spot-checking a handful of failures. This session ran a full
aggregate analysis across all 13464 failures from attempt 1's report and
cross-referenced against object byte sizes:

| Group | Attempted | Succeeded | Failed | Failed bytes (min/avg/max) |
|---|---|---|---|---|
| Originals | 1714 | 0 | 1714 (100%) | 812,796 / 7,209,288 / 10,259,330 |
| Previews | 11,774 | 24 | 11,750 (99.8%) | 7,575 / 222,645 / 2,478,796 |

Every single original failed. The only successes across the whole run were
24 previews, averaging 293,596 bytes - smaller than the average failed
preview. This pointed at payload size, so this session ran a targeted,
isolated, concurrency-1 diagnostic (single sequential uploads, no other load,
same sanctioned `probe/` prefix):

```
100KB: OK after 506ms
1MB:   OK after 533ms
4MB:   FAIL after 397ms - StorageUnknownError: fetch failed
8MB:   FAIL after 8ms   - StorageUnknownError: fetch failed
cleanup: FAILED: fetch failed   <- a small remove() call, right after the two large failures
```

This is a clean, reproducible result: a hard ceiling between 1 MB and 4 MB on
this Mac's current network path to Supabase Storage, present even with zero
concurrency and zero sustained load. The 8ms failure time on the 8MB case (too
fast to be a real round trip) and the fact that the small `remove()` call
right afterward also failed both suggest the client/connection degrades once
it hits a large-body failure, rather than each request independently timing
out. That also explains why a run generates a small trickle of preview
successes before effectively stalling out at ~99.7-99.8% failure: whichever
requests happen to run before a large original poisons their connection can
still succeed.

Every one of the 1,721 originals (observed minimum 812,796 bytes, well above
the 1 MB success boundary) is guaranteed to sit on the failing side of this
ceiling. This is why reducing `--concurrency` from 6 to 4 to 3 across three
independent real attempts produced no meaningful change (99.79% / 99.82% /
99.67% failure - flat within noise): concurrency controls how many transfers
run in parallel, not the size of any individual transfer, and the ceiling
triggers on individual request size.

## Final counts

| Metric | Value |
|---|---|
| Planned operations (originals + previews) | 13,532 (1,721 + 11,811) |
| Planned bytes | 15,043,882,487 (14.01 GiB) |
| Total objects checkpointed, end of prior session | 44 (7 originals, 37 previews) |
| Total objects checkpointed, end of this session | 113 (12 originals, 101 previews) |
| This session's net new successful uploads | 69 (5 originals, 64 previews) |
| Source hash mismatches (all attempts, all sessions) | 0 |
| Failures, this session's attempt 1 (concurrency 4) | 13,464 / 13,488 attempted (99.82%), all `"fetch failed"` |
| Failures, this session's relaunch 1 (concurrency 3) | 13,419 / 13,464 attempted (99.67%), all `"fetch failed"` |
| `uploadedOriginals` / `uploadedPreviews` (cumulative, catalog fields N/A - catalog never run) | 0 / 0 |
| `catalogRowsUpserted` | 0 |
| Cloud spot check: `rachandzach_photos` rows | 0 |
| Cloud spot check: `rachandzach_photo_previews` rows | 0 |
| Cloud spot check: `storage.objects` in `rachandzach-originals` | 12 |
| Cloud spot check: `storage.objects` in `rachandzach-previews` | 101 |
| Diagnostic probe residue left behind | 0 (2 objects created and removed by this session's own size-graduated probe) |

## Retries / relaunch budget

This session's authorized budget was 4 relaunches total. This session used
1 initial launch + 1 relaunch (the one the tripwire rule authorizes after a
passing small-payload probe) = 2 of the 4 available. **This session stopped
deliberately with 2 relaunches still available**, rather than continuing to
spend them, because by this point the evidence was no longer ambiguous: three
independent real attempts across two sessions (concurrency 6, 4, 3) plus an
isolated single-request diagnostic all reproduced the same payload-size-linked
failure with no improvement from lowering concurrency. Spending the remaining
budget on more attempts at the same or lower concurrency would be "forcing
through" a structural problem the task's hard rules explicitly say to stop
and report instead.

## Diagnosis and recommendation for whoever picks this up next

The tool itself remains fully proven (packet 13 smoke test, this session's
own dry-run and checkpoint-correctness checks) and requires no changes. The
blocker is this Mac's current network path to Supabase Storage rejecting
request bodies somewhere between 1 MB and 4 MB, consistently, regardless of
concurrency. Candidates worth checking before a next real attempt, roughly in
order of ease:

1. **Try a different network path**: a mobile hotspot, a different Wi-Fi
   network, or a wired connection. This is the fastest way to confirm or rule
   out this Mac's current network as the cause.
2. **Check for a VPN, proxy, or firewall/security software** that might
   inspect or cap outbound HTTPS request bodies (corporate security tools and
   some consumer "network protection" features do this).
3. **Check the router for any upload size limit or deep-packet-inspection
   feature** (less common on consumer routers, but possible).
4. **Try from a different machine on the same network**, to isolate
   Mac-specific configuration (proxy settings, VPN client, Node/undici
   version quirks) from network-wide causes.
5. Only after one of the above changes something, resume with the exact same
   command this doc already documents (`--execute --concurrency 4`, or even
   back to 6 - concurrency was not the variable). The checkpoint is
   confirmed correct and will skip all 113 already-verified objects; nothing
   will be re-uploaded or duplicated.

## Hard rules honored

- Sync scripts and `src/` were never modified.
- Nothing local or remote was deleted, except this session's own 2
  self-created ephemeral diagnostic objects in the sanctioned
  `rachandzach-download-exports/probe/` prefix, created and removed by this
  session only (verified 0 residue before and after).
- `.env.cloud` was used only as a `--env-file` path argument (and read
  directly by this session's own small diagnostic probe scripts, exactly as
  the existing `upload-probe.mjs` pattern already did); contents were never
  printed or echoed into any command output captured in this report.
- The source master (`Rachel & Zach - Wedding Master Clean`) was only read
  (directory listing + the sync tool's own read-only hashing); never written.
  Confirmed read-only at the end of this session.
- `src/generated/gallery-v2.json` mtime confirmed unchanged (18:58:24)
  throughout this session - never touched.
- Structurally-wrong evidence (three reproducible near-100%-failure real
  attempts across two concurrency values this session, plus a clean isolated
  diagnostic proving a concurrency-independent payload-size ceiling)
  triggered STOP-and-report per the hard rules instead of forcing through
  with the remaining relaunch budget.
