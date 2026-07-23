/**
 * Shared HTTP helpers for the guest upload routes (packet 08). SERVER-ONLY:
 * imported only by route handlers.
 *
 * Centralizes the guest-session guard and the error-to-response mapping so
 * every upload route fails closed the same way: a missing session is 401, a
 * missing secret is a loud 500, validation is 422, and a database/storage
 * failure never leaks internals to the guest.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  GalleryAccessConfigError,
  GalleryAccessError,
  requireGalleryAccess,
  type GallerySession,
} from "@/lib/auth/guest-session";
import { consumeRateLimit, hashRateLimitKey } from "@/lib/auth/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  UploadConfigError,
  UploadPersistenceError,
  UploadValidationError,
} from "./contracts";

export type GuestGuardResult =
  | { ok: true; session: GallerySession }
  | { ok: false; response: NextResponse };

/**
 * Re-runs the guest-session check inside the route (the proxy is not the only
 * gate). Returns the session or a ready-to-send failure response.
 */
export async function requireGuest(): Promise<GuestGuardResult> {
  try {
    const session = await requireGalleryAccess();
    return { ok: true, session };
  } catch (error) {
    if (error instanceof GalleryAccessConfigError) {
      return {
        ok: false,
        response: NextResponse.json({ error: error.message }, { status: 500 }),
      };
    }
    if (error instanceof GalleryAccessError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Authentication required." },
          { status: 401 },
        ),
      };
    }
    throw error;
  }
}

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
