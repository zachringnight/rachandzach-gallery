/**
 * POST /api/uploads/sign (packet 08). Mints a signed resumable-upload target
 * for one file in a draft batch. The caller proves ownership with the receipt
 * token; the batch must still be a draft. Node runtime.
 *
 * The declared media type is validated against the allowlist here; the
 * authoritative magic-byte check runs at submit time against the uploaded
 * bytes (full HEIC decode is deferred to packet 10).
 */
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findBatchByReceipt } from "@/lib/uploads/create-batch";
import { createSignedUploadTarget } from "@/lib/uploads/sign-upload";
import type { UploadMediaType } from "@/lib/uploads/contracts";
import {
  UPLOAD_SIGN_RATE_LIMIT,
  enforceUploadRateLimit,
  requireGuest,
  uploadErrorResponse,
} from "@/lib/uploads/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const guard = await requireGuest();
  if (!guard.ok) return guard.response;

  const limited = await enforceUploadRateLimit(request, UPLOAD_SIGN_RATE_LIMIT);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const batchId = typeof raw.batchId === "string" ? raw.batchId : "";
  const receiptToken =
    typeof raw.receiptToken === "string" ? raw.receiptToken : "";
  const file = (raw.file ?? {}) as Record<string, unknown>;

  if (!batchId || !receiptToken) {
    return NextResponse.json(
      { error: "batchId and receiptToken are required." },
      { status: 400 },
    );
  }

  try {
    const db = createAdminClient();
    const batch = await findBatchByReceipt(db, batchId, receiptToken);
    if (!batch) {
      return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    }
    if (batch.status !== "draft") {
      return NextResponse.json(
        { error: "This batch has already been submitted." },
        { status: 409 },
      );
    }

    const target = await createSignedUploadTarget(
      batchId,
      {
        originalName: String(file.originalName ?? ""),
        mediaType: String(file.declaredType ?? "") as UploadMediaType,
        bytes: Number(file.bytes ?? 0),
        sha256: typeof file.sha256 === "string" ? file.sha256 : null,
      },
      { client: db },
    );
    return NextResponse.json(target, { status: 201 });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
