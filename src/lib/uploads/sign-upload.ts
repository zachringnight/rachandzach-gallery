/**
 * Signed resumable-upload targets (packet 08).
 *
 * Per the verified TUS-auth spike, the server mints a short-lived signed upload
 * token per file with createSignedUploadUrl() and the browser uploads directly
 * to Supabase's TUS `/upload/resumable/sign` endpoint with the token in the
 * x-signature header. No storage RLS policies are required; the quarantine
 * bucket stays fully locked to anon.
 *
 * The item row is created BEFORE the token is issued (packet step), and the
 * object path is entirely server-issued: pending/{batchId}/{itemId}/{nonce}.
 * A guest filename is never used as an object path; it survives only as a
 * normalized display name.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  GUEST_PENDING_BUCKET,
  SIGNED_UPLOAD_TOKEN_TTL_SECONDS,
  UploadConfigError,
  UploadPersistenceError,
  UploadValidationError,
  isUuid,
  parseSignUploadFileInput,
  resolveTusEndpoint,
  type SignUploadFileInput,
  type SignedUploadTarget,
} from "./contracts";
import {
  buildPendingObjectPath,
  generateObjectNonce,
  normalizeDisplayFilename,
} from "./validate-upload";

type Db = SupabaseClient<Database>;

export interface SignUploadOptions {
  client?: Db;
  /** Overrides NEXT_PUBLIC_SUPABASE_URL when deriving the TUS endpoint. */
  supabaseUrl?: string;
}

async function resolveClient(client?: Db): Promise<Db> {
  if (client) return client;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Creates the pending item row and mints a signed resumable-upload target for
 * it. The declared media type is validated against the allowlist here;
 * authoritative magic-byte verification happens at submit time.
 */
export async function createSignedUploadTarget(
  batchId: string,
  fileMetadata: SignUploadFileInput,
  options: SignUploadOptions = {},
): Promise<SignedUploadTarget> {
  if (!isUuid(batchId)) {
    throw new UploadValidationError("batchId must be a UUID.");
  }
  const parsed = parseSignUploadFileInput(fileMetadata);
  if (!parsed.ok) {
    throw new UploadValidationError(parsed.error);
  }

  const supabaseUrl =
    options.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl || supabaseUrl.trim().length === 0) {
    throw new UploadConfigError(
      "NEXT_PUBLIC_SUPABASE_URL is not set; cannot derive the resumable upload endpoint.",
    );
  }

  const db = await resolveClient(options.client);

  const itemId = crypto.randomUUID();
  const nonce = generateObjectNonce();
  const objectPath = buildPendingObjectPath(batchId, itemId, nonce);
  const normalizedName = normalizeDisplayFilename(parsed.value.originalName);

  const { error: insertError } = await db
    .from("rachandzach_upload_items")
    .insert({
      id: itemId,
      batch_id: batchId,
      original_name: normalizedName,
      object_path: objectPath,
      bytes: parsed.value.bytes,
      media_type: parsed.value.mediaType,
      sha256: parsed.value.sha256 ?? null,
      status: "pending",
    });
  if (insertError) {
    throw new UploadPersistenceError("Could not create the upload item.");
  }

  // Never upsert: unique server-issued paths make overwrite semantics moot.
  const { data, error } = await db.storage
    .from(GUEST_PENDING_BUCKET)
    .createSignedUploadUrl(objectPath);
  if (error || !data) {
    throw new UploadPersistenceError("Could not mint the signed upload token.");
  }

  const tusEndpoint = resolveTusEndpoint(supabaseUrl);
  const expiresAt = new Date(
    Date.now() + SIGNED_UPLOAD_TOKEN_TTL_SECONDS * 1000,
  ).toISOString();

  return {
    itemId,
    objectPath,
    signedToken: data.token,
    tusEndpoint,
    expiresAt,
  };
}
