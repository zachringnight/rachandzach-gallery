/**
 * Guest upload contracts (packet 08).
 *
 * Pure, environment-free types, constants, schemas, and helpers shared by the
 * upload routes, the upload lib modules, and the tests. Nothing here imports
 * "server-only", next/headers, or a Supabase client, so it is safe to import
 * from the browser upload client AND from the node test environment.
 *
 * Binding validation rules (from the packet and the manifest):
 *   - JPEG, PNG, WebP, HEIC only.
 *   - Max 50 files per batch, max 50 MB per file.
 *   - Object path is server-issued: pending/{batchId}/{itemId}/{randomNonce}.
 *   - Receipt tokens are hashed (SHA-256) before database storage.
 *   - Status exposes state and counts only, never object paths or filenames.
 */
import { z } from "zod";
import { STORAGE_BUCKETS } from "@/lib/supabase/schema";

// --- Constants -------------------------------------------------------------

/** Quarantine bucket for guest uploads (landed name carries the prefix). */
export const GUEST_PENDING_BUCKET = STORAGE_BUCKETS.guestPending;

/** The only media types a guest may upload. Mirrored in Postgres + bucket. */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export type UploadMediaType = (typeof ALLOWED_UPLOAD_MIME_TYPES)[number];

/** Filename extensions that may map onto an allowed media type. */
export const ALLOWED_UPLOAD_EXTENSIONS: Readonly<Record<string, UploadMediaType>> =
  {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heic",
  };

/** Max files per submitted batch. Application-level cap. */
export const MAX_FILES_PER_BATCH = 50;

/** Max bytes per file: 50 MB, mirrored at the bucket and table level. */
export const MAX_FILE_BYTES = 52_428_800;

/**
 * TUS chunk size. The Supabase resumable endpoint requires EXACTLY 6 MB; the
 * spike is explicit: "it must be set to 6MB (for now) do not change it".
 */
export const UPLOAD_TUS_CHUNK_SIZE = 6 * 1024 * 1024;

/** Retry backoff pinned by the spike. */
export const UPLOAD_TUS_RETRY_DELAYS = [0, 3000, 5000, 10000, 20000] as const;

/** TUS metadata fields the Supabase endpoint accepts. */
export const UPLOAD_TUS_ALLOWED_META_FIELDS = [
  "bucketName",
  "objectName",
  "contentType",
  "cacheControl",
] as const;

/** Path segment appended to the storage origin for signed resumable uploads. */
export const RESUMABLE_SIGN_ENDPOINT_PATH =
  "/storage/v1/upload/resumable/sign";

/**
 * A signed upload token is valid for 2 hours (Supabase-fixed, per the spike).
 * Surfaced to the client so it can re-request a token for the same path near
 * expiry on a long upload.
 */
export const SIGNED_UPLOAD_TOKEN_TTL_SECONDS = 2 * 60 * 60;

/**
 * A draft batch that is never submitted expires after this window; its receipt
 * then resolves to the terminal "expired" state. Submitted/approved/rejected
 * batches never expire.
 */
export const UPLOAD_BATCH_TTL_SECONDS = 24 * 60 * 60;

/** Guest-facing states surfaced by the status endpoint. */
export const UPLOAD_STATES = [
  "draft",
  "uploading",
  "submitted",
  "approved",
  "partially_approved",
  "rejected",
  "expired",
] as const;

export type UploadState = (typeof UPLOAD_STATES)[number];

// --- Produced interfaces (packet) ------------------------------------------

export interface CreateUploadBatchInput {
  displayName: string | null;
  email: string | null;
  note: string | null;
  itemCount: number;
}

export interface UploadBatchReceipt {
  batchId: string;
  receiptToken: string;
  expiresAt: string;
}

export interface SignedUploadTarget {
  itemId: string;
  objectPath: string;
  signedToken: string;
  tusEndpoint: string;
  expiresAt: string;
}

export interface UploadCounts {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  removed: number;
}

/**
 * Everything the status endpoint is allowed to reveal. Deliberately excludes
 * object paths, signed URLs, filenames, email, and note: pending objects stay
 * inaccessible to the submitting guest after upload.
 */
export interface PublicUploadStatus {
  batchId: string;
  state: UploadState;
  counts: UploadCounts;
  submittedAt: string | null;
  expiresAt: string;
}

/** Per-file metadata accepted at sign time (declared, not yet byte-verified). */
export interface SignUploadFileInput {
  originalName: string;
  mediaType: UploadMediaType;
  bytes: number;
  /** Optional browser SHA-256 hint; treated as advisory until server verify. */
  sha256?: string | null;
}

// --- Schemas ---------------------------------------------------------------

/**
 * Email shape mirrors the Postgres check on rachandzach_upload_batches.email:
 * one @, no whitespace, a dotted domain.
 */
export const UPLOAD_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const nullableTrimmed = (schema: z.ZodString) =>
  z.preprocess((value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === "string" && value.trim().length === 0) return null;
    return value;
  }, schema.nullable());

export const createUploadBatchInputSchema = z.object({
  displayName: nullableTrimmed(z.string().trim().min(1).max(120)),
  email: nullableTrimmed(z.string().trim().max(254).regex(UPLOAD_EMAIL_RE)),
  note: nullableTrimmed(z.string().max(2000)),
  itemCount: z
    .number()
    .int()
    .min(1)
    .max(MAX_FILES_PER_BATCH),
});

export const signUploadFileInputSchema = z.object({
  originalName: z.string().min(1).max(1024),
  mediaType: z.enum(ALLOWED_UPLOAD_MIME_TYPES),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(MAX_FILE_BYTES),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullish(),
});

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseCreateUploadBatchInput(
  raw: unknown,
): ParseResult<CreateUploadBatchInput> {
  const result = createUploadBatchInputSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: firstIssueMessage(result.error) };
  }
  return { ok: true, value: result.data };
}

export function parseSignUploadFileInput(
  raw: unknown,
): ParseResult<SignUploadFileInput> {
  const result = signUploadFileInputSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: firstIssueMessage(result.error) };
  }
  return {
    ok: true,
    value: {
      originalName: result.data.originalName,
      mediaType: result.data.mediaType,
      bytes: result.data.bytes,
      sha256: result.data.sha256 ?? null,
    },
  };
}

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid input.";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

// --- Errors ----------------------------------------------------------------

/** Guest input failed validation. Routes map this to HTTP 422. */
export class UploadValidationError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

/** A database or storage operation failed. Routes map this to HTTP 500. */
export class UploadPersistenceError extends Error {
  readonly status = 500;
  constructor(message: string) {
    super(message);
    this.name = "UploadPersistenceError";
  }
}

/** Required configuration is missing. Fail closed; routes map this to 500. */
export class UploadConfigError extends Error {
  readonly status = 500;
  constructor(message: string) {
    super(message);
    this.name = "UploadConfigError";
  }
}

// --- UUID -------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// --- Receipt tokens --------------------------------------------------------

const RECEIPT_TOKEN_BYTES = 24;

/**
 * Mints an opaque, high-entropy receipt token. The plaintext is handed to the
 * guest once (in the receipt) and NEVER stored; only its hash goes to the
 * database.
 */
export function generateReceiptToken(): string {
  const bytes = new Uint8Array(RECEIPT_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * Hashes a receipt token for storage/lookup. SHA-256 hex (64 chars) satisfies
 * the receipt_hash check `^[0-9a-f]{32,64}$`. Deterministic so status lookups
 * can match, one-way so a leaked database row never yields a working token.
 */
export async function hashReceiptToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toHex(new Uint8Array(digest));
}

// --- State + counts --------------------------------------------------------

/**
 * Maps a database batch status onto the guest-facing state, deriving the two
 * states the schema has no column for: "uploading" (a draft that already has
 * item rows) and "expired" (a draft past its TTL).
 */
export function resolveBatchState(
  dbStatus: string,
  itemCount: number,
  createdAtMs: number,
  nowMs: number = Date.now(),
): UploadState {
  switch (dbStatus) {
    case "approved":
      return "approved";
    case "partially_approved":
      return "partially_approved";
    case "rejected":
      return "rejected";
    case "submitted":
    case "under_review":
      return "submitted";
    case "draft":
    default: {
      if (
        Number.isFinite(createdAtMs) &&
        nowMs - createdAtMs > UPLOAD_BATCH_TTL_SECONDS * 1000
      ) {
        return "expired";
      }
      return itemCount > 0 ? "uploading" : "draft";
    }
  }
}

export function summarizeItemCounts(
  items: ReadonlyArray<{ status: string }>,
): UploadCounts {
  const counts: UploadCounts = {
    total: items.length,
    pending: 0,
    approved: 0,
    rejected: 0,
    removed: 0,
  };
  for (const item of items) {
    switch (item.status) {
      case "pending":
        counts.pending += 1;
        break;
      case "approved":
        counts.approved += 1;
        break;
      case "rejected":
        counts.rejected += 1;
        break;
      case "removed":
        counts.removed += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

// --- TUS endpoint ----------------------------------------------------------

/**
 * Derives the signed resumable-upload endpoint from the public Supabase URL.
 * For a hosted project (`https://<ref>.supabase.co`) it rewrites to the direct
 * storage hostname the docs recommend for large files
 * (`https://<ref>.storage.supabase.co`). For a local stack it appends the path
 * to the URL as-is.
 */
export function resolveTusEndpoint(supabaseUrl: string): string {
  const trimmed = supabaseUrl.replace(/\/+$/, "");
  const hosted = /^https:\/\/([a-z0-9-]+)\.supabase\.co$/i.exec(trimmed);
  const base = hosted
    ? `https://${hosted[1]}.storage.supabase.co`
    : trimmed;
  return `${base}${RESUMABLE_SIGN_ENDPOINT_PATH}`;
}

// --- Encoding helpers ------------------------------------------------------

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
