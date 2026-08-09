/**
 * POST /api/uploads/batches (packet 08). Creates a draft upload batch and
 * returns the guest's opaque receipt. Node runtime (Web Crypto + Supabase
 * admin client). The guest session read here is the key the batch is filed
 * under, not a permission: the site carries no password, and what bounds this
 * route is the per-IP rate limit plus admin review of everything submitted.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createUploadBatch } from "@/lib/uploads/create-batch";
import { getGuestSession } from "@/lib/auth/guest-session";
import {
  UPLOAD_BATCH_RATE_LIMIT,
  enforceUploadRateLimit,
  uploadErrorResponse,
} from "@/lib/uploads/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getGuestSession();

  const limited = await enforceUploadRateLimit(request, UPLOAD_BATCH_RATE_LIMIT);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;

  try {
    const receipt = await createUploadBatch(
      {
        displayName: (raw.displayName ?? null) as string | null,
        email: (raw.email ?? null) as string | null,
        note: (raw.note ?? null) as string | null,
        itemCount: raw.itemCount as number,
      },
      session,
    );
    return NextResponse.json(receipt, { status: 201 });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
