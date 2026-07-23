/**
 * GET /api/admin/batches (packet 10): the review queue. Lists guest upload
 * batches sorted by submitted time with counts, duplicate flags, validation
 * state, and contact information -- everything ReviewQueue.tsx needs to
 * render without a second round trip per row. Node runtime; requireAdmin()
 * is re-checked here even though the proxy already gates /api/admin/*.
 */
import { NextResponse } from "next/server";
import { AdminAccessError, requireAdmin } from "@/lib/auth/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface QueueCounts {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  removed: number;
}

function emptyCounts(): QueueCounts {
  return { total: 0, pending: 0, approved: 0, rejected: 0, removed: 0 };
}

export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const db = createAdminClient();

  const { data: batches, error: batchesError } = await db
    .from("rachandzach_upload_batches")
    .select("id, display_name, email, note, status, submitted_at, reviewed_at, created_at")
    .in("status", [
      "submitted",
      "under_review",
      "approved",
      "partially_approved",
      "rejected",
    ])
    .order("submitted_at", { ascending: true, nullsFirst: false });

  if (batchesError) {
    return NextResponse.json(
      { error: "Could not load the review queue." },
      { status: 500 },
    );
  }

  const batchIds = (batches ?? []).map((batch) => batch.id);
  const counts = new Map<string, QueueCounts>();
  const shaByBatch = new Map<string, Map<string, number>>();

  if (batchIds.length > 0) {
    const { data: items } = await db
      .from("rachandzach_upload_items")
      .select("batch_id, status, sha256")
      .in("batch_id", batchIds);

    for (const item of items ?? []) {
      const entry = counts.get(item.batch_id) ?? emptyCounts();
      entry.total += 1;
      if (item.status === "pending") entry.pending += 1;
      else if (item.status === "approved") entry.approved += 1;
      else if (item.status === "rejected") entry.rejected += 1;
      else if (item.status === "removed") entry.removed += 1;
      counts.set(item.batch_id, entry);

      // Duplicate flag: same client-reported sha256 seen more than once
      // within the batch. Advisory only (server verifies bytes at
      // approval); helps the admin spot obvious accidental re-selects.
      if (item.sha256) {
        const perBatch = shaByBatch.get(item.batch_id) ?? new Map<string, number>();
        perBatch.set(item.sha256, (perBatch.get(item.sha256) ?? 0) + 1);
        shaByBatch.set(item.batch_id, perBatch);
      }
    }
  }

  const queue = (batches ?? []).map((batch) => {
    const perBatch = shaByBatch.get(batch.id);
    const hasDuplicates = perBatch
      ? Array.from(perBatch.values()).some((count) => count > 1)
      : false;
    return {
      batchId: batch.id,
      displayName: batch.display_name,
      hasEmail: Boolean(batch.email),
      note: batch.note,
      status: batch.status,
      submittedAt: batch.submitted_at,
      reviewedAt: batch.reviewed_at,
      createdAt: batch.created_at,
      counts: counts.get(batch.id) ?? emptyCounts(),
      hasDuplicates,
    };
  });

  return NextResponse.json({ queue });
}
