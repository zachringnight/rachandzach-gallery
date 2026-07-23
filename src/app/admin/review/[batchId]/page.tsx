/**
 * /admin/review/[batchId] (packet 10): the focused batch reviewer. Signs
 * large previews straight from the private guest-pending bucket (there are
 * no display derivatives yet -- those are created by approval itself), loads
 * the event/people catalog for MetadataEditor, and renders this batch's
 * notification_log history so the admin can see what was actually sent.
 */
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKETS } from "@/lib/supabase/schema";
import { isUuid } from "@/lib/uploads/contracts";
import { signPreviewUrls } from "@/lib/gallery/signed-previews";
import { suggestFaceTagsForItems } from "@/lib/moderation/face-suggestions";
import {
  BatchReviewer,
  type NotificationLogEntry,
  type ReviewItem,
} from "@/components/admin/BatchReviewer";
import type { MetadataOption } from "@/components/admin/MetadataEditor";

export const dynamic = "force-dynamic";

export default async function BatchReviewerPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireAdmin();
  const { batchId } = await params;
  if (!isUuid(batchId)) notFound();

  const db = createAdminClient();

  const { data: batch } = await db
    .from("rachandzach_upload_batches")
    .select("id, display_name, email, note, status")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) notFound();

  const { data: itemRows } = await db
    .from("rachandzach_upload_items")
    .select("id, original_name, object_path, media_type, bytes, status, rejection_reason, created_at")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });

  const { urls } = await signPreviewUrls(
    db,
    (itemRows ?? []).map((item) => ({
      bucket: STORAGE_BUCKETS.guestPending,
      objectPath: item.object_path,
    })),
  );

  const items: ReviewItem[] = (itemRows ?? []).map((item) => ({
    itemId: item.id,
    originalName: item.original_name,
    mediaType: item.media_type,
    bytes: item.bytes,
    status: item.status,
    rejectionReason: item.rejection_reason,
    previewUrl: urls.get(item.object_path) ?? null,
    createdAt: item.created_at,
  }));

  const [{ data: eventRows }, { data: peopleRows }, { data: notificationRows }] =
    await Promise.all([
      db.from("rachandzach_events").select("slug, name").order("sort_order", { ascending: true }),
      db.from("rachandzach_people").select("slug, display_name").order("display_name", { ascending: true }),
      db
        .from("rachandzach_notification_log")
        .select("kind, status, created_at, provider_id")
        .eq("batch_id", batchId)
        .order("created_at", { ascending: true }),
    ]);

  const events: MetadataOption[] = (eventRows ?? []).map((event) => ({
    slug: event.slug,
    name: event.name,
  }));
  const people: MetadataOption[] = (peopleRows ?? []).map((person) => ({
    slug: person.slug,
    name: person.display_name,
  }));
  const notifications: NotificationLogEntry[] = (notificationRows ?? []).map((row) => ({
    kind: row.kind,
    status: row.status,
    createdAt: row.created_at,
    providerId: row.provider_id,
  }));

  // Face-recognition moderation assist (Round Two): propose person tags for
  // the pending uploads via the local pipeline. Feature-detected -- null on
  // any machine without .venv-faces/ + metadata/faces/signatures.json, and
  // the reviewer then renders no suggestion surface at all.
  const faceSuggestions = await suggestFaceTagsForItems(
    db,
    (itemRows ?? []).map((item) => ({
      itemId: item.id,
      objectPath: item.object_path,
      mediaType: item.media_type,
      status: item.status,
    })),
    { knownPeople: people },
  );

  return (
    <BatchReviewer
      batchId={batch.id}
      displayName={batch.display_name}
      email={batch.email}
      note={batch.note}
      batchStatus={batch.status}
      items={items}
      events={events}
      people={people}
      notifications={notifications}
      faceSuggestions={faceSuggestions ?? undefined}
    />
  );
}
