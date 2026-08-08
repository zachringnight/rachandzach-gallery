/**
 * POST /api/uploads/batches/[batchId]/submit (packet 08). Moves a draft batch
 * to submitted after re-verifying every uploaded object by magic bytes. Node
 * runtime.
 *
 * Submit-time validation is magic-byte sniffing ONLY (ftyp + heic/heix/hevc/
 * hevx/mif1/msf1 brands, plus JPEG/PNG/WebP signatures). Full HEIC decode
 * happens at approval time in packet 10. Any object whose bytes do not match
 * its declared media type, or that cannot be read, is marked rejected for
 * admin review rather than silently accepted.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findBatchByReceipt,
  getUploadStatus,
} from "@/lib/uploads/create-batch";
import { GUEST_PENDING_BUCKET } from "@/lib/uploads/contracts";
import { magicMatchesMediaType } from "@/lib/uploads/validate-upload";
import { requireGuest, uploadErrorResponse } from "@/lib/uploads/http";

export const runtime = "nodejs";

const HEAD_BYTES = 64;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  const guard = await requireGuest();
  if (!guard.ok) return guard.response;

  const { batchId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const receiptToken =
    typeof (body as Record<string, unknown>)?.receiptToken === "string"
      ? ((body as Record<string, unknown>).receiptToken as string)
      : "";
  if (!receiptToken) {
    return NextResponse.json(
      { error: "receiptToken is required." },
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

    const { data: items, error: itemsError } = await db
      .from("rachandzach_upload_items")
      .select("id, object_path, media_type, status")
      .eq("batch_id", batchId);
    if (itemsError) {
      return NextResponse.json(
        { error: "Could not read the batch items." },
        { status: 500 },
      );
    }
    const pending = (items ?? []).filter((item) => item.status === "pending");
    if (pending.length === 0) {
      return NextResponse.json(
        { error: "Upload at least one photo before submitting." },
        { status: 422 },
      );
    }

    // Re-verify every uploaded object's leading bytes against its declared
    // media type. Reject, never delete: the admin reviews rejects.
    for (const item of pending) {
      let ok = false;
      try {
        const { data, error } = await db.storage
          .from(GUEST_PENDING_BUCKET)
          .download(item.object_path);
        if (!error && data) {
          const buf = new Uint8Array(await data.arrayBuffer()).subarray(
            0,
            HEAD_BYTES,
          );
          ok = magicMatchesMediaType(buf, item.media_type);
        }
      } catch {
        ok = false;
      }
      if (!ok) {
        const { error: rejectError } = await db
          .from("rachandzach_upload_items")
          .update({ status: "rejected", rejection_reason: "magic-byte-mismatch" })
          .eq("id", item.id);
        if (rejectError) {
          throw new Error(
            `Could not reject item ${item.id}: ${rejectError.message}`,
          );
        }
      }
    }

    // This update is the whole point of the request: until status flips to
    // "submitted" the batch stays a draft and never reaches /admin/review.
    // Its error used to be discarded, so a failed write still returned 200
    // and the guest got a receipt for photos nobody would ever see. Guarding
    // on the current status also makes a double submit a no-op rather than a
    // second transition.
    const { data: submitted, error: submitError } = await db
      .from("rachandzach_upload_batches")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", batchId)
      .in("status", ["draft", "submitted"])
      .select("id");
    if (submitError) {
      throw new Error(`Could not submit batch: ${submitError.message}`);
    }
    if (!submitted || submitted.length === 0) {
      throw new Error("Could not submit batch: it is no longer submittable");
    }

    const status = await getUploadStatus(batchId, receiptToken, db);
    if (!status) {
      // A null here means the receipt lookup found nothing, which would
      // serialize as a 200 with a null body and leave UploadClient showing a
      // receipt built from no data.
      throw new Error("Batch submitted but its receipt could not be read");
    }
    return NextResponse.json(status, { status: 200 });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
