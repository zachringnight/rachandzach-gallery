/**
 * Upload validation (packet 08).
 *
 * Pure functions: magic-byte sniffing, per-file validation, display-name
 * normalization, and server-issued object-path construction. No environment,
 * no client. Safe to import from the browser upload client and from tests.
 *
 * HEIC scope for this packet (pinned by review): submit-time validation is
 * magic-byte sniffing ONLY (ftyp + heic/heix/hevc/hevx/mif1/msf1 brands).
 * Full HEIC decode happens at approval time in packet 10; heic-decode is not
 * imported here.
 */
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  MAX_FILE_BYTES,
  type UploadMediaType,
} from "./contracts";

// --- Magic-byte sniffing ---------------------------------------------------

export type SniffResult =
  | "jpeg"
  | "png"
  | "webp"
  | "heic"
  | "avif"
  | "unknown";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx"]);
const HEIF_STRUCTURAL = new Set(["mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

/**
 * Sniffs the leading bytes of an image. Mirrors the verified table in the HEIC
 * spike. Never trusts the declared MIME type or file extension.
 */
export function sniffImage(buf: Uint8Array): SniffResult {
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && // R
    buf[1] === 0x49 && // I
    buf[2] === 0x46 && // F
    buf[3] === 0x46 && // F
    buf[8] === 0x57 && // W
    buf[9] === 0x45 && // E
    buf[10] === 0x42 && // B
    buf[11] === 0x50 // P
  ) {
    return "webp";
  }

  // ISO-BMFF: 'ftyp' at offset 4, major brand at offset 8.
  if (
    buf.length >= 16 &&
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  ) {
    const brandAt = (offset: number): string =>
      String.fromCharCode(
        buf[offset],
        buf[offset + 1],
        buf[offset + 2],
        buf[offset + 3],
      ).trim();
    const major = brandAt(8);
    if (HEIC_BRANDS.has(major)) return "heic";
    if (AVIF_BRANDS.has(major)) return "avif";
    if (HEIF_STRUCTURAL.has(major)) {
      const boxSize =
        ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
      const end = Math.min(boxSize || buf.length, buf.length);
      for (let offset = 16; offset + 4 <= end; offset += 4) {
        const brand = brandAt(offset);
        if (HEIC_BRANDS.has(brand)) return "heic";
        if (AVIF_BRANDS.has(brand)) return "avif";
      }
      // Structural HEIF with no decisive compatible brand: treat as HEIC. The
      // decoder fails safely at approval time if it is not actually decodable.
      return "heic";
    }
  }
  return "unknown";
}

const SNIFF_TO_MIME: Readonly<Record<string, UploadMediaType>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

/**
 * True when the leading bytes sniff to exactly the given media type. Used by
 * the submit route to re-verify uploaded bytes against the declared item type
 * (magic-byte scope for this packet; full decode is packet 10).
 */
export function magicMatchesMediaType(
  head: Uint8Array,
  mediaType: string,
): boolean {
  const mime = SNIFF_TO_MIME[sniffImage(head)];
  return mime !== undefined && mime === mediaType;
}

// --- Per-file validation ---------------------------------------------------

export type UploadRejectionReason =
  | "empty-file"
  | "file-too-large"
  | "unsupported-extension"
  | "unsupported-type"
  | "magic-byte-mismatch"
  | "declared-type-mismatch";

export interface ValidateUploadInput {
  filename: string;
  declaredType: string;
  bytes: number;
  /** Leading bytes of the file (at least the first 16 for ISO-BMFF sniffing). */
  head: Uint8Array;
}

export type ValidateUploadResult =
  | {
      ok: true;
      /** Authoritative media type, taken from the magic bytes, not the client. */
      mediaType: UploadMediaType;
      normalizedName: string;
      sniffed: SniffResult;
    }
  | { ok: false; reason: UploadRejectionReason };

/**
 * Validates a single guest file against the pinned allowlist. Order matters:
 * cheap size and name checks first, then the authoritative magic-byte check,
 * then declared/actual reconciliation. SVG, archives, documents, executables,
 * video, and any MIME-vs-magic mismatch are rejected before any token issues.
 */
export function validateUploadFile(
  input: ValidateUploadInput,
): ValidateUploadResult {
  if (!Number.isFinite(input.bytes) || input.bytes <= 0) {
    return { ok: false, reason: "empty-file" };
  }
  if (input.bytes > MAX_FILE_BYTES) {
    return { ok: false, reason: "file-too-large" };
  }

  const extension = fileExtension(input.filename);
  const extensionMime = extension
    ? ALLOWED_UPLOAD_EXTENSIONS[extension]
    : undefined;
  if (!extensionMime) {
    return { ok: false, reason: "unsupported-extension" };
  }

  if (
    !(Object.values(ALLOWED_UPLOAD_EXTENSIONS) as string[]).includes(
      input.declaredType,
    )
  ) {
    return { ok: false, reason: "unsupported-type" };
  }

  const sniffed = sniffImage(input.head);
  const actualMime = SNIFF_TO_MIME[sniffed];
  if (!actualMime) {
    // "unknown" or AVIF (not on this packet's allowlist): reject on the bytes.
    return { ok: false, reason: "magic-byte-mismatch" };
  }

  // The declared type and the extension must both agree with the real bytes.
  if (actualMime !== input.declaredType || actualMime !== extensionMime) {
    return { ok: false, reason: "declared-type-mismatch" };
  }

  return {
    ok: true,
    mediaType: actualMime,
    normalizedName: normalizeDisplayFilename(input.filename),
    sniffed,
  };
}

function fileExtension(filename: string): string | null {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Normalizes a guest filename for display ONLY. Strips any path component,
 * control characters, and leading dots, and caps the length. The result is
 * never used as an object path (see buildPendingObjectPath).
 */
export function normalizeDisplayFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const stripped = base.replace(/[\u0000-\u001f\u007f]/g, "");
  const cleaned = stripped.replace(/^\.+/, "").trim();
  return cleaned.slice(0, 255) || "photo";
}

// --- Server-issued object paths --------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE_RE = /^[0-9a-f]{32}$/;

/** 16 random bytes as hex. Server-chosen so guests cannot collide paths. */
export function generateObjectNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Builds the server-issued object path pending/{batchId}/{itemId}/{nonce}. All
 * three components are validated: the guest never influences the object path,
 * and a guest filename can never become one.
 */
export function buildPendingObjectPath(
  batchId: string,
  itemId: string,
  nonce: string,
): string {
  if (!UUID_RE.test(batchId)) {
    throw new Error("buildPendingObjectPath: batchId must be a UUID.");
  }
  if (!UUID_RE.test(itemId)) {
    throw new Error("buildPendingObjectPath: itemId must be a UUID.");
  }
  if (!NONCE_RE.test(nonce)) {
    throw new Error("buildPendingObjectPath: nonce must be 32 hex chars.");
  }
  return `pending/${batchId}/${itemId}/${nonce}`;
}
