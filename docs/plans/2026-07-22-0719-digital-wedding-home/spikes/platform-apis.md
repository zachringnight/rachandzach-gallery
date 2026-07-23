# Spike: Platform API contracts (Next.js 16 proxy.ts + Supabase Storage server APIs)

Verified 2026-07-22 against nextjs.org docs (site version 16.2.11, page lastUpdated 2026-05-13), the Next.js 15-to-16 upgrade guide, and current source on `supabase/storage-js` (main) and `supabase/storage` (master). Stack context: Next.js 16.2, supabase-js v2, Node runtime on Vercel.

## Recommendation (act on this)

1. **Route gating**: create `proxy.ts` at the project root (same level as `app/`, or inside `src/`). Export a function named `proxy` (default export also works). It receives a `NextRequest` and returns `NextResponse`, exactly like the old middleware. Runtime is Node.js and CANNOT be configured (setting `runtime` in a proxy file throws; edge runtime is not supported in proxy). `middleware.ts` still works in v16 but is deprecated; do not create one.
2. **Batch signed read URLs**: `supabase.storage.from(bucket).createSignedUrls(paths, expiresIn)`. Server enforces `paths` 1..1000 per call and `expiresIn` integer seconds, minimum 1, no server-side maximum. Chunk requests at a few hundred paths for payload sanity.
3. **Prove remote object exists and matches local bytes without downloading**: at upload time pass `metadata: { fileSha256: '<hex>' }` in `upload()` FileOptions; later call `info(path)`, which returns (camelCased) `size`, `etag`, `contentType`, `cacheControl`, and `metadata` where `metadata` IS the custom metadata you set at upload (server maps `user_metadata` into the response `metadata` field). Compare `info.size === localSize && info.metadata?.fileSha256 === localSha256`. Do not trust `etag` as a byte hash (S3-style, not stable for multipart).
4. **Collision-safe upload**: `upsert` defaults to `false`. On collision the server returns HTTP 409, body `error: 'Duplicate'`, `message: 'The resource already exists'`. supabase-js surfaces this as `{ data: null, error: StorageApiError }` with `error.status === 409` (number) and `error.statusCode === '409'` (string from body). Branch on `error.status === 409`, not on message text.

---

## A) Next.js 16: `proxy.ts` (replaces `middleware.ts`)

### The convention

- File: `proxy.ts` (or `.js`) at project root or in `src/`, same level as `app/`. If `pageExtensions` is customized (e.g. `.page.ts`), name it `proxy.page.ts`.
- Export: exactly ONE function, either `export default function proxy(request) {}` or `export function proxy(request) {}`. Multiple proxies per file are not supported. The named export `middleware` is deprecated.
- Signature: `(request: NextRequest, event?: NextFetchEvent) => Response | NextResponse | Promise<...> | void`. Shorthand type: `import type { NextProxy } from 'next/server'` infers both params.
- Optional `export const config = { matcher: ... }` alongside it. Matcher syntax is UNCHANGED from middleware: string, array of strings, path-to-regexp patterns (`/:path*`, negative lookahead regex), or objects `{ source, locale, has, missing }`. Matcher values must be build-time constants (statically analyzed; variables are ignored).
- Runtime: **Node.js, period.** Docs: "The `runtime` config option is not available in Proxy files. Setting the `runtime` config option in Proxy will throw an error." Upgrade guide: "The `edge` runtime is NOT supported in `proxy`." So Node built-ins (`crypto`, etc.) are fine in proxy on Vercel.
- Request/response API: identical to middleware. `NextRequest` (with `.nextUrl`, `.cookies.get/getAll/set/delete/has/clear`), `NextResponse.next() / .redirect() / .rewrite() / .json()`, plain `Response` also allowed. `event.waitUntil(promise)` via `NextFetchEvent` for background work.
- Deprecated/renamed: `middleware.ts` file and `middleware` export (deprecated, still functional in 16); `skipMiddlewareUrlNormalize` renamed to `skipProxyUrlNormalize` in `next.config`. Codemod: `npx @next/codemod@canary middleware-to-proxy .` (also included in the general `@next/codemod upgrade latest`).
- Testing (experimental, since 15.1): `next/experimental/testing/server` exports `unstable_doesProxyMatch`, `isRewrite`, `getRewrittenUrl`, `getRedirectUrl`.

### Minimal correct `proxy.ts` for session-gating with a public allowlist

```ts
// proxy.ts  (project root, same level as app/)
import { NextResponse, type NextRequest } from 'next/server'

const SESSION_COOKIE = 'gallery_session'

// Exact-match public pages plus prefix-match public routes.
const PUBLIC_EXACT = new Set<string>(['/', '/login'])
const PUBLIC_PREFIXES = ['/api/auth'] // e.g. the login POST endpoint

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublic(pathname)) {
    return NextResponse.next()
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value
  if (!session) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Optionally verify the session token signature here (Node runtime, so
  // node:crypto HMAC verification is available). Keep it cheap; full authz
  // belongs in route handlers / server components.
  return NextResponse.next()
}

export const config = {
  // Run on everything except Next internals and static metadata files.
  // Keep this a literal constant; it is statically analyzed at build time.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
}
```

### Gotchas (all from current official docs)

1. **No `runtime` option**: exporting `runtime` from a proxy file throws at build. If edge is ever truly needed, the only escape hatch is staying on deprecated `middleware.ts`.
2. **Without a matcher, proxy runs on EVERY request** including `_next/static`, `_next/image`, and `public/` assets. A cookie redirect without the negative matcher will block CSS/JS/images.
3. **`_next/data` is always proxied** even when a negative matcher excludes it. Intentional, prevents protecting a page but leaking its data route.
4. **Server Functions ride their route's matcher**: server actions are POSTs to the page route they live on. A matcher that excludes a path silently excludes its actions too. Do not rely on proxy as the only auth layer; re-verify session in every route handler and server function that touches Supabase.
5. **Setting request headers upstream** requires `NextResponse.next({ request: { headers: requestHeaders } })`, NOT `NextResponse.next({ headers })` (the latter sets response headers visible to the client).
6. **RSC flight headers** (`rsc`, `next-router-state-tree`, `next-router-prefetch`) are stripped from `request.headers` in proxy; do not branch on them.
7. **Matcher must be constant**, no template strings from variables.
8. **Proxy runs before filesystem routes** and after `next.config` `headers`/`redirects` (execution order in docs).
9. Next 16 baseline: Node.js >= 20.9, TS >= 5.1, Turbopack default for dev and build. Not proxy-specific but relevant to the build agent.

---

## B) Supabase Storage server APIs (supabase-js v2, service-role client in route handlers)

Client setup assumption: `createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })` server-side only. Service role bypasses RLS, so every storage call below must sit behind the proxy/session gate.

### B1) Batch signed READ URLs: `createSignedUrls`

Exact signature (from `storage-js` `StorageFileApi.ts`, main):

```ts
createSignedUrls(
  paths: string[],
  expiresIn: number,                              // seconds until expiry, e.g. 3600
  options?: { download: string | boolean }        // applies to ALL paths; string sets filename
): Promise<
  | { data: { error: string | null; path: string | null; signedUrl: string }[]; error: null }
  | { data: null; error: StorageError }
>
```

Server-enforced limits (from `supabase/storage` `src/http/routes/object/getSignedURLs.ts` request schema):

- `paths`: `minItems: 1`, `maxItems: MAX_OBJECTS_PER_REQUEST` where `MAX_OBJECTS_PER_REQUEST = 1000` (`src/storage/limits.ts`). Note: some third-party pages claim 100; the server source says 1000.
- `expiresIn`: `type: 'integer', finite: true, minimum: 1`. **No maximum** in the schema. Signed URLs are JWTs signed with the project JWT secret, so rotating that secret invalidates all outstanding signed URLs regardless of TTL. There is no non-expiring signed URL.
- Both fields required.

Behavior notes:

- Partial failure is per-item: a missing object yields `data[i].error` set and `signedUrl` null while the call overall succeeds. Check each entry, do not assume `error: null` at the top level means every URL was minted.
- No `transform` support in the batch call (single `createSignedUrl` accepts `transform`; the batch one only accepts `download`).
- For a gallery page of N images, one call per <=1000 paths; practical chunk size 200-500 keeps request/response bodies small.

```ts
const { data, error } = await supabase.storage
  .from('gallery')
  .createSignedUrls(paths, 60 * 60) // 1 hour
if (error) throw error
for (const item of data) {
  if (item.error) {
    // object missing or inaccessible; item.signedUrl is unusable
  }
}
```

### B2) Existence + byte-match proof WITHOUT downloading: `info()` + custom metadata at upload

**Attach custom metadata at upload** (server SDK): pass `metadata` in FileOptions.

```ts
const { data, error } = await supabase.storage
  .from('gallery')
  .upload(objectPath, buffer, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false, // default, stated for clarity
    metadata: { fileSha256: sha256Hex, sizeBytes: String(buffer.byteLength) },
  })
// data on success: { id, path, fullPath }
```

Transport detail (from `StorageFileApi.uploadOrUpdate`): for non-FormData bodies the SDK sends the metadata as a base64-encoded JSON header `x-metadata`; for FormData it appends a `metadata` form field. Either way it lands in the object's `user_metadata` column server-side. Values should be JSON-serializable; keep them small (they travel in a header).

**Read it back without downloading**: `info(path)`.

```ts
info(path: string): Promise<
  | { data: Camelize<FileObjectV2>; error: null }
  | { data: null; error: StorageError }
>
```

`FileObjectV2` (snake_case in the wire type; the SDK camelizes recursively):

```ts
interface FileObjectV2 {
  id: string
  version: string
  name: string
  bucket_id: string
  updated_at: string
  created_at: string
  last_accessed_at: string
  size?: number          // -> data.size
  cache_control?: string // -> data.cacheControl
  content_type?: string  // -> data.contentType
  etag?: string          // -> data.etag
  last_modified?: string // -> data.lastModified
  metadata?: Record<string, any> // -> data.metadata  (see below)
}
```

Critical mapping, verified in the storage server's InfoRenderer (`src/storage/renderer/info.ts`): the response's `metadata` field is populated from `obj.user_metadata`, i.e. **`info().data.metadata` IS the custom metadata you set at upload**. System facts are surfaced as the separate top-level fields: `size` (from internal metadata.size), `content_type` (mimetype), `cache_control`, `etag`. The endpoint is metadata-only (GET `/object/info/{bucket}/{path}`); it never streams the object body.

Verification recipe:

```ts
const { data: meta, error } = await supabase.storage.from('gallery').info(objectPath)
if (error) {
  // storage server NoSuchKey -> HTTP 404, message 'Object not found'
  // treat as "does not exist"
}
const verified =
  meta.size === localSizeBytes &&
  meta.metadata?.fileSha256 === localSha256Hex
```

Caveats:

- `etag` is S3-style: MD5 of bytes only for single-part uploads, quoted, and NOT a content hash for multipart/TUS uploads. That is why the sha256-in-custom-metadata approach is the contract, with `size` as a cheap cross-check.
- `exists(path)` also exists (HEAD request, resolves `{ data: boolean, error }`), but it proves presence only, no size or hash, so prefer `info()` here.
- `info()`/`exists()`/upload `metadata` shipped in storage-js 2.6+ (mid-2024); any current supabase-js v2 install bundles them. Pin supabase-js `^2.x` latest.

### B3) Upload with `upsert: false` and the collision error

- `FileOptions.upsert` defaults to `false` (SDK default). The SDK transmits it as an `x-upsert: 'false' | 'true'` header on POST uploads.
- On collision with `upsert: false`, the storage server raises `ErrorCode.KeyAlreadyExists` (`src/internal/errors/codes.ts`): HTTP status **409**, body `error: 'Duplicate'`, `message: 'The resource already exists'`.
- supabase-js maps this (via `handleError` in `src/lib/fetch.ts`) to `{ data: null, error: StorageApiError }` where:
  - `error.message === 'The resource already exists'`
  - `error.status === 409` (number, from the HTTP response)
  - `error.statusCode === '409'` (string, from the JSON body, falls back to stringified status)
  - `isStorageError(err)` from `@supabase/storage-js` is the type guard; `StorageApiError` additionally has `toJSON()`.

```ts
import { isStorageError, StorageApiError } from '@supabase/storage-js'

const { data, error } = await supabase.storage.from('gallery').upload(path, bytes, {
  contentType,
  metadata: { fileSha256 },
})
if (error) {
  const isCollision = error instanceof StorageApiError && error.status === 409
  if (isCollision) {
    // Object already there: run the B2 info() check to decide
    // "same bytes, treat as success" vs "conflict, surface it".
  } else {
    throw error
  }
}
```

Branch on `status === 409` (or `statusCode === '409'`), never on the message string.

---

## Sources

- Next.js proxy.js file convention (v16.2.11 docs, lastUpdated 2026-05-13): https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- Next.js 15-to-16 upgrade guide (middleware-to-proxy section, edge runtime not supported in proxy): https://nextjs.org/docs/app/guides/upgrading/version-16
- storage-js method signatures (createSignedUrls, createSignedUrl, info, exists, upload): https://raw.githubusercontent.com/supabase/storage-js/main/src/packages/StorageFileApi.ts
- storage-js types (FileObjectV2, FileOptions, Camelize): https://raw.githubusercontent.com/supabase/storage-js/main/src/lib/types.ts
- storage-js error classes (StorageError, StorageApiError, isStorageError): https://raw.githubusercontent.com/supabase/storage-js/main/src/lib/errors.ts
- storage-js error mapping (handleError -> StorageApiError fields): https://raw.githubusercontent.com/supabase/storage-js/main/src/lib/fetch.ts
- Storage server batch-sign schema (minItems/maxItems, expiresIn minimum 1): https://raw.githubusercontent.com/supabase/storage/master/src/http/routes/object/getSignedURLs.ts
- Storage server limits (MAX_OBJECTS_PER_REQUEST = 1000): https://raw.githubusercontent.com/supabase/storage/master/src/storage/limits.ts
- Storage server info renderer (metadata field = user_metadata; size/content_type/etag mapping): https://raw.githubusercontent.com/supabase/storage/master/src/storage/renderer/info.ts
- Storage server error codes (KeyAlreadyExists 409 'Duplicate' / NoSuchKey 404): https://raw.githubusercontent.com/supabase/storage/master/src/internal/errors/codes.ts
- Storage server object routes (info endpoints are metadata-only): https://raw.githubusercontent.com/supabase/storage/master/src/http/routes/object/getObjectInfo.ts
- Supabase JS reference (createSignedUrl page, for canonical docs link): https://supabase.com/docs/reference/javascript/storage-from-createsignedurl
