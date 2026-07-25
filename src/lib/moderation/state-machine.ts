/**
 * Moderation state machine (packet 10).
 *
 * This is the heart of the packet: every guest-submitted photo moves through
 * upload_items.status (pending -> approved | rejected, with an explicit admin
 * restore back to pending) and every batch's status is DERIVED from its
 * items' terminal states, never set directly by the UI.
 *
 * Retry-safety and concurrency are handled with a conditional (compare-and-
 * swap) update: the UPDATE is scoped by `.eq("status", <expected current>)`.
 * A request that observes the item already at its requested terminal status
 * is treated as an idempotent retry (no-op, no new audit row). A request
 * that loses a race (someone else moved the row first) re-reads the fresh
 * row: if the fresh status matches what this request wanted, that's also an
 * idempotent success; anything else is a genuine illegal transition.
 *
 * Two admin requests approving the SAME item concurrently therefore always
 * converge on exactly one photo, one audit trail entry, and one final state
 * -- never two, and never a silent overwrite of one admin's decision by
 * another's.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { UploadItemRow, UploadBatchRow } from "@/lib/supabase/schema";
import { recordModerationAction, ModerationPersistenceError } from "./audit";

type Db = SupabaseClient<Database>;
type UploadItemUpdate = Database["public"]["Tables"]["rachandzach_upload_items"]["Update"];

// --- Types -------------------------------------------------------------

export type UploadItemStatus = "pending" | "approved" | "rejected" | "removed";
export type UploadBatchStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "partially_approved"
  | "rejected";

/** The packet's produced ModerationDecision shape. */
export interface ModerationDecision {
  itemId: string;
  action: "approve" | "reject";
  eventSlug: string | null;
  peopleSlugs: string[];
  keywords: string[];
  noteApproved: boolean;
  rejectionReason: string | null;
}

export interface ModerationActor {
  userId: string;
  email: string;
}

// --- Errors --------------------------------------------------------------

/** No row exists for the given id. Routes map this to HTTP 404. */
export class ModerationNotFoundError extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = "ModerationNotFoundError";
  }
}

/**
 * The requested move is not a legal state transition (and is not an
 * idempotent retry of an already-applied one either). Routes map this to
 * HTTP 409.
 */
export class IllegalTransitionError extends Error {
  readonly status = 409;
  constructor(
    readonly from: UploadItemStatus,
    readonly to: UploadItemStatus,
  ) {
    super(`Cannot move an upload item from "${from}" to "${to}".`);
    this.name = "IllegalTransitionError";
  }
}

export { ModerationPersistenceError } from "./audit";

// --- Pure transition planning ---------------------------------------------

const DECISION_TARGET: Record<"approve" | "reject", UploadItemStatus> = {
  approve: "approved",
  reject: "rejected",
};

/** Terminal statuses an explicit admin restore can move back to "pending". */
const RESTORABLE_FROM: ReadonlySet<UploadItemStatus> = new Set([
  "approved",
  "rejected",
]);

export interface ItemTransitionPlan {
  /** The item is already at the requested status: caller should no-op. */
  isRetry: boolean;
  nextStatus: UploadItemStatus;
}

/**
 * Pure decision logic for approve/reject. Only "pending" items may move to a
 * terminal status through the normal review flow. Calling again with the
 * SAME decision once the item is already at that terminal status is a legal
 * retry, not an error.
 */
export function planItemDecisionTransition(
  currentStatus: UploadItemStatus,
  action: "approve" | "reject",
): ItemTransitionPlan {
  const nextStatus = DECISION_TARGET[action];
  if (currentStatus === nextStatus) {
    return { isRetry: true, nextStatus };
  }
  if (currentStatus !== "pending") {
    throw new IllegalTransitionError(currentStatus, nextStatus);
  }
  return { isRetry: false, nextStatus };
}

/**
 * Pure decision logic for an explicit admin restore back to "pending". Only
 * legal from a terminal decision state (approved/rejected); "removed" is
 * permanently terminal and cannot be restored through this action.
 */
export function planItemRestoreTransition(
  currentStatus: UploadItemStatus,
): ItemTransitionPlan {
  if (currentStatus === "pending") {
    return { isRetry: true, nextStatus: "pending" };
  }
  if (!RESTORABLE_FROM.has(currentStatus)) {
    throw new IllegalTransitionError(currentStatus, "pending");
  }
  return { isRetry: false, nextStatus: "pending" };
}

/**
 * Derives the batch-level status from its items' statuses. Returns null when
 * the batch is not yet decidable (at least one item still "pending"): the
 * batch stays in whatever pre-terminal status it already has
 * (submitted/under_review), which this function never touches.
 */
export function deriveBatchStatus(
  itemStatuses: readonly UploadItemStatus[],
): UploadBatchStatus | null {
  if (itemStatuses.length === 0) return null;
  if (itemStatuses.some((status) => status === "pending")) return null;
  const approvedCount = itemStatuses.filter(
    (status) => status === "approved",
  ).length;
  if (approvedCount === itemStatuses.length) return "approved";
  if (approvedCount === 0) return "rejected";
  return "partially_approved";
}

// --- Database-backed transitions ------------------------------------------

async function fetchItem(
  client: Db,
  itemId: string,
): Promise<UploadItemRow | null> {
  const { data, error } = await client
    .from("rachandzach_upload_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();
  if (error) {
    throw new ModerationPersistenceError("Could not read the upload item.");
  }
  return (data as UploadItemRow | null) ?? null;
}

async function fetchBatch(
  client: Db,
  batchId: string,
): Promise<UploadBatchRow | null> {
  const { data, error } = await client
    .from("rachandzach_upload_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();
  if (error) {
    throw new ModerationPersistenceError("Could not read the upload batch.");
  }
  return (data as UploadBatchRow | null) ?? null;
}

async function hasCompletedPublishedPhoto(
  client: Db,
  fileSha256: string | null,
): Promise<boolean> {
  // processApprovedPhoto replaces the advisory client hash with a full
  // server-computed SHA-256 before an item can become approved.
  if (!fileSha256 || !/^[0-9a-f]{64}$/.test(fileSha256)) return false;

  const { data, error } = await client
    .from("rachandzach_photos")
    .select("id, status")
    .eq("file_sha256", fileSha256)
    .eq("source", "guest")
    .eq("processing_complete", true)
    .maybeSingle();
  if (error) {
    throw new ModerationPersistenceError(
      "Could not verify the approved catalog photo.",
    );
  }

  return data?.status === "published" || data?.status === "hidden";
}

interface ApplyItemTransitionOptions {
  itemId: string;
  plan: ItemTransitionPlan;
  patch: UploadItemUpdate;
  auditAction: "approve_item" | "reject_item" | "restore_item";
  before: Record<string, unknown>;
  actor: ModerationActor;
  client: Db;
}

/**
 * Shared compare-and-swap + audit logic for every item transition. The
 * conditional UPDATE's `.eq("status", ...)` clause is the concurrency guard:
 * only a request that still sees the item's pre-transition status can win
 * the write.
 */
async function applyItemTransition(
  options: ApplyItemTransitionOptions,
): Promise<UploadItemRow> {
  const { itemId, plan, patch, auditAction, before, actor, client } = options;
  const fromStatus = before.status as UploadItemStatus;

  const { data: updated, error: updateError } = await client
    .from("rachandzach_upload_items")
    .update(patch)
    .eq("id", itemId)
    .eq("status", fromStatus)
    .select("*")
    .maybeSingle();

  if (updateError) {
    throw new ModerationPersistenceError("Could not update the upload item.");
  }

  if (!updated) {
    // Lost the race: re-read and reconcile rather than blindly retrying.
    const fresh = await fetchItem(client, itemId);
    if (!fresh) {
      throw new ModerationNotFoundError(`Upload item ${itemId} was not found.`);
    }
    if (fresh.status === plan.nextStatus) {
      // Another request already applied this exact outcome. Idempotent
      // success; that request already wrote the one audit row.
      return fresh;
    }
    throw new IllegalTransitionError(
      fresh.status as UploadItemStatus,
      plan.nextStatus,
    );
  }

  const row = updated as UploadItemRow;
  await recordModerationAction(client, {
    batchId: row.batch_id,
    itemId: row.id,
    actorUserId: actor.userId,
    action: auditAction,
    before,
    after: {
      status: row.status,
      rejection_reason: row.rejection_reason,
      note_approved: row.note_approved,
    },
  });
  return row;
}

/**
 * Produced interface: transitionUploadItem(itemId, decision, actor).
 *
 * Applies an approve/reject decision to a single upload item. Retry-safe: a
 * second call with the same decision once the item already sits at that
 * terminal status returns the current row without writing a duplicate audit
 * entry. The note approval bit is persisted with the item and included in
 * the audit record; processApprovedPhoto owns copying the approved note text
 * into the published photo.
 */
export async function transitionUploadItem(
  itemId: string,
  decision: ModerationDecision,
  actor: ModerationActor,
  client: Db,
): Promise<UploadItemRow> {
  const item = await fetchItem(client, itemId);
  if (!item) {
    throw new ModerationNotFoundError(`Upload item ${itemId} was not found.`);
  }

  const currentStatus = item.status as UploadItemStatus;
  const plan = planItemDecisionTransition(currentStatus, decision.action);

  if (plan.isRetry) {
    return item;
  }

  const patch: UploadItemUpdate = {
    status: plan.nextStatus,
    rejection_reason:
      decision.action === "reject" ? decision.rejectionReason : null,
    note_approved:
      decision.action === "approve" && decision.noteApproved === true,
  };

  return applyItemTransition({
    itemId,
    plan,
    patch,
    auditAction: decision.action === "approve" ? "approve_item" : "reject_item",
    before: {
      status: item.status,
      rejection_reason: item.rejection_reason,
      note_approved: item.note_approved,
    },
    actor,
    client,
  });
}

/**
 * Explicit admin restore: moves an approved or rejected item back to
 * "pending" so it re-enters the review queue. Always writes a new audit
 * record (restore_item) on a real transition; a restore of an already-
 * pending item is an idempotent no-op.
 */
export async function restoreUploadItem(
  itemId: string,
  actor: ModerationActor,
  client: Db,
): Promise<UploadItemRow> {
  const item = await fetchItem(client, itemId);
  if (!item) {
    throw new ModerationNotFoundError(`Upload item ${itemId} was not found.`);
  }

  const currentStatus = item.status as UploadItemStatus;
  const plan = planItemRestoreTransition(currentStatus);

  if (plan.isRetry) {
    return item;
  }

  return applyItemTransition({
    itemId,
    plan,
    patch: {
      status: "pending",
      rejection_reason: null,
      note_approved: false,
    },
    auditAction: "restore_item",
    before: {
      status: item.status,
      rejection_reason: item.rejection_reason,
      note_approved: item.note_approved,
    },
    actor,
    client,
  });
}

/**
 * Produced interface companion: recomputes a batch's status from its items'
 * current statuses and persists the transition (approved / partially_approved
 * / rejected) once every item is terminal. Any approved item also needs a
 * matching, fully processed guest photo in a published/hidden catalog state;
 * this keeps an approved-but-not-yet-published item retryable without rolling
 * its durable moderation decision backward. An all-rejected batch needs no
 * catalog rows. Idempotent recomputation writes no duplicate audit row.
 */
export async function recomputeBatchStatus(
  batchId: string,
  actor: ModerationActor,
  client: Db,
): Promise<UploadBatchRow | null> {
  const { data: items, error } = await client
    .from("rachandzach_upload_items")
    .select("id, status, sha256")
    .eq("batch_id", batchId);
  if (error) {
    throw new ModerationPersistenceError("Could not read the batch items.");
  }

  const itemRows = (items ?? []) as Array<
    Pick<UploadItemRow, "id" | "status" | "sha256">
  >;
  const statuses = itemRows.map((row) => row.status as UploadItemStatus);
  const nextStatus = deriveBatchStatus(statuses);
  if (!nextStatus) return null;

  if (nextStatus !== "rejected") {
    for (const item of itemRows) {
      if (
        item.status === "approved" &&
        !(await hasCompletedPublishedPhoto(client, item.sha256))
      ) {
        return null;
      }
    }
  }

  const batch = await fetchBatch(client, batchId);
  if (!batch) {
    throw new ModerationNotFoundError(`Upload batch ${batchId} was not found.`);
  }
  if (batch.status === nextStatus) {
    return batch;
  }

  const { data: updated, error: updateError } = await client
    .from("rachandzach_upload_batches")
    .update({ status: nextStatus, reviewed_at: new Date().toISOString() })
    .eq("id", batchId)
    .eq("status", batch.status)
    .select("*")
    .maybeSingle();
  if (updateError) {
    throw new ModerationPersistenceError("Could not update the upload batch.");
  }
  if (!updated) {
    // Lost the race: whichever request won already recorded the audit entry.
    return fetchBatch(client, batchId);
  }

  const row = updated as UploadBatchRow;
  await recordModerationAction(client, {
    batchId: row.id,
    itemId: null,
    actorUserId: actor.userId,
    action: nextStatus === "rejected" ? "reject_batch" : "approve_batch",
    before: { status: batch.status },
    after: { status: row.status },
  });
  return row;
}
