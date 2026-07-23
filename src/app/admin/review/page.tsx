/**
 * /admin/review (packet 10): the top-level review queue page. Server-fetches
 * the initial list (so it renders with data on first paint) and hands off to
 * the client ReviewQueue component for the refresh affordance.
 */
import { requireAdmin } from "@/lib/auth/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReviewQueue, type QueueCounts, type QueueEntry } from "@/components/admin/ReviewQueue";

export const metadata = {
  title: "Review queue | 0719 + co. Admin",
};

export const dynamic = "force-dynamic";

function emptyCounts(): QueueCounts {
  return { total: 0, pending: 0, approved: 0, rejected: 0, removed: 0 };
}

async function loadQueue(): Promise<QueueEntry[]> {
  const db = createAdminClient();

  const { data: batches } = await db
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

      if (item.sha256) {
        const perBatch = shaByBatch.get(item.batch_id) ?? new Map<string, number>();
        perBatch.set(item.sha256, (perBatch.get(item.sha256) ?? 0) + 1);
        shaByBatch.set(item.batch_id, perBatch);
      }
    }
  }

  return (batches ?? []).map((batch) => {
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
}

export default async function AdminReviewPage() {
  // The layout already enforces admin access; every data-touching page calls
  // requireAdmin() again on its own (packet 04's rule), independent of what
  // the layout above it did.
  await requireAdmin();
  const queue = await loadQueue();

  return <ReviewQueue initialQueue={queue} />;
}
