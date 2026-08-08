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
/**
 * Eight hours, raised from the original sixty minutes.
 *
 * The TTL is not just an expiry, it is a CACHE KEY: the browser caches on the
 * full URL including `?token=`, and GalleryShell renews the whole set shortly
 * before expiry, replacing every `<img src>`. So the old one-hour default made
 * a guest who had been browsing for an hour re-download every image they had
 * already loaded, at full size, in one burst. The preview objects themselves
 * are already stored `public,max-age=31536000,immutable`; the rotating token
 * was the only thing defeating that.
 *
 * Eight hours comfortably outlives any real sitting, so a normal visit never
 * pays the re-download. The privacy cost is small and bounded: the gallery is
 * gated behind a shared password that never rotates, so a leaked preview URL
 * was never the tight part of this system, and it still expires the same day.
 *
 * Still overridable per environment, no code change:
 *   GALLERY_PREVIEW_URL_TTL_SECONDS=10800   # 3 hours
 */
const PREVIEW_TTL_DEFAULT_SECONDS = 8 * 60 * 60;

/** Well under the server's 1000-path ceiling; keeps request/response small. */
export const MAX_PATHS_PER_SIGN_REQUEST = 200;

/**
 * Preview TTL, in seconds. THE single tunable constant for signed preview
 * lifetime (packet behavior + task 12 egress tuning). Defaults to 8 hours
 * (PREVIEW_TTL_DEFAULT_SECONDS above, which explains why); lengthen or
 * shorten it purely through the environment, no code change:
 *
 *   GALLERY_PREVIEW_URL_TTL_SECONDS=10800   # 3 hours
 *
 * Values below PREVIEW_TTL_FLOOR_SECONDS (60 seconds) or unparseable fall
 * back to that default. The floor is what stops a fat-fingered 0 or 5 from
 * signing URLs that expire before the page has finished painting.
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
  if (!Number.isFinite(parsed) || parsed < PREVIEW_TTL_FLOOR_SECONDS) {
    return PREVIEW_TTL_DEFAULT_SECONDS;
  }
  return parsed;
}

/**
 * The TTL actually used, floor applied. Both the signing call and the expiry
 * it reports run through this, so they cannot disagree: clamping only the
 * reported timestamp would promise callers a lifetime the URL does not have,
 * and GalleryShell's pre-expiry renewal would fire after every tile had
 * already 403'd.
 */
function resolveTtlSeconds(ttlSeconds: number): number {
  return Number.isFinite(ttlSeconds)
    ? Math.max(Math.trunc(ttlSeconds), PREVIEW_TTL_FLOOR_SECONDS)
    : PREVIEW_URL_TTL_SECONDS;
}

/** ISO timestamp at which URLs signed now (with `ttlSeconds`) will expire. */
export function previewExpiresAt(
  ttlSeconds: number = PREVIEW_URL_TTL_SECONDS,
  now: number = Date.now(),
): string {
  return new Date(now + resolveTtlSeconds(ttlSeconds) * 1000).toISOString();
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
  const ttl = resolveTtlSeconds(ttlSeconds);
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

  /*
   * Sign every chunk concurrently rather than one after another.
   *
   * These calls are independent -- each mints URLs for a disjoint set of
   * paths -- so awaiting them in sequence bought nothing but latency. A
   * gallery page signs ~420 paths, which is 3 chunks and was 3 serial
   * round trips to us-west-2; now it is 1 round trip's worth of wall clock.
   * Chunking is still bounded well under the API's 1000-path ceiling, and
   * the number of concurrent calls scales with the request's own path count,
   * so this cannot fan out unboundedly.
   *
   * Failure handling is unchanged and stays per-chunk: a rejected or errored
   * chunk marks only its own paths unsigned, and the page still renders with
   * a per-tile retry. Errors are caught per chunk so one bad bucket cannot
   * reject the whole batch.
   */
  const jobs: { bucket: string; group: string[] }[] = [];
  for (const [bucket, paths] of byBucket) {
    for (const group of chunk(paths, MAX_PATHS_PER_SIGN_REQUEST)) {
      jobs.push({ bucket, group });
    }
  }

  const settled = await Promise.all(
    jobs.map(async ({ bucket, group }) => {
      try {
        const { data, error } = await client.storage
          .from(bucket)
          .createSignedUrls(group, ttl);
        return { group, data: error ? null : data };
      } catch {
        return { group, data: null };
      }
    }),
  );

  for (const { group, data } of settled) {
    if (!data) {
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

  return { urls, expiresAt: previewExpiresAt(ttl, now), failures };
}
