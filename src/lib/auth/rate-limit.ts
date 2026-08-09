/**
 * Rate limiting (packet 04).
 *
 * The login buckets this module was written for are gone with the password
 * gate (2026-08-09) -- there is nothing left to guess. What remains uses the
 * same machinery for abuse control on the open surfaces: guest uploads
 * (src/lib/uploads/http.ts), memory notes, and moment search.
 *
 * The counting itself lives in Postgres behind the
 * public.rachandzach_consume_rate_limit RPC (service-role only, see
 * supabase/migrations/202607220001_gallery_core.sql). This module hashes
 * network identifiers before they are stored and calls the RPC through a
 * minimal structural client interface so unit tests can mock the Supabase
 * boundary without a live database.
 *
 * Fail-closed posture: an RPC error, a thrown network failure, or an
 * unexpected response shape all DENY the attempt.
 */
import {
  GalleryAccessConfigError,
  readSessionSecretBytes,
} from "./guest-session";

export const RATE_LIMIT_RPC = "rachandzach_consume_rate_limit" as const;

export interface RateLimitInput {
  keyHash: string;
  action: string;
  attemptLimit: number;
  windowSeconds: number;
}

/**
 * Structural seam for the Supabase client. The real SupabaseClient<Database>
 * satisfies this (its rpc builder is thenable); tests substitute a mock here
 * instead of mocking deep Postgrest internals.
 */
export interface RateLimitClient {
  rpc(
    fn: typeof RATE_LIMIT_RPC,
    args: {
      key_hash: string;
      action: string;
      attempt_limit: number;
      window_seconds: number;
    },
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

const HMAC_SHA256 = { name: "HMAC", hash: "SHA-256" } as const;
const KEY_DERIVATION_CONTEXT = "rachandzach:rate-limit-key:v1";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Hashes a network identifier for storage. Raw IPs never reach the database:
 * the identifier is HMAC'd with a dedicated key derived from
 * GALLERY_SESSION_SECRET under a domain-separation context, so session
 * signing and rate-limit hashing can never collide and the stored hash cannot
 * be reversed or recomputed without the server secret. Throws
 * GalleryAccessConfigError when the secret is missing (fail closed).
 */
export async function hashRateLimitKey(
  ip: string,
  action: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const master = await crypto.subtle.importKey(
    "raw",
    readSessionSecretBytes() as BufferSource,
    HMAC_SHA256,
    false,
    ["sign"],
  );
  const derived = await crypto.subtle.sign(
    "HMAC",
    master,
    encoder.encode(KEY_DERIVATION_CONTEXT),
  );
  const dedicated = await crypto.subtle.importKey(
    "raw",
    derived,
    HMAC_SHA256,
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    dedicated,
    encoder.encode(`${action}\n${ip}`),
  );
  return toHex(new Uint8Array(digest));
}

/**
 * Consumes one attempt from a rate-limit bucket. Returns true when the
 * attempt is allowed, false when the bucket is exhausted OR anything about
 * the call fails (fail closed: no database, no write).
 */
export async function consumeRateLimit(
  client: RateLimitClient,
  input: RateLimitInput,
): Promise<boolean> {
  try {
    const { data, error } = await client.rpc(RATE_LIMIT_RPC, {
      key_hash: input.keyHash,
      action: input.action,
      attempt_limit: input.attemptLimit,
      window_seconds: input.windowSeconds,
    });
    if (error != null) return false;
    return data === true;
  } catch (error) {
    // Configuration problems must stay loud; transport problems deny quietly.
    if (error instanceof GalleryAccessConfigError) throw error;
    return false;
  }
}
