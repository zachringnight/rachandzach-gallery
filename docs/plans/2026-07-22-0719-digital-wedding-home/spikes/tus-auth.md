# Spike: Anonymous guest resumable uploads into private bucket `guest-pending`

Date: 2026-07-22. Verified against live Supabase docs and the official Supabase example repo on this date.

## Recommendation (decision)

**Pick option (a): the signed TUS token flow.** Our Next.js server mints a short-lived signed upload token per file with `createSignedUploadUrl()` (using the server-only secret key), and the guest's browser uploads directly to Supabase's TUS endpoint at `/storage/v1/upload/resumable/sign`, passing the token in the `x-signature` header. This is fully resumable, requires ZERO storage RLS policies (the bucket stays completely locked to anon), the server controls every object path, and the token expires in 2 hours.

This settles the core question: signed upload URLs are NOT single-shot PUT only. Supabase Storage explicitly supports `createSignedUploadUrl` tokens with the TUS resumable endpoint. From the resumable uploads guide: "Resumable uploads also supports using signed upload tokens to created time-limited URLs ... by invoking the `createSignedUploadUrl` method on the SDK and including the returned token in the `x-signature` header of the resumable upload."

**Fallback order:**
1. (a) Signed TUS token flow (recommended, build this)
2. (c) Per-file signed PUT via `createSignedUploadUrl` + `uploadToSignedUrl` (same server minting code, no resumability; acceptable because wedding photos are mostly < 20 MB; lose resumability only for large videos)
3. (b) Anon key + RLS INSERT policy scoped to `bucket_id = 'guest-pending'` (last resort only; see abuse analysis below)

Note that (a) and (c) share the same server-side minting endpoint, so falling back from (a) to (c) is a client-only change. That is another reason to prefer (a) first.

## Why (a) wins

- **No RLS policy needed at all.** The token is minted server-side with the secret (service role) key, which bypasses RLS. The guest-facing upload is authorized purely by the token. The `guest-pending` bucket keeps zero policies for `anon`, so the public publishable key alone can do nothing: no insert, no read, no list, no delete.
- **Server controls the object path.** The token is bound to the exact bucket + path passed to `createSignedUploadUrl`. The client's TUS `bucketName`/`objectName` metadata must match the token or the upload fails. Server issues paths like `guest-pending/{sessionId}/{uuid}.{ext}`, so guests cannot choose or collide paths.
- **Resumable.** Full TUS semantics: 6 MB chunks, resume after network drop, up to 50 GB per file (resumable uploads support up to 50 GB; standard uploads cap at 5 GB).
- **Bypasses Vercel body limits.** File bytes go browser -> `<project-id>.storage.supabase.co` directly. Our Next.js route only mints tokens (tiny JSON), so Vercel's ~4.5 MB serverless request body limit is irrelevant.
- **Time-boxed.** Token is valid for 2 hours (fixed, not configurable in supabase-js). The TUS upload URL created during the upload is valid for up to 24 hours.

## Answers to the three spike questions

### 1. Server-minted tokens compatible with TUS: YES

`supabase.storage.from(bucket).createSignedUploadUrl(path, { upsert?: boolean })` returns `{ signedUrl, token, path }`. The token is valid for 2 hours. It can be used two ways:

- Single-shot PUT: `uploadToSignedUrl(path, token, file)` (this is the fallback (c) path; it PUTs to `/object/upload/sign/{bucket}/{path}?token=...`).
- Resumable TUS: include the token as the `x-signature` header on TUS requests to the `/storage/v1/upload/resumable/sign` endpoint. This is documented in the resumable uploads guide ("Presigned uploads" section) and demonstrated in the official example `supabase/supabase/examples/storage/resumable-upload-signed-uppy`.

storage-js source confirms: `createSignedUploadUrl` POSTs to `/object/upload/sign/{path}`, sets `x-upsert: true` when `options.upsert` is set, and extracts `token` from the returned URL's query string. JSDoc: "Signed upload URLs can be used to upload files to the bucket without further authentication. They are valid for 2 hours."

### 2. Anon key + scoped RLS INSERT policy: works, but do not use it as primary

It would work mechanically: the publishable (anon) key is a valid credential for the TUS endpoint, and an INSERT policy on `storage.objects` for role `anon` with `bucket_id = 'guest-pending'` would authorize creation. But "server-issued object paths" cannot be enforced by that policy alone, because the client sends whatever path it wants and plain RLS has nothing to check it against.

What an abuser holding the public publishable key can do in that design:

- Create unlimited objects at arbitrary attacker-chosen paths inside `guest-pending`, 24/7, without ever touching our Next.js server (so our app-level rate limits never see the traffic).
- Fill storage to run up our bill (storage-fill DoS). This is the real risk.
- They can NOT read, list, overwrite, or delete anything (no SELECT/UPDATE/DELETE policies; `x-upsert` overwrite requires UPDATE permission), and they cannot touch other buckets.

What contains it:

- Bucket-level `fileSizeLimit` (e.g. '100MB') and `allowedMimeTypes` (e.g. `['image/*','video/*']`), enforced at upload time.
- The project's global file size limit (Storage Settings; Free plan caps at 50 MB, Pro allows up to 500 GB).
- Plan spend caps / disk quotas as a blunt backstop.
- Supabase has no built-in per-IP or per-key rate limiting for the Storage API that we can configure, so the DoS surface stays open.

To make (b) actually safe you would add a Postgres check in the policy against a server-populated `upload_tickets` table (`EXISTS (SELECT 1 FROM public.upload_tickets t WHERE t.path = name AND t.expires_at > now())`). That reimplements signed tokens in SQL, with more moving parts. The native token flow already does this. Hence (b) is last-resort only.

### 3. Exact endpoint and current documented client config

Endpoints (docs current as of 2026-07-22):

- Authenticated (user JWT) TUS: `https://<project-id>.storage.supabase.co/storage/v1/upload/resumable`
- Signed-token TUS (our flow): `.../storage/v1/upload/resumable/sign` (note the `/sign` suffix; the official signed-token example uses `https://<project-id>.supabase.co/storage/v1/upload/resumable/sign`)
- Docs explicitly recommend the direct storage hostname for large files: "Instead of `https://project-id.supabase.co` use `https://project-id.storage.supabase.co`"

Non-negotiable config values from the docs:

- `chunkSize: 6 * 1024 * 1024` ("it must be set to 6MB (for now) do not change it")
- `allowedMetaFields: ["bucketName", "objectName", "contentType", "cacheControl", "metadata"]`
- `uploadDataDuringCreation: true`
- `removeFingerprintOnSuccess: true` (needed to allow re-uploading the same file later)
- `retryDelays: [0, 3000, 5000, 10000, 20000]`
- `x-upsert: 'true'` header only if overwrite is wanted; default behavior on an existing path is `400 Asset Already Exists`. We should NOT set it (server issues unique paths; docs also advise against overwriting due to CDN propagation).
- TUS metadata per file: `{ bucketName, objectName, contentType, cacheControl, metadata: JSON.stringify({...}) }` (the last one lands in the `user_metadata` column)

Concurrency semantics (from docs): one client per upload URL; a second client on the same URL gets `409 Conflict`. Two clients racing different upload URLs to the same path: first completion wins, others get 409 (unless x-upsert, then last wins). Irrelevant for us because paths are unique per token.

## Build sketch (exact APIs)

### Server: token mint route (Next.js route handler, Node runtime)

```ts
// app/api/uploads/sign/route.ts
import { createClient } from '@supabase/supabase-js'

// SECRET key: sb_secret_... (or legacy service_role JWT). Server-only env var, never NEXT_PUBLIC.
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)

export async function POST(req: Request) {
  // 1. Verify guest session (our own invite-code cookie), reject otherwise.
  // 2. Rate limit per session + IP (e.g. max N tokens/hour, cap total bytes per session in DB).
  // 3. Server generates the path. Storage file names allow alphanumerics, _-.',!*&$@=;:+?() and whitespace.
  const objectPath = `${sessionId}/${crypto.randomUUID()}.${safeExt}`

  const { data, error } = await admin.storage
    .from('guest-pending')
    .createSignedUploadUrl(objectPath) // no upsert; token valid 2 hours
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // data = { signedUrl, token, path }
  return Response.json({ token: data.token, path: data.path, bucket: 'guest-pending' })
}
```

### Client: Uppy config (pattern from the official signed-uppy example)

```js
import Uppy from '@uppy/core'
import Tus from '@uppy/tus'

const uppy = new Uppy()
uppy.use(Tus, {
  endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable/sign`,
  retryDelays: [0, 3000, 5000, 10000, 20000],
  headers: { apikey: SUPABASE_PUBLISHABLE_KEY }, // publishable key only; harmless, no RLS policies exist
  uploadDataDuringCreation: true,
  removeFingerprintOnSuccess: true,
  chunkSize: 6 * 1024 * 1024, // exactly 6MB, do not change
  allowedMetaFields: ['bucketName', 'objectName', 'contentType', 'cacheControl'],
})

uppy.on('file-added', async (file) => {
  const { token, path, bucket } = await fetch('/api/uploads/sign', {
    method: 'POST',
    body: JSON.stringify({ ext: file.extension, size: file.size }),
  }).then((r) => r.json())

  uppy.setFileMeta(file.id, {
    bucketName: bucket,
    objectName: path,       // must match the token's path exactly
    contentType: file.type,
    cacheControl: '3600',
  })
  uppy.setFileState(file.id, {
    tus: { headers: { 'x-signature': token } }, // per-file signed token
  })
})
```

For plain tus-js-client instead of Uppy: same endpoint, same headers (`apikey` + `x-signature`), same `chunkSize`, `metadata: { bucketName, objectName, contentType, cacheControl }`, plus `upload.findPreviousUploads()` -> `resumeFromPreviousUpload()` for resume.

### Bucket setup (defense in depth, still do this)

```sql
-- private bucket, no RLS policies for anon at all
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guest-pending', 'guest-pending', false, 104857600, array['image/*','video/*']);
```

Also set the project's Global file size limit in Storage Settings to the max you actually accept. Uploads violating bucket restrictions are rejected at upload time.

## Operational notes and edge cases

- **Token (2 h) vs upload URL (24 h):** the signed token expires 2 hours after minting; the TUS upload URL lives up to 24 hours. If a large upload outlives its token, the client should re-request a token for the SAME path on 401/403 and retry (tus-js-client `onShouldRetry`/`onBeforeRequest`, or re-set the Uppy per-file header). For a wedding gallery (phone photos/videos), 2 hours per file is ample; treat re-minting as a nice-to-have retry path, not a launch blocker.
- **Key naming, 2026:** Supabase now issues `sb_publishable_...` (replaces anon JWT) and `sb_secret_...` (replaces service_role JWT); legacy JWT-shaped keys still work. Current docs examples pass the publishable key as the `apikey` header. Use `sb_secret_...` in the server env for minting.
- **createSignedUploadUrl mint calls are cheap** but still go through PostgREST/storage API with the secret key; do them one per file, on demand, not in bulk at page load.
- **Do not pass `upsert: true`** when minting; unique UUID paths make overwrite semantics moot and non-upsert is the safe default.
- **Vercel:** keep the mint route on the Node runtime (supabase-js server client). Upload bytes never touch Vercel.
- **Moving out of guest-pending:** post-upload promotion (guest-pending -> approved bucket/path) is a separate server-side step with the secret key (`storage.from().move()`/`copy()`), out of scope for this spike.

## Sources (checked 2026-07-22)

- Resumable uploads guide (TUS endpoint, 6MB chunk, headers, x-upsert, 24h upload URL, 409 semantics, presigned uploads / x-signature section): https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- Official signed-token Uppy example (endpoint `/storage/v1/upload/resumable/sign`, `apikey` + per-file `x-signature`, service-role minting in an edge function): https://github.com/supabase/supabase/tree/master/examples/storage/resumable-upload-signed-uppy
- storage-js source, `createSignedUploadUrl` / `uploadToSignedUrl` (2-hour validity, upsert option, endpoints): https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts
- JS reference, createSignedUploadUrl ("valid for 2 hours", "without further authentication"): https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl
- Storage access control (RLS on storage.objects, INSERT = upload, bucket_id/name in policies, uploads blocked without policies): https://supabase.com/docs/guides/storage/security/access-control
- Creating buckets (private default, allowedMimeTypes, fileSizeLimit, enforcement at upload): https://supabase.com/docs/guides/storage/buckets/creating-buckets
- File limits (global limit per plan: Free 50 MB, Pro up to 500 GB; resumable up to 50 GB, standard up to 5 GB; file name character rules): https://supabase.com/docs/guides/storage/uploads/file-limits
- Standard uploads (5 GB cap, resumable recommended > 6 MB): https://supabase.com/docs/guides/storage/uploads/standard-uploads
