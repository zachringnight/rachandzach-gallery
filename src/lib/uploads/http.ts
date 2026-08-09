/**
 * Shared HTTP helpers for the guest upload routes (packet 08). SERVER-ONLY:
 * imported only by route handlers.
 *
 * Centralizes the guest-identity lookup and the error-to-response mapping so
 * every upload route answers the same way: validation is 422 and a
 * database/storage failure never leaks internals to the guest.
 *
 * There is no longer a 401 to hand out. Since the password gate was removed
 * (2026-08-09) uploading is open to anyone with the URL; the session is only
 * the key the batch is filed under, so it is fetched, never demanded. What
 * still bounds this surface is the per-IP rate limit below and the fact that
 * nothing uploaded is visible until an admin approves it.
 */
import { NextResponse, type NextRequest } from "next/server";
import { GalleryAccessConfigError } from "@/lib/auth/guest-session";
import { consumeRateLimit, hashRateLimitKey } from "@/lib/auth/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  UploadConfigError,
  UploadPersistenceError,
  UploadValidationError,
} from "./contracts";

// --- Rate limiting ---------------------------------------------------------

export interface UploadRateLimit {
  action: string;
  attemptLimit: number;
  windowSeconds: number;
}

/**
 * Per-IP mint limit. Signed-token minting is the storage-fill DoS surface the
 * TUS-auth spike flagged, so it is capped per hour. 300/hour comfortably covers
 * a guest uploading several full batches (50 files each) with retries.
 */
export const UPLOAD_SIGN_RATE_LIMIT: UploadRateLimit = {
  action: "guest_upload_sign_ip",
  attemptLimit: 300,
  windowSeconds: 60 * 60,
};

/** Per-IP batch-creation limit. Batches are cheap rows but still bounded. */
export const UPLOAD_BATCH_RATE_LIMIT: UploadRateLimit = {
  action: "guest_upload_batch_ip",
  attemptLimit: 20,
  windowSeconds: 60 * 60,
};

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Consumes one attempt from a per-IP upload bucket. Returns a 429 response when
 * the bucket is exhausted, a 500 when configuration is missing, or null when
 * the request may proceed. Fail-closed: the RPC (and thus the database) being
 * unavailable denies the request rather than waving it through.
 */
export async function enforceUploadRateLimit(
  request: NextRequest,
  limit: UploadRateLimit,
): Promise<NextResponse | null> {
  try {
    const admin = createAdminClient();
    const keyHash = await hashRateLimitKey(clientIp(request), limit.action);
    const allowed = await consumeRateLimit(admin, {
      keyHash,
      action: limit.action,
      attemptLimit: limit.attemptLimit,
      windowSeconds: limit.windowSeconds,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many upload requests. Please wait a moment and retry." },
        { status: 429 },
      );
    }
    return null;
  } catch (error) {
    if (error instanceof GalleryAccessConfigError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // Missing Supabase configuration (createAdminClient) also lands here.
    return NextResponse.json(
      { error: "Upload rate limiting is unavailable." },
      { status: 500 },
    );
  }
}

/** Maps an upload-layer error onto a safe JSON response. */
export function uploadErrorResponse(error: unknown): NextResponse {
  if (error instanceof UploadValidationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof UploadConfigError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof GalleryAccessConfigError) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (error instanceof UploadPersistenceError) {
    // Do not leak database/storage internals to the guest.
    return NextResponse.json(
      { error: "Upload service is temporarily unavailable." },
      { status: error.status },
    );
  }
  return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
}
