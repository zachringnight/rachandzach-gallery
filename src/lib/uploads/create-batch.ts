/**
 * Upload batch lifecycle (packet 08).
 *
 * createUploadBatch persists a draft batch and returns an opaque receipt whose
 * plaintext token is hashed before it ever reaches the database. getUploadStatus
 * resolves a (batchId, receiptToken) pair to state + counts ONLY; it never
 * returns object paths, filenames, email, or the note, so pending objects stay
 * inaccessible to the submitting guest after upload. A wrong token and a
 * nonexistent batch both resolve to null, so the endpoint cannot be used to
 * enumerate other guests' batches.
 *
 * The Supabase client is injected. Routes pass the service-role admin client;
 * tests pass a mock cast to SupabaseClient<Database>, so no live database is
 * required to exercise this module. When no client is supplied, the admin
 * client is loaded lazily (dynamic import) so this module never pulls in the
 * "server-only" admin module at import time.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { GallerySession } from "@/lib/auth/guest-session";
import {
  UPLOAD_BATCH_TTL_SECONDS,
  UploadPersistenceError,
  UploadValidationError,
  type CreateUploadBatchInput,
  type PublicUploadStatus,
  type UploadBatchReceipt,
  generateReceiptToken,
  hashReceiptToken,
  isUuid,
  parseCreateUploadBatchInput,
  resolveBatchState,
  summarizeItemCounts,
} from "./contracts";

type Db = SupabaseClient<Database>;

async function resolveClient(client?: Db): Promise<Db> {
  if (client) return client;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/** Minimal batch row used for state resolution and ownership checks. */
export interface BatchOwnershipRow {
  id: string;
  status: string;
  created_at: string;
  submitted_at: string | null;
}

/**
 * Resolves a batch from its id AND a matching receipt-token hash. Returns null
 * when the pair does not match, so callers can never distinguish a wrong token
 * from a missing batch. Fails closed: a database error throws rather than
 * returning a batch.
 */
export async function findBatchByReceipt(
  db: Db,
  batchId: string,
  receiptToken: string,
): Promise<BatchOwnershipRow | null> {
  if (!isUuid(batchId)) return null;
  const receiptHash = await hashReceiptToken(receiptToken);
  const { data, error } = await db
    .from("rachandzach_upload_batches")
    .select("id, status, created_at, submitted_at")
    .eq("id", batchId)
    .eq("receipt_hash", receiptHash)
    .maybeSingle();
  if (error) {
    throw new UploadPersistenceError("Upload batch lookup failed.");
  }
  return data ?? null;
}

/**
 * Creates a draft upload batch and returns the guest's receipt. The receipt
 * token is generated here, handed back once, and NEVER stored: only its
 * SHA-256 hash is written to receipt_hash.
 */
export async function createUploadBatch(
  input: CreateUploadBatchInput,
  guestSession: GallerySession,
  client?: Db,
): Promise<UploadBatchReceipt> {
  const parsed = parseCreateUploadBatchInput(input);
  if (!parsed.ok) {
    throw new UploadValidationError(parsed.error);
  }
  // The guest session gates the route (requireGalleryAccess); batches are keyed
  // by the opaque receipt, not by session id, so nothing session-identifying is
  // persisted here.
  void guestSession;

  const receiptToken = generateReceiptToken();
  const receiptHash = await hashReceiptToken(receiptToken);

  const db = await resolveClient(client);
  const { data, error } = await db
    .from("rachandzach_upload_batches")
    .insert({
      receipt_hash: receiptHash,
      display_name: parsed.value.displayName,
      email: parsed.value.email,
      note: parsed.value.note,
      status: "draft",
    })
    .select("id, created_at")
    .single();

  if (error || !data) {
    throw new UploadPersistenceError("Could not create the upload batch.");
  }

  const createdAtMs = Date.parse(data.created_at);
  const baseMs = Number.isFinite(createdAtMs) ? createdAtMs : Date.now();
  const expiresAt = new Date(
    baseMs + UPLOAD_BATCH_TTL_SECONDS * 1000,
  ).toISOString();

  return { batchId: data.id, receiptToken, expiresAt };
}

/**
 * Resolves the public status for a receipt. Returns null when the batch/token
 * pair does not match (404 at the route). The returned object carries state and
 * counts only.
 */
export async function getUploadStatus(
  batchId: string,
  receiptToken: string,
  client?: Db,
): Promise<PublicUploadStatus | null> {
  const db = await resolveClient(client);
  const batch = await findBatchByReceipt(db, batchId, receiptToken);
  if (!batch) return null;

  const { data: items, error } = await db
    .from("rachandzach_upload_items")
    .select("status")
    .eq("batch_id", batchId);
  if (error) {
    throw new UploadPersistenceError("Could not read upload items.");
  }

  const counts = summarizeItemCounts(items ?? []);
  const createdAtMs = Date.parse(batch.created_at);
  const state = resolveBatchState(batch.status, counts.total, createdAtMs);
  const expiresAt = new Date(
    (Number.isFinite(createdAtMs) ? createdAtMs : Date.now()) +
      UPLOAD_BATCH_TTL_SECONDS * 1000,
  ).toISOString();

  return {
    batchId: batch.id,
    state,
    counts,
    submittedAt: batch.submitted_at,
    expiresAt,
  };
}
