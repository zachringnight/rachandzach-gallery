/**
 * State-machine tests (packet 10): legal transitions, illegal transitions,
 * retries, partial approval, and two simultaneous admin requests. All
 * exercised against an in-memory mock Supabase client; no live database.
 */
import { describe, expect, it } from "vitest";
import {
  IllegalTransitionError,
  ModerationNotFoundError,
  deriveBatchStatus,
  planItemDecisionTransition,
  planItemRestoreTransition,
  recomputeBatchStatus,
  restoreUploadItem,
  transitionUploadItem,
  type ModerationDecision,
} from "@/lib/moderation/state-machine";
import { createFakeDb, TEST_ACTOR } from "./fake-supabase";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const BATCH_ID = "22222222-2222-4222-8222-222222222222";

function item(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ITEM_ID,
    batch_id: BATCH_ID,
    original_name: "photo.jpg",
    object_path: `pending/${BATCH_ID}/${ITEM_ID}/nonce`,
    bytes: 1024,
    media_type: "image/jpeg",
    sha256: null,
    status: "pending",
    rejection_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function batch(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: BATCH_ID,
    receipt_hash: "a".repeat(64),
    email: null,
    display_name: "Guest",
    note: null,
    status: "under_review",
    submitted_at: new Date().toISOString(),
    reviewed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function approveDecision(overrides: Partial<ModerationDecision> = {}): ModerationDecision {
  return {
    itemId: ITEM_ID,
    action: "approve",
    eventSlug: null,
    peopleSlugs: [],
    keywords: [],
    noteApproved: false,
    rejectionReason: null,
    ...overrides,
  };
}

function rejectDecision(overrides: Partial<ModerationDecision> = {}): ModerationDecision {
  return {
    itemId: ITEM_ID,
    action: "reject",
    eventSlug: null,
    peopleSlugs: [],
    keywords: [],
    noteApproved: false,
    rejectionReason: "blurry",
    ...overrides,
  };
}

describe("pure transition planning", () => {
  it("allows pending -> approved and pending -> rejected", () => {
    expect(planItemDecisionTransition("pending", "approve")).toEqual({
      isRetry: false,
      nextStatus: "approved",
    });
    expect(planItemDecisionTransition("pending", "reject")).toEqual({
      isRetry: false,
      nextStatus: "rejected",
    });
  });

  it("treats an already-terminal item at the SAME target as a retry", () => {
    expect(planItemDecisionTransition("approved", "approve")).toEqual({
      isRetry: true,
      nextStatus: "approved",
    });
    expect(planItemDecisionTransition("rejected", "reject")).toEqual({
      isRetry: true,
      nextStatus: "rejected",
    });
  });

  it("rejects a direct flip between terminal states without going through restore", () => {
    expect(() => planItemDecisionTransition("approved", "reject")).toThrow(
      IllegalTransitionError,
    );
    expect(() => planItemDecisionTransition("rejected", "approve")).toThrow(
      IllegalTransitionError,
    );
  });

  it("rejects a decision on a permanently removed item", () => {
    expect(() => planItemDecisionTransition("removed", "approve")).toThrow(
      IllegalTransitionError,
    );
  });

  it("allows restore only from approved/rejected, and is a no-op from pending", () => {
    expect(planItemRestoreTransition("approved")).toEqual({
      isRetry: false,
      nextStatus: "pending",
    });
    expect(planItemRestoreTransition("rejected")).toEqual({
      isRetry: false,
      nextStatus: "pending",
    });
    expect(planItemRestoreTransition("pending")).toEqual({
      isRetry: true,
      nextStatus: "pending",
    });
    expect(() => planItemRestoreTransition("removed")).toThrow(
      IllegalTransitionError,
    );
  });
});

describe("deriveBatchStatus", () => {
  it("returns null while any item is still pending", () => {
    expect(deriveBatchStatus(["pending", "approved"])).toBeNull();
    expect(deriveBatchStatus([])).toBeNull();
  });

  it("returns approved when every item is approved", () => {
    expect(deriveBatchStatus(["approved", "approved"])).toBe("approved");
  });

  it("returns rejected when no item is approved", () => {
    expect(deriveBatchStatus(["rejected", "removed"])).toBe("rejected");
  });

  it("returns partially_approved for a mixed terminal set", () => {
    expect(deriveBatchStatus(["approved", "rejected", "approved"])).toBe(
      "partially_approved",
    );
  });
});

describe("transitionUploadItem: legal transitions", () => {
  it("approves a pending item and writes exactly one audit row", async () => {
    const db = createFakeDb({ rachandzach_upload_items: [item()] });
    const result = await transitionUploadItem(
      ITEM_ID,
      approveDecision(),
      TEST_ACTOR,
      db.client,
    );
    expect(result.status).toBe("approved");

    const audits = db.inserts.filter(
      (entry) => entry.table === "rachandzach_moderation_actions",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].row.action).toBe("approve_item");
    expect(audits[0].row.before).toEqual({ status: "pending", rejection_reason: null });
    expect(audits[0].row.after).toEqual({ status: "approved", rejection_reason: null });
  });

  it("rejects a pending item with a reason and writes exactly one audit row", async () => {
    const db = createFakeDb({ rachandzach_upload_items: [item()] });
    const result = await transitionUploadItem(
      ITEM_ID,
      rejectDecision({ rejectionReason: "duplicate of another guest photo" }),
      TEST_ACTOR,
      db.client,
    );
    expect(result.status).toBe("rejected");
    expect(result.rejection_reason).toBe("duplicate of another guest photo");

    const audits = db.inserts.filter(
      (entry) => entry.table === "rachandzach_moderation_actions",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].row.action).toBe("reject_item");
  });

  it("throws ModerationNotFoundError for an unknown item", async () => {
    const db = createFakeDb({ rachandzach_upload_items: [] });
    await expect(
      transitionUploadItem(ITEM_ID, approveDecision(), TEST_ACTOR, db.client),
    ).rejects.toThrow(ModerationNotFoundError);
  });
});

describe("transitionUploadItem: illegal transitions", () => {
  it("refuses to approve an already-rejected item without a restore", async () => {
    const db = createFakeDb({
      rachandzach_upload_items: [item({ status: "rejected", rejection_reason: "blurry" })],
    });
    await expect(
      transitionUploadItem(ITEM_ID, approveDecision(), TEST_ACTOR, db.client),
    ).rejects.toThrow(IllegalTransitionError);

    // No audit row and no status mutation happened on the illegal attempt.
    expect(
      db.inserts.filter((entry) => entry.table === "rachandzach_moderation_actions"),
    ).toHaveLength(0);
    const stored = db.tables.get("rachandzach_upload_items")![0];
    expect(stored.status).toBe("rejected");
  });

  it("refuses to reject an already-approved item without a restore", async () => {
    const db = createFakeDb({
      rachandzach_upload_items: [item({ status: "approved" })],
    });
    await expect(
      transitionUploadItem(ITEM_ID, rejectDecision(), TEST_ACTOR, db.client),
    ).rejects.toThrow(IllegalTransitionError);
  });

  it("refuses any decision on a permanently removed item", async () => {
    const db = createFakeDb({
      rachandzach_upload_items: [item({ status: "removed" })],
    });
    await expect(
      transitionUploadItem(ITEM_ID, approveDecision(), TEST_ACTOR, db.client),
    ).rejects.toThrow(IllegalTransitionError);
  });
});

describe("transitionUploadItem: retries", () => {
  it("a second identical approve call is an idempotent no-op (no duplicate audit row)", async () => {
    const db = createFakeDb({ rachandzach_upload_items: [item()] });

    const first = await transitionUploadItem(
      ITEM_ID,
      approveDecision(),
      TEST_ACTOR,
      db.client,
    );
    const second = await transitionUploadItem(
      ITEM_ID,
      approveDecision(),
      TEST_ACTOR,
      db.client,
    );

    expect(first.status).toBe("approved");
    expect(second.status).toBe("approved");
    expect(
      db.inserts.filter((entry) => entry.table === "rachandzach_moderation_actions"),
    ).toHaveLength(1);
  });

  it("restore then re-approve produces two audit rows and a final approved state", async () => {
    const db = createFakeDb({ rachandzach_upload_items: [item({ status: "approved" })] });

    const restored = await restoreUploadItem(ITEM_ID, TEST_ACTOR, db.client);
    expect(restored.status).toBe("pending");

    const reapproved = await transitionUploadItem(
      ITEM_ID,
      approveDecision(),
      TEST_ACTOR,
      db.client,
    );
    expect(reapproved.status).toBe("approved");

    const audits = db.inserts.filter(
      (entry) => entry.table === "rachandzach_moderation_actions",
    );
    expect(audits.map((entry) => entry.row.action)).toEqual([
      "restore_item",
      "approve_item",
    ]);
  });

  it("restoring an already-pending item is a no-op", async () => {
    const db = createFakeDb({ rachandzach_upload_items: [item({ status: "pending" })] });
    const result = await restoreUploadItem(ITEM_ID, TEST_ACTOR, db.client);
    expect(result.status).toBe("pending");
    expect(
      db.inserts.filter((entry) => entry.table === "rachandzach_moderation_actions"),
    ).toHaveLength(0);
  });
});

describe("transitionUploadItem: two simultaneous admin requests", () => {
  it("two concurrent identical approve calls converge on one photo's worth of state", async () => {
    const db = createFakeDb({ rachandzach_upload_items: [item()] });

    const [first, second] = await Promise.all([
      transitionUploadItem(ITEM_ID, approveDecision(), TEST_ACTOR, db.client),
      transitionUploadItem(ITEM_ID, approveDecision(), TEST_ACTOR, db.client),
    ]);

    expect(first.status).toBe("approved");
    expect(second.status).toBe("approved");
    expect(
      db.inserts.filter((entry) => entry.table === "rachandzach_moderation_actions"),
    ).toHaveLength(1);
    expect(db.tables.get("rachandzach_upload_items")![0].status).toBe("approved");
  });

  it("two concurrent CONFLICTING decisions leave exactly one winner and surface a real conflict to the loser", async () => {
    const db = createFakeDb({ rachandzach_upload_items: [item()] });

    const outcomes = await Promise.allSettled([
      transitionUploadItem(ITEM_ID, approveDecision(), TEST_ACTOR, db.client),
      transitionUploadItem(ITEM_ID, rejectDecision(), TEST_ACTOR, db.client),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    // Exactly one decision wins; the other either loses outright (an
    // IllegalTransitionError once the row has already moved) or -- if it
    // observed "pending" and lost the compare-and-swap race -- resolves only
    // when the fresh row happens to match its own target, which conflicting
    // decisions never do. So conflicting decisions always yield one winner
    // and one rejection, never two successes.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0].status === "rejected") {
      expect(rejected[0].reason).toBeInstanceOf(IllegalTransitionError);
    }

    // Exactly one audit row was written for the item, matching the winner.
    const audits = db.inserts.filter(
      (entry) => entry.table === "rachandzach_moderation_actions",
    );
    expect(audits).toHaveLength(1);
    const finalStatus = db.tables.get("rachandzach_upload_items")![0].status;
    expect(["approved", "rejected"]).toContain(finalStatus);
  });
});

describe("recomputeBatchStatus: partial approval", () => {
  it("only decides the batch once every item is terminal, and marks partially_approved for a mixed set", async () => {
    const otherItemId = "33333333-3333-4333-8333-333333333333";
    const db = createFakeDb({
      rachandzach_upload_batches: [batch()],
      rachandzach_upload_items: [
        item({ status: "pending" }),
        item({ id: otherItemId, status: "pending" }),
      ],
    });

    // Still one pending item: not decidable yet.
    expect(await recomputeBatchStatus(BATCH_ID, TEST_ACTOR, db.client)).toBeNull();

    await transitionUploadItem(ITEM_ID, approveDecision(), TEST_ACTOR, db.client);
    expect(await recomputeBatchStatus(BATCH_ID, TEST_ACTOR, db.client)).toBeNull();

    await transitionUploadItem(
      otherItemId,
      rejectDecision({ itemId: otherItemId }),
      TEST_ACTOR,
      db.client,
    );

    const decided = await recomputeBatchStatus(BATCH_ID, TEST_ACTOR, db.client);
    expect(decided).not.toBeNull();
    expect(decided!.status).toBe("partially_approved");

    const batchAudits = db.inserts.filter(
      (entry) =>
        entry.table === "rachandzach_moderation_actions" && entry.row.item_id === null,
    );
    expect(batchAudits).toHaveLength(1);
    expect(batchAudits[0].row.action).toBe("approve_batch");
  });

  it("recomputing an already-decided batch is idempotent (no duplicate audit row)", async () => {
    const db = createFakeDb({
      rachandzach_upload_batches: [batch()],
      rachandzach_upload_items: [item({ status: "approved" })],
    });

    const first = await recomputeBatchStatus(BATCH_ID, TEST_ACTOR, db.client);
    const second = await recomputeBatchStatus(BATCH_ID, TEST_ACTOR, db.client);

    expect(first!.status).toBe("approved");
    expect(second!.status).toBe("approved");
    const batchAudits = db.inserts.filter(
      (entry) =>
        entry.table === "rachandzach_moderation_actions" && entry.row.item_id === null,
    );
    expect(batchAudits).toHaveLength(1);
  });

  it("marks a fully rejected batch as rejected", async () => {
    const db = createFakeDb({
      rachandzach_upload_batches: [batch()],
      rachandzach_upload_items: [item({ status: "rejected" })],
    });
    const decided = await recomputeBatchStatus(BATCH_ID, TEST_ACTOR, db.client);
    expect(decided!.status).toBe("rejected");
  });
});
