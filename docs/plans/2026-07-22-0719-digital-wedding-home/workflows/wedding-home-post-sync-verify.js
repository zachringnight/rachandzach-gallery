export const meta = {
  name: 'wedding-home-post-sync-verify',
  description: 'After the real media sync to PrizmLounge, sample uploaded objects and prove they match local catalog hashes/sizes',
  phases: [{ title: 'Verify', detail: 'parallel low-effort sampling agents + one summary' }],
}

const REPO = '/Users/zsoskin/Downloads/rachandzach-gallery'
const PLAN = REPO + '/docs/plans/2026-07-22-0719-digital-wedding-home'

const REPORT = {
  type: 'object',
  properties: {
    shard: { type: 'string' },
    sampled: { type: 'number' },
    mismatches: { type: 'array', items: { type: 'string' } },
    missingRemote: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED'] },
    summary: { type: 'string' },
  },
  required: ['shard', 'sampled', 'mismatches', 'missingRemote', 'status', 'summary'],
  additionalProperties: false,
}

// args: { catalogPath: string, projectId: string, sampleSize: number (per shard), shards: number }
const catalogPath = args?.catalogPath ?? `${REPO}/src/generated/gallery-v2.json`
const projectId = args?.projectId ?? 'rnfvmqflktghriqefatc'
const shardCount = args?.shards ?? 6
const sampleSize = args?.sampleSize ?? 40

phase('Verify')
log(`Sampling uploaded objects across ${shardCount} shards, ${sampleSize} photos each`)

const shardPrompts = Array.from({ length: shardCount }, (_, i) => i)

const results = await parallel(shardPrompts.map(shardIndex => () =>
  agent(`You are shard ${shardIndex} of ${shardCount} in a post-sync verification sweep for the wedding-gallery media sync into the SHARED Supabase project ${projectId} (buckets rachandzach-originals, rachandzach-previews; table rachandzach_photos, rachandzach_photo_previews). Read-only against everything except a fresh scratch temp file for your own bookkeeping.

1. Load ${catalogPath} (the local catalog). Take every Nth photo record (N = total / ${shardCount}, offset by shard index ${shardIndex}) to get roughly ${sampleSize} photos assigned to you, deterministic and non-overlapping with other shards.
2. Load the Supabase MCP tools via ToolSearch (execute_sql is enough; do not use apply_migration, do not write anything to the database).
3. For each sampled photo: query rachandzach_photos by image_data_hash for the row (original_bucket, original_object, original_bytes, file_sha256), and rachandzach_photo_previews for its preview rows. Confirm a matching storage.objects row exists for each (bucket_id, name) pair with the metadata size matching original_bytes / the preview bytes, WITHOUT downloading the file (Postgres metadata query only, e.g. storage.objects.metadata->>'size' or the object's size column, whichever this schema uses; inspect columns first).
4. Record: sampled count, any hash/size mismatch (with exact values), and any catalog row whose expected storage object is missing entirely.
5. Do not touch any non-rachandzach object. No writes.
Report shard "${shardIndex}" with your findings.`,
    { label: `verify-shard-${shardIndex}`, phase: 'Verify', schema: REPORT, model: 'sonnet' })
))

const clean = results.filter(Boolean)
const totalSampled = clean.reduce((a, r) => a + (r.sampled || 0), 0)
const totalMismatches = clean.flatMap(r => r.mismatches || [])
const totalMissing = clean.flatMap(r => r.missingRemote || [])

log(`Sampled ${totalSampled} photos total: ${totalMismatches.length} mismatches, ${totalMissing.length} missing remote objects`)

return {
  totalSampled,
  mismatches: totalMismatches,
  missingRemote: totalMissing,
  verdict: totalMismatches.length === 0 && totalMissing.length === 0 ? 'CLEAN' : 'ISSUES_FOUND',
  shardResults: clean,
}
