/**
 * Download contracts (packet 09).
 *
 * Pure, environment-free types, constants, and helpers shared by the download
 * route handlers, the signing/zip lib modules, the client download buttons,
 * and the tests. Nothing here imports "server-only", next/headers, or a
 * Supabase client, so it is safe to import from client components AND from
 * the node test environment.
 *
 * Download decisions (from the packet and the manifest):
 *   - One-photo download redirects to a short-lived (10-minute) signed
 *     original URL. The original object always comes from the originals or
 *     guest-approved bucket, never a preview.
 *   - A selection accepts at most 50 photo ids and streams a ZIP client-side;
 *     bytes never transit Vercel.
 *   - ZIP filenames preserve approved original filenames and resolve
 *     collisions deterministically.
 */

// --- Constants ---------------------------------------------------------------

/** One-photo download link TTL: 10 minutes, pinned by the packet. */
export const ORIGINAL_DOWNLOAD_URL_TTL_SECONDS = 10 * 60;

/**
 * Selection/ZIP link TTL. Longer than the single-photo TTL: streaming up to
 * MAX_SELECTION_ITEMS large originals client-side can take a while, and a URL
 * expiring mid-ZIP would surface as a confusing partial-failure. 30 minutes
 * comfortably covers a 50-file selection on a slow connection.
 */
export const SELECTION_DOWNLOAD_URL_TTL_SECONDS = 30 * 60;

/** Maximum photos in one selection/ZIP download. Pinned by the packet. */
export const MAX_SELECTION_ITEMS = 50;

/**
 * Above this estimated total, a browser without the File System Access API
 * (bounded Blob fallback only) gets a size warning before the client
 * allocates memory for the whole ZIP in a single Blob.
 */
export const ZIP_FALLBACK_WARNING_BYTES = 1_000_000_000; // 1 GB

// --- Produced interfaces (packet) --------------------------------------------

export interface OriginalDownload {
  photoId: string;
  filename: string;
  bytes: number;
  sha256: string;
  signedUrl: string;
  expiresAt: string;
}

export interface SelectionDownload {
  items: OriginalDownload[];
  /** Always equal to MAX_SELECTION_ITEMS; carried on the payload for clients. */
  maximumItems: number;
  estimatedBytes: number;
}

// --- Errors -------------------------------------------------------------------

/** Invalid caller input (bad id shape, empty selection, over the cap). */
export class DownloadValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "DownloadValidationError";
  }
}

/** No downloadable (approved, correctly bucketed) photo for the given id. */
export class DownloadNotFoundError extends Error {
  readonly status = 404;
  constructor(message = "Photo not found.") {
    super(message);
    this.name = "DownloadNotFoundError";
  }
}

/** Required configuration is missing. Fail closed; routes map this to 500. */
export class DownloadConfigError extends Error {
  readonly status = 500;
  constructor(message: string) {
    super(message);
    this.name = "DownloadConfigError";
  }
}

// --- Filename collisions -------------------------------------------------------

/**
 * Resolves filename collisions deterministically so a ZIP never silently
 * drops or overwrites an entry. The first occurrence of a name (by
 * case-insensitive comparison, matching common filesystem semantics) keeps
 * its original filename; later duplicates are suffixed " (2)", " (3)", etc.
 * before the extension, preserving THEIR OWN original casing/name otherwise.
 * Order-dependent and fully deterministic for a given input array.
 */
export function dedupeFilenames(filenames: readonly string[]): string[] {
  const seenCounts = new Map<string, number>();
  const result: string[] = [];
  for (const name of filenames) {
    const key = name.toLowerCase();
    const priorCount = seenCounts.get(key) ?? 0;
    seenCounts.set(key, priorCount + 1);
    result.push(priorCount === 0 ? name : suffixFilename(name, priorCount + 1));
  }
  return result;
}

function suffixFilename(name: string, occurrence: number): string {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) return `${name} (${occurrence})`;
  const base = name.slice(0, dotIndex);
  const extension = name.slice(dotIndex);
  return `${base} (${occurrence})${extension}`;
}

// --- Integrity ------------------------------------------------------------

/**
 * SHA-256 hex digest via Web Crypto, available in both the Node test runtime
 * (Node 20.9+) and every browser. Used to verify a downloaded original's
 * bytes against GalleryPhotoRecord.fileSha256 / OriginalDownload.sha256.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

// --- Selection helpers (shared by the server lib and tests) ------------------

/**
 * De-duplicates a raw id list (first occurrence wins, order preserved) and
 * drops non-string/empty entries. Pure and reusable so both the server lib
 * and any client-side pre-check can agree on what counts as "the same id".
 */
export function dedupeIds(rawIds: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of rawIds) {
    if (typeof id !== "string" || id.length === 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
