/**
 * POST /api/admin/batches/[batchId]/approve (packet 10).
 *
 * Approves one or more items within a batch (BatchReviewer's accept /
 * select-all actions). Order matters for safety: processApprovedPhoto first
 * stages a non-visible, caption-free photo after every storage object exists.
 * transitionUploadItem then conditionally persists the winning decision, and
 * reconcileProcessedPhoto is the only step allowed to publish the row or copy
 * the persisted note decision. A processing/transition failure therefore
 * cannot expose an undecided upload or a request-local caption choice.
 *
 * Node runtime, generous maxDuration: HEIC decode of a large photo can take
 * real time (see docs/plans/.../spikes/heic-decode.md).
 */
import { NextResponse, type NextRequest } from "next/server";
import { AdminAccessError, requireAdmin } from "@/lib/auth/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/uploads/contracts";
import {
  IllegalTransitionError,
  ModerationNotFoundError,
  ModerationPersistenceError,
  recomputeBatchStatus,
  transitionUploadItem,
} from "@/lib/moderation/state-machine";
import {
  HeicDecodeError,
  UnprocessableItemStateError,
  UnsupportedImageFormatError,
  processApprovedPhoto,
  reconcileProcessedPhoto,
} from "@/lib/moderation/process-approved-photo";
import { notifyUploadDecision } from "@/lib/notifications/resend";

export const runtime = "nodejs";
export const maxDuration = 300;

interface ApproveBody {
  itemIds: string[];
  eventSlug: string | null;
  peopleSlugs: string[];
  keywords: string[];
  noteApproved: boolean;
}

function parseBody(raw: unknown): ApproveBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  if (
    !Array.isArray(body.itemIds) ||
    body.itemIds.length === 0 ||
    body.itemIds.length > 50 ||
    body.itemIds.some((id) => typeof id !== "string" || !isUuid(id))
  ) {
    return null;
  }
  return {
    itemIds: Array.from(new Set(body.itemIds as string[])),
    eventSlug:
      typeof body.eventSlug === "string" && body.eventSlug.trim().length > 0
        ? body.eventSlug
        : null,
    peopleSlugs: Array.isArray(body.peopleSlugs)
      ? body.peopleSlugs.filter((slug): slug is string => typeof slug === "string")
      : [],
    keywords: Array.isArray(body.keywords)
      ? body.keywords.filter((kw): kw is string => typeof kw === "string")
      : [],
    noteApproved: body.noteApproved === true,
  };
}

function describeError(error: unknown): string {
  if (
    error instanceof HeicDecodeError ||
    error instanceof UnsupportedImageFormatError ||
    error instanceof UnprocessableItemStateError ||
    error instanceof IllegalTransitionError ||
    error instanceof ModerationNotFoundError ||
    error instanceof ModerationPersistenceError
  ) {
    return error.message;
  }
  return "Could not approve this photo.";
}

function isPublicationComplete(status: string): boolean {
  return status === "published" || status === "hidden";
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  let actor: { userId: string; email: string };
  try {
    actor = await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const { batchId } = await context.params;
  if (!isUuid(batchId)) {
    return NextResponse.json({ error: "Invalid batch id." }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json(
      { error: "itemIds must contain 1 to 50 upload item UUIDs." },
      { status: 422 },
    );
  }

  const db = createAdminClient();
  const results: Array<{
    itemId: string;
    ok: boolean;
    photoId?: string;
    error?: string;
  }> = [];

  for (const itemId of body.itemIds) {
    let photoId: string | undefined;
    try {
      // Storage + derivatives land first, but the catalog row stays pending.
      const processed = await processApprovedPhoto(
        itemId,
        {
          eventSlug: body.eventSlug,
          peopleSlugs: body.peopleSlugs,
          keywords: body.keywords,
          expectedBatchId: batchId,
        },
        db,
      );
      photoId = processed.photoId;
      await transitionUploadItem(
        itemId,
        {
          itemId,
          action: "approve",
          eventSlug: body.eventSlug,
          peopleSlugs: body.peopleSlugs,
          keywords: body.keywords,
          noteApproved: body.noteApproved,
          rejectionReason: null,
        },
        actor,
        db,
      );
      // Re-read the persisted transition winner before publishing/captioning.
      const finalized = await reconcileProcessedPhoto(
        itemId,
        photoId,
        { expectedBatchId: batchId },
        db,
      );
      if (!isPublicationComplete(finalized.status)) {
        throw new ModerationPersistenceError(
          "The catalog photo did not finish publication.",
        );
      }
      results.push({ itemId, ok: true, photoId });
    } catch (error) {
      if (photoId) {
        try {
          // A rejected/removed winner may quarantine this batch's staged row.
          // An approved winner stays approved/retryable; this failure path
          // never rolls a durable moderation decision backward.
          await reconcileProcessedPhoto(
            itemId,
            photoId,
            { expectedBatchId: batchId, publishApproved: false },
            db,
          );
        } catch {
          // Staging always writes a non-visible, caption-free row. A failed
          // best-effort reconciliation therefore remains fail closed.
        }
      }
      results.push({ itemId, ok: false, error: describeError(error) });
    }
  }

  // Always converge against the latest persisted item/photo state, even when
  // this request carried stale selections and some per-item actions failed.
  //
  // Caught for the same reason the notification below is: every per-item
  // action has already been committed by this point. Letting a transient
  // failure here reject the whole POST told the admin the approval failed
  // when all of its photos were in fact live, inviting them to run it again.
  // The batch status is derived state and the next request recomputes it.
  let batch: Awaited<ReturnType<typeof recomputeBatchStatus>> = null;
  try {
    batch = await recomputeBatchStatus(batchId, actor, db);
  } catch {
    batch = null;
  }
  if (
    batch &&
    (batch.status === "approved" ||
      batch.status === "partially_approved" ||
      batch.status === "rejected")
  ) {
    try {
      await notifyUploadDecision(batchId, { client: db });
    } catch {
      // A notification failure must never fail an otherwise-successful
      // approval response; the admin still sees exactly what happened above.
    }
  }

  return NextResponse.json({ results, batchStatus: batch?.status ?? null });
}
