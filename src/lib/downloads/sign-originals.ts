import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { STORAGE_BUCKETS } from "@/lib/supabase/schema";
import {
  DownloadNotFoundError,
  DownloadValidationError,
  MAX_SELECTION_ITEMS,
  ORIGINAL_DOWNLOAD_URL_TTL_SECONDS,
  SELECTION_DOWNLOAD_URL_TTL_SECONDS,
  dedupeFilenames,
  dedupeIds,
  type OriginalDownload,
  type SelectionDownload,
} from "./contracts";

/**
 * Signed original-download URLs (packet 09).
 *
 * The only visible status is "published" (VISIBLE_PHOTO_STATUS in
 * src/lib/gallery/query.ts) and the only allowed source buckets are the
 * immutable originals bucket and the guest-approved bucket -- never a preview
 * object. Both checks are re-applied here in the pure function regardless of
 * what the SQL pre-filter does, the same defense-in-depth pattern
 * src/lib/gallery/query.ts uses for status isolation: a leaky data source can
 * never turn into a downloadable pending/rejected/hidden photo.
 *
 * The data boundary is INJECTABLE (OriginalsDataSource), mirroring
 * src/lib/gallery/query.ts's GalleryDataSource: production wires the
 * Supabase-backed source below; tests inject an in-memory fixture, so
 * getOriginalDownload/getSelectionDownloads are exercised with no live
 * database (see tests/fixtures/downloads/catalog.ts).
 */

type Db = SupabaseClient<Database>;

const DOWNLOADABLE_STATUS = "published";
const DOWNLOADABLE_BUCKETS: ReadonlySet<string> = new Set([
  STORAGE_BUCKETS.originals,
  STORAGE_BUCKETS.guestApproved,
]);

/** Well under Supabase's 1000-path batch-sign ceiling (see the platform spike). */
const MAX_PATHS_PER_SIGN_REQUEST = 200;

export interface OriginalPhotoRow {
  id: string;
  status: string;
  originalBucket: string;
  originalObject: string;
  originalFilename: string;
  originalBytes: number;
  fileSha256: string;
}

export interface SignableOriginal {
  bucket: string;
  objectPath: string;
}

export interface OriginalsDataSource {
  /** Rows for exactly these ids. Order and completeness are NOT guaranteed;
   *  missing ids are simply absent from the result. */
  getPhotosByIds(ids: string[]): Promise<OriginalPhotoRow[]>;
  /** Mints one signed URL with a Content-Disposition filename. Null on failure. */
  signOriginal(
    bucket: string,
    objectPath: string,
    ttlSeconds: number,
    downloadFilename: string,
  ): Promise<string | null>;
  /** Batch-signs many objects (grouped/chunked by bucket). objectPath -> url;
   *  entries that could not be signed are simply absent from the map. */
  signOriginals(
    items: SignableOriginal[],
    ttlSeconds: number,
  ): Promise<Map<string, string>>;
}

// --- Production data source --------------------------------------------------

const SELECT =
  "id, status, original_bucket, original_object, original_filename, original_bytes, file_sha256";

interface RawOriginalRow {
  id: string;
  status: string;
  original_bucket: string;
  original_object: string;
  original_filename: string;
  original_bytes: number;
  file_sha256: string;
}

function mapRow(row: RawOriginalRow): OriginalPhotoRow {
  return {
    id: row.id,
    status: row.status,
    originalBucket: row.original_bucket,
    originalObject: row.original_object,
    originalFilename: row.original_filename,
    originalBytes: row.original_bytes,
    fileSha256: row.file_sha256,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Production OriginalsDataSource over the service-role Supabase client.
 * Guests never touch rachandzach_photos or storage directly: every URL they
 * get is short-lived and signed here, by the route handlers.
 *
 * `client` is a required argument (no default that eagerly constructs an
 * admin client): route handlers call createAdminClient() themselves and pass
 * it in, exactly like src/lib/gallery/supabase-source.ts's production
 * source. That keeps this module free of a top-level "server-only" import
 * (createAdminClient's own module has one), which is what lets
 * getOriginalDownload/getSelectionDownloads stay importable from a plain
 * Node unit test against an injected fixture source.
 */
export function createSupabaseOriginalsDataSource(client: Db): OriginalsDataSource {
  return {
    async getPhotosByIds(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await client
        .from("rachandzach_photos")
        .select(SELECT)
        .in("id", ids);
      if (error || !data) return [];
      return (data as unknown as RawOriginalRow[]).map(mapRow);
    },

    async signOriginal(bucket, objectPath, ttlSeconds, downloadFilename) {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(objectPath, ttlSeconds, { download: downloadFilename });
      if (error || !data?.signedUrl) return null;
      return data.signedUrl;
    },

    async signOriginals(items, ttlSeconds) {
      const urls = new Map<string, string>();
      const byBucket = new Map<string, string[]>();
      const seen = new Set<string>();
      for (const item of items) {
        if (seen.has(item.objectPath)) continue;
        seen.add(item.objectPath);
        const list = byBucket.get(item.bucket) ?? [];
        list.push(item.objectPath);
        byBucket.set(item.bucket, list);
      }
      for (const [bucket, paths] of byBucket) {
        for (const group of chunk(paths, MAX_PATHS_PER_SIGN_REQUEST)) {
          const { data, error } = await client.storage
            .from(bucket)
            .createSignedUrls(group, ttlSeconds);
          if (error || !data) continue; // whole-chunk failure: leave these paths unsigned
          data.forEach((entry, index) => {
            const path = entry.path ?? group[index];
            if (entry.error || !entry.signedUrl || !path) return;
            urls.set(path, entry.signedUrl);
          });
        }
      }
      return urls;
    },
  };
}

// --- Pure logic (data-source injected; unit-testable with no Supabase) -------

function isDownloadable(row: OriginalPhotoRow): boolean {
  return (
    row.status === DOWNLOADABLE_STATUS &&
    DOWNLOADABLE_BUCKETS.has(row.originalBucket)
  );
}

/**
 * Signs a single approved original for download. Throws
 * DownloadNotFoundError for an unknown, pending, hidden, or rejected id (the
 * guest must never learn a non-approved photo exists), or when the object
 * itself cannot be signed (missing from storage).
 */
export async function getOriginalDownload(
  photoId: string,
  source: OriginalsDataSource,
  ttlSeconds: number = ORIGINAL_DOWNLOAD_URL_TTL_SECONDS,
): Promise<OriginalDownload> {
  if (typeof photoId !== "string" || photoId.length === 0) {
    throw new DownloadValidationError("photoId is required.");
  }

  const rows = await source.getPhotosByIds([photoId]);
  const row = rows.find((candidate) => candidate.id === photoId);
  if (!row || !isDownloadable(row)) {
    throw new DownloadNotFoundError();
  }

  const signedUrl = await source.signOriginal(
    row.originalBucket,
    row.originalObject,
    ttlSeconds,
    row.originalFilename,
  );
  if (!signedUrl) {
    throw new DownloadNotFoundError();
  }

  return {
    photoId: row.id,
    filename: row.originalFilename,
    bytes: row.originalBytes,
    sha256: row.fileSha256,
    signedUrl,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
}

/**
 * Signs a batch of approved originals in one pass. Duplicate,
 * unknown, and non-approved ids are silently dropped rather than erroring,
 * matching the ids-lookup semantics of getGalleryPage in
 * src/lib/gallery/query.ts. Only truly invalid input (no array, empty after
 * de-duplication, or over MAX_SELECTION_ITEMS) throws.
 */
export async function getSelectionDownloads(
  photoIds: readonly unknown[],
  source: OriginalsDataSource,
  ttlSeconds: number = SELECTION_DOWNLOAD_URL_TTL_SECONDS,
): Promise<SelectionDownload> {
  if (!Array.isArray(photoIds)) {
    throw new DownloadValidationError("photoIds must be an array.");
  }
  const uniqueIds = dedupeIds(photoIds);
  if (uniqueIds.length === 0) {
    throw new DownloadValidationError("At least one photo id is required.");
  }
  if (uniqueIds.length > MAX_SELECTION_ITEMS) {
    throw new DownloadValidationError(
      `A selection accepts at most ${MAX_SELECTION_ITEMS} photos (received ${uniqueIds.length}).`,
    );
  }

  const rows = await source.getPhotosByIds(uniqueIds);
  const byId = new Map(rows.map((row) => [row.id, row]));
  // Preserve the caller's order; drop unknown/non-approved/mis-bucketed ids.
  const downloadable = uniqueIds
    .map((id) => byId.get(id))
    .filter((row): row is OriginalPhotoRow => Boolean(row) && isDownloadable(row!));

  if (downloadable.length === 0) {
    return { items: [], maximumItems: MAX_SELECTION_ITEMS, estimatedBytes: 0 };
  }

  const dedupedNames = dedupeFilenames(
    downloadable.map((row) => row.originalFilename),
  );
  const urls = await source.signOriginals(
    downloadable.map((row) => ({
      bucket: row.originalBucket,
      objectPath: row.originalObject,
    })),
    ttlSeconds,
  );
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const items: OriginalDownload[] = [];
  downloadable.forEach((row, index) => {
    const signedUrl = urls.get(row.originalObject);
    // Per-item signing failure (e.g. object missing in storage): skip it and
    // surface the rest of the selection rather than failing the whole batch.
    if (!signedUrl) return;
    items.push({
      photoId: row.id,
      filename: dedupedNames[index],
      bytes: row.originalBytes,
      sha256: row.fileSha256,
      signedUrl,
      expiresAt,
    });
  });

  const estimatedBytes = items.reduce((sum, item) => sum + item.bytes, 0);
  return { items, maximumItems: MAX_SELECTION_ITEMS, estimatedBytes };
}
