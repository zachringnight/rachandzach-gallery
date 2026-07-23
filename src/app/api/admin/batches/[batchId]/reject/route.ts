/**
 * POST /api/admin/batches/[batchId]/reject (packet 10). Rejects one or more
 * items within a batch. Rejection never touches storage or the catalog --
 * the private original stays exactly where it is (recoverable for 30 days;
 * see the cleanup view) and no photo is ever created for a rejected item.
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
import { notifyUploadDecision } from "@/lib/notifications/resend";

export const runtime = "nodejs";

interface RejectBody {
  itemIds: string[];
  rejectionReason: string | null;
}

function parseBody(raw: unknown): RejectBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  if (
    !Array.isArray(body.itemIds) ||
    body.itemIds.length === 0 ||
    body.itemIds.some((id) => typeof id !== "string" || !isUuid(id))
  ) {
    return null;
  }
  const rejectionReason =
    typeof body.rejectionReason === "string" && body.rejectionReason.trim().length > 0
      ? body.rejectionReason.trim().slice(0, 500)
      : null;
  return { itemIds: body.itemIds as string[], rejectionReason };
}

function describeError(error: unknown): string {
  if (
    error instanceof IllegalTransitionError ||
    error instanceof ModerationNotFoundError ||
    error instanceof ModerationPersistenceError
  ) {
    return error.message;
  }
  return "Could not reject this photo.";
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
      { error: "itemIds must be a non-empty array of upload item UUIDs." },
      { status: 422 },
    );
  }

  const db = createAdminClient();
  const results: Array<{ itemId: string; ok: boolean; error?: string }> = [];

  for (const itemId of body.itemIds) {
    try {
      await transitionUploadItem(
        itemId,
        {
          itemId,
          action: "reject",
          eventSlug: null,
          peopleSlugs: [],
          keywords: [],
          noteApproved: false,
          rejectionReason: body.rejectionReason,
        },
        actor,
        db,
      );
      results.push({ itemId, ok: true });
    } catch (error) {
      results.push({ itemId, ok: false, error: describeError(error) });
    }
  }

  const batch = await recomputeBatchStatus(batchId, actor, db);
  if (
    batch &&
    (batch.status === "approved" ||
      batch.status === "partially_approved" ||
      batch.status === "rejected")
  ) {
    try {
      await notifyUploadDecision(batchId, { client: db });
    } catch {
      // Never fail the HTTP response over a notification problem.
    }
  }

  return NextResponse.json({ results, batchStatus: batch?.status ?? null });
}
