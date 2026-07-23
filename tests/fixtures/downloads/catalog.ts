/**
 * Deterministic in-memory OriginalsDataSource fixture for packet 09 download
 * tests. No live database or storage: getPhotosByIds reads from a fixed row
 * table, and signOriginal/signOriginals mint fake-but-realistic signed URLs
 * while recording every call so tests can assert on what was actually
 * requested (bucket, object path, TTL, download filename).
 */
import type {
  OriginalPhotoRow,
  OriginalsDataSource,
  SignableOriginal,
} from "@/lib/downloads/sign-originals";
import { STORAGE_BUCKETS } from "@/lib/supabase/schema";

/** Deterministic 64-hex-char stand-in for a real SHA-256 digest. */
function fakeSha256(seed: string): string {
  const hex = Buffer.from(seed, "utf8").toString("hex");
  return hex.repeat(Math.ceil(64 / hex.length)).slice(0, 64);
}

export interface SignOriginalCall {
  bucket: string;
  objectPath: string;
  ttlSeconds: number;
  downloadFilename: string;
}

export interface SignOriginalsCall {
  items: SignableOriginal[];
  ttlSeconds: number;
}

export interface DownloadsFixture {
  source: OriginalsDataSource;
  rows: OriginalPhotoRow[];
  /** Photo ids the fixture will return an approved, downloadable row for. */
  approvedIds: string[];
  pendingId: string;
  hiddenId: string;
  rejectedId: string;
  /** Approved row whose original object lives in a bucket other than
   *  originals/guest-approved (a previews leak this must never allow). */
  wrongBucketId: string;
  /** An id with no matching row at all. */
  unknownId: string;
  signCalls: SignOriginalCall[];
  batchSignCalls: SignOriginalsCall[];
}

export interface DownloadsFixtureOptions {
  /** Object paths signOriginal/signOriginals should fail to sign (simulates
   *  the object being missing from storage). */
  unsignableObjectPaths?: string[];
}

export function buildDownloadsFixture(
  options: DownloadsFixtureOptions = {},
): DownloadsFixture {
  const unsignable = new Set(options.unsignableObjectPaths ?? []);

  const rows: OriginalPhotoRow[] = [
    {
      id: "photo-ceremony-1",
      status: "published",
      originalBucket: STORAGE_BUCKETS.originals,
      originalObject: "originals/aa/ceremony-1.jpg",
      originalFilename: "IMG_0001.JPG",
      originalBytes: 4_200_000,
      fileSha256: fakeSha256("ceremony-1"),
    },
    {
      id: "photo-ceremony-2",
      status: "published",
      originalBucket: STORAGE_BUCKETS.originals,
      originalObject: "originals/bb/ceremony-2.jpg",
      originalFilename: "IMG_0002.JPG",
      originalBytes: 3_800_000,
      fileSha256: fakeSha256("ceremony-2"),
    },
    // Same original_filename as photo-ceremony-1 (different photo, different
    // event) -- exercises deterministic filename-collision resolution. Also
    // differs only by case, to exercise the case-insensitive comparison.
    {
      id: "photo-reception-1",
      status: "published",
      originalBucket: STORAGE_BUCKETS.guestApproved,
      originalObject: "guest-approved/cc/reception-1.jpg",
      originalFilename: "img_0001.jpg",
      originalBytes: 5_100_000,
      fileSha256: fakeSha256("reception-1"),
    },
    {
      id: "photo-reception-2",
      status: "published",
      originalBucket: STORAGE_BUCKETS.originals,
      originalObject: "originals/dd/reception-2.jpg",
      originalFilename: "IMG_0001.JPG",
      originalBytes: 2_900_000,
      fileSha256: fakeSha256("reception-2"),
    },
    {
      id: "photo-pending-1",
      status: "pending",
      originalBucket: STORAGE_BUCKETS.guestPending,
      originalObject: "pending/batch-1/item-1/nonce",
      originalFilename: "pending-upload.jpg",
      originalBytes: 1_000_000,
      fileSha256: fakeSha256("pending-1"),
    },
    {
      id: "photo-hidden-1",
      status: "hidden",
      originalBucket: STORAGE_BUCKETS.originals,
      originalObject: "originals/ee/hidden-1.jpg",
      originalFilename: "IMG_9001.JPG",
      originalBytes: 4_000_000,
      fileSha256: fakeSha256("hidden-1"),
    },
    {
      id: "photo-rejected-1",
      status: "rejected",
      originalBucket: STORAGE_BUCKETS.guestApproved,
      originalObject: "guest-approved/ff/rejected-1.jpg",
      originalFilename: "IMG_9002.JPG",
      originalBytes: 4_100_000,
      fileSha256: fakeSha256("rejected-1"),
    },
    // Approved status but points at the previews bucket -- must never be
    // treated as downloadable even though status alone would pass.
    {
      id: "photo-wrong-bucket-1",
      status: "published",
      originalBucket: STORAGE_BUCKETS.previews,
      originalObject: "previews/gg/1600.jpeg",
      originalFilename: "IMG_9003.JPG",
      originalBytes: 900_000,
      fileSha256: fakeSha256("wrong-bucket-1"),
    },
  ];

  const byId = new Map(rows.map((row) => [row.id, row]));
  const signCalls: SignOriginalCall[] = [];
  const batchSignCalls: SignOriginalsCall[] = [];

  const source: OriginalsDataSource = {
    async getPhotosByIds(ids) {
      const found: OriginalPhotoRow[] = [];
      for (const id of ids) {
        const row = byId.get(id);
        if (row) found.push(row);
      }
      return found;
    },

    async signOriginal(bucket, objectPath, ttlSeconds, downloadFilename) {
      signCalls.push({ bucket, objectPath, ttlSeconds, downloadFilename });
      if (unsignable.has(objectPath)) return null;
      return `https://storage.test/${bucket}/${encodeURIComponent(objectPath)}?ttl=${ttlSeconds}&download=${encodeURIComponent(downloadFilename)}`;
    },

    async signOriginals(items, ttlSeconds) {
      batchSignCalls.push({ items, ttlSeconds });
      const urls = new Map<string, string>();
      for (const item of items) {
        if (unsignable.has(item.objectPath)) continue;
        urls.set(
          item.objectPath,
          `https://storage.test/${item.bucket}/${encodeURIComponent(item.objectPath)}?ttl=${ttlSeconds}`,
        );
      }
      return urls;
    },
  };

  return {
    source,
    rows,
    approvedIds: [
      "photo-ceremony-1",
      "photo-ceremony-2",
      "photo-reception-1",
      "photo-reception-2",
    ],
    pendingId: "photo-pending-1",
    hiddenId: "photo-hidden-1",
    rejectedId: "photo-rejected-1",
    wrongBucketId: "photo-wrong-bucket-1",
    unknownId: "photo-does-not-exist",
    signCalls,
    batchSignCalls,
  };
}
