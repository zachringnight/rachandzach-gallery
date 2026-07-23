/**
 * Batch signed preview URLs for the gallery (packet 06).
 *
 * Preview objects live in PRIVATE Supabase Storage buckets. The browser never
 * receives an object path, a bucket name via a public route, or a service-role
 * key; it only receives short-lived signed URLs minted here, server-side.
 *
 * The batch signing contract is verified in
 * docs/plans/2026-07-22-0719-digital-wedding-home/spikes/platform-apis.md:
 *   supabase.storage.from(bucket).createSignedUrls(paths, expiresIn)
 *   - paths: 1..1000 per call (we chunk far below that)
 *   - expiresIn: integer seconds, minimum 1, no server maximum
 *   - partial failure is per-item: data[i].error set, signedUrl null
 *
 * This module keeps NO heavy runtime imports at module load: the Supabase
 * client is passed in by the caller (a route handler that already built the
 * service-role admin client). That keeps src/lib/gallery/query.ts, which only
 * needs the TTL constant below, cheap to import from unit tests.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/** Never mint a URL shorter than this; guards against a fat-fingered "0". */
const PREVIEW_TTL_FLOOR_SECONDS = 60;
const PREVIEW_TTL_DEFAULT_SECONDS = 60 * 60;

/** Well under the server's 1000-path ceiling; keeps request/response small. */
export const MAX_PATHS_PER_SIGN_REQUEST = 200;

/**
 * Preview TTL, in seconds. THE single tunable constant for signed preview
 * lifetime (packet behavior + task 12 egress tuning). Defaults to 60 minutes;
 * task 12 can lengthen it purely through the environment, no code change:
 *
 *   GALLERY_PREVIEW_URL_TTL_SECONDS=10800   # 3 hours
 *
 * Values below the floor (or unparseable) fall back to the 60-minute default.
 */
export const PREVIEW_URL_TTL_SECONDS: number = readPreviewTtlSeconds();

function readPreviewTtlSeconds(): number {
  // `typeof` guard: this module is deliberately importable without
  // "server-only" (see header), so it can land in non-Next browser bundles
  // where a bare `process` reference throws at module scope.
  const raw =
    typeof process === "undefined"
      ? undefined
      : process.env.GALLERY_PREVIEW_URL_TTL_SECONDS;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return PREVIEW_TTL_DEFAULT_SECONDS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 60) {
    return PREVIEW_TTL_DEFAULT_SECONDS;
  }
  return parsed;
}

/** ISO timestamp at which URLs signed now (with `ttlSeconds`) will expire. */
export function previewExpiresAt(
  ttlSeconds: number = PREVIEW_URL_TTL_SECONDS,
  now: number = Date.now(),
): string {
  const ttl = Number.isFinite(ttlSeconds)
    ? Math.max(Math.trunc(ttlSeconds), PREVIEW_TTL_FLOOR_SECONDS)
    : PREVIEW_URL_TTL_SECONDS;
  return new Date(now + ttl * 1000).toISOString();
}

/** A private preview object that needs a signed URL. */
export interface SignablePreview {
  bucket: string;
  objectPath: string;
}

export interface SignedPreviewBatch {
  /** objectPath -> signed URL. Missing entries could not be signed. */
  urls: Map<string, string>;
  expiresAt: string;
  /** Object paths the storage server could not sign (missing/inaccessible). */
  failures: string[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Batch-signs the given preview objects. Groups by bucket, chunks each bucket
 * under the per-request ceiling, and tolerates per-item failures without
 * failing the whole page. Callers pass the service-role client; nothing here
 * reads credentials or leaks object paths to the client.
 */
export async function signPreviewUrls(
  client: SupabaseClient<Database>,
  previews: SignablePreview[],
  ttlSeconds: number = PREVIEW_URL_TTL_SECONDS,
  now: number = Date.now(),
): Promise<SignedPreviewBatch> {
  const urls = new Map<string, string>();
  const failures: string[] = [];

  // De-duplicate by objectPath (many photos can share nothing, but a page can
  // legitimately repeat a path if the same preview is requested twice).
  const byBucket = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const preview of previews) {
    if (seen.has(preview.objectPath)) continue;
    seen.add(preview.objectPath);
    const list = byBucket.get(preview.bucket) ?? [];
    list.push(preview.objectPath);
    byBucket.set(preview.bucket, list);
  }

  for (const [bucket, paths] of byBucket) {
    for (const group of chunk(paths, MAX_PATHS_PER_SIGN_REQUEST)) {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrls(group, ttlSeconds);
      if (error || !data) {
        // Whole-chunk failure: mark every path in it as unsigned. The page
        // still renders; the client shows a retry affordance per tile.
        for (const path of group) failures.push(path);
        continue;
      }
      data.forEach((item, index) => {
        const path = item.path ?? group[index];
        if (item.error || !item.signedUrl || !path) {
          if (path) failures.push(path);
          return;
        }
        urls.set(path, item.signedUrl);
      });
    }
  }

  return { urls, expiresAt: previewExpiresAt(ttlSeconds, now), failures };
}
