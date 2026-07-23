/**
 * Notification idempotency tests (packet 10): a batch email is sent at most
 * once per event (admin_new_batch / guest_approved / guest_rejected) through
 * a stable idempotency key, even under a retry or a genuine concurrent race.
 * A test transport records calls in memory; the real Resend SDK is never
 * imported and no network call is ever made.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NOTIFICATION_SENDER,
  isSendingEnabled,
  notifyNewBatch,
  notifyUploadDecision,
  type NotificationMessage,
  type NotificationTransport,
} from "@/lib/notifications/resend";
import { createFakeDb, type Row } from "../moderation/fake-supabase";

const BATCH_ID = "66666666-6666-4666-8666-666666666666";
const ITEM_A = "77777777-7777-4777-8777-777777777777";
const ITEM_B = "88888888-8888-4888-8888-888888888888";

const UNIQUE = { unique: { rachandzach_notification_log: [["idempotency_key"]] } };

function batchRow(overrides: Partial<Row> = {}): Row {
  return {
    id: BATCH_ID,
    receipt_hash: "b".repeat(64),
    email: "guest@example.com",
    display_name: "Priya",
    note: null,
    status: "submitted",
    submitted_at: new Date().toISOString(),
    reviewed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function itemRow(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    batch_id: BATCH_ID,
    original_name: "photo.jpg",
    object_path: `pending/${BATCH_ID}/${id}/nonce`,
    bytes: 1024,
    media_type: "image/jpeg",
    sha256: null,
    status: "approved",
    rejection_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function createRecordingTransport() {
  const calls: NotificationMessage[] = [];
  const transport: NotificationTransport = {
    async send(message) {
      calls.push(message);
      return { providerId: `test-provider-${calls.length}` };
    },
  };
  return { calls, transport };
}

describe("notifyNewBatch idempotency", () => {
  it("sends exactly one admin email and logs the provider id", async () => {
    const db = createFakeDb(
      {
        rachandzach_upload_batches: [batchRow()],
        rachandzach_upload_items: [itemRow(ITEM_A), itemRow(ITEM_B)],
      },
      UNIQUE,
    );
    const { calls, transport } = createRecordingTransport();

    const result = await notifyNewBatch(BATCH_ID, { client: db.client, transport });

    expect(result).toEqual({ sent: true, providerId: "test-provider-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe("admin_new_batch");
    expect(calls[0].to).toBe("wedding@rachandzach.com");

    const logRows = db.tables.get("rachandzach_notification_log") ?? [];
    expect(logRows).toHaveLength(1);
    expect(logRows[0].status).toBe("sent");
    expect(logRows[0].kind).toBe("admin_new_batch");
    expect(logRows[0].provider_id).toBe("test-provider-1");
  });

  it("a sequential retry does not send a second email", async () => {
    const db = createFakeDb(
      {
        rachandzach_upload_batches: [batchRow()],
        rachandzach_upload_items: [itemRow(ITEM_A)],
      },
      UNIQUE,
    );
    const { calls, transport } = createRecordingTransport();

    const first = await notifyNewBatch(BATCH_ID, { client: db.client, transport });
    const second = await notifyNewBatch(BATCH_ID, { client: db.client, transport });

    expect(calls).toHaveLength(1);
    expect(first).toEqual({ sent: true, providerId: "test-provider-1" });
    // The retry reports the ALREADY-SENT outcome rather than sending again.
    expect(second).toEqual({ sent: true, providerId: "test-provider-1" });
    expect(db.tables.get("rachandzach_notification_log") ?? []).toHaveLength(1);
  });

  it("two genuinely concurrent calls for the same batch still send exactly once", async () => {
    const db = createFakeDb(
      {
        rachandzach_upload_batches: [batchRow()],
        rachandzach_upload_items: [itemRow(ITEM_A)],
      },
      UNIQUE,
    );
    const { calls, transport } = createRecordingTransport();

    const [a, b] = await Promise.all([
      notifyNewBatch(BATCH_ID, { client: db.client, transport }),
      notifyNewBatch(BATCH_ID, { client: db.client, transport }),
    ]);

    expect(calls).toHaveLength(1);
    // Both callers observe a successful, sent outcome -- whichever won the
    // race sent it; the loser reports that same outcome back.
    expect(a.sent).toBe(true);
    expect(b.sent).toBe(true);
    expect(a.providerId).toBe(b.providerId);
    expect(db.tables.get("rachandzach_notification_log") ?? []).toHaveLength(1);
  });

  it("a different batch gets its own independent send", async () => {
    const otherBatchId = "99999999-9999-4999-8999-999999999999";
    const db = createFakeDb(
      {
        rachandzach_upload_batches: [batchRow(), batchRow({ id: otherBatchId })],
        rachandzach_upload_items: [
          itemRow(ITEM_A),
          itemRow(ITEM_B, { batch_id: otherBatchId }),
        ],
      },
      UNIQUE,
    );
    const { calls, transport } = createRecordingTransport();

    await notifyNewBatch(BATCH_ID, { client: db.client, transport });
    await notifyNewBatch(otherBatchId, { client: db.client, transport });

    expect(calls).toHaveLength(2);
    expect(db.tables.get("rachandzach_notification_log") ?? []).toHaveLength(2);
  });

  it("returns a non-sent result for a batch that does not exist, without writing a log row", async () => {
    const db = createFakeDb({}, UNIQUE);
    const { calls, transport } = createRecordingTransport();
    const result = await notifyNewBatch(BATCH_ID, { client: db.client, transport });
    expect(result).toEqual({ sent: false, providerId: null });
    expect(calls).toHaveLength(0);
    expect(db.tables.get("rachandzach_notification_log") ?? []).toHaveLength(0);
  });
});

describe("notifyUploadDecision", () => {
  it("skips entirely when the guest supplied no email (no send, no log row)", async () => {
    const db = createFakeDb(
      {
        rachandzach_upload_batches: [batchRow({ email: null, status: "approved" })],
        rachandzach_upload_items: [itemRow(ITEM_A)],
      },
      UNIQUE,
    );
    const { calls, transport } = createRecordingTransport();

    const result = await notifyUploadDecision(BATCH_ID, { client: db.client, transport });

    expect(result).toEqual({ sent: false, providerId: null });
    expect(calls).toHaveLength(0);
    expect(db.tables.get("rachandzach_notification_log") ?? []).toHaveLength(0);
  });

  it("sends a guest_approved receipt and is idempotent across retries", async () => {
    const db = createFakeDb(
      {
        rachandzach_upload_batches: [batchRow({ status: "approved" })],
        rachandzach_upload_items: [itemRow(ITEM_A), itemRow(ITEM_B)],
      },
      UNIQUE,
    );
    const { calls, transport } = createRecordingTransport();

    const first = await notifyUploadDecision(BATCH_ID, { client: db.client, transport });
    const second = await notifyUploadDecision(BATCH_ID, { client: db.client, transport });

    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe("guest_approved");
    expect(calls[0].to).toBe("guest@example.com");
    expect(first.sent).toBe(true);
    expect(second.sent).toBe(true);
  });

  it("sends a guest_rejected receipt that never contains the internal rejection reason", async () => {
    const db = createFakeDb(
      {
        rachandzach_upload_batches: [batchRow({ status: "rejected" })],
        rachandzach_upload_items: [
          itemRow(ITEM_A, {
            status: "rejected",
            rejection_reason: "admin-eyes-only: guest's ex is in the shot",
          }),
        ],
      },
      UNIQUE,
    );
    const { calls, transport } = createRecordingTransport();

    const result = await notifyUploadDecision(BATCH_ID, { client: db.client, transport });

    expect(result.sent).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe("guest_rejected");
    expect(calls[0].html).not.toContain("admin-eyes-only");
    expect(calls[0].html).not.toContain("guest's ex");
  });

  it("does nothing for a batch that has not reached a terminal state", async () => {
    const db = createFakeDb(
      {
        rachandzach_upload_batches: [batchRow({ status: "under_review" })],
        rachandzach_upload_items: [itemRow(ITEM_A, { status: "pending" })],
      },
      UNIQUE,
    );
    const { calls, transport } = createRecordingTransport();
    const result = await notifyUploadDecision(BATCH_ID, { client: db.client, transport });
    expect(result).toEqual({ sent: false, providerId: null });
    expect(calls).toHaveLength(0);
  });
});

describe("Resend stays disabled without explicit configuration", () => {
  const savedApiKey = process.env.RESEND_API_KEY;
  const savedApproval = process.env.RESEND_SEND_APPROVED;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_SEND_APPROVED;
  });

  afterEach(() => {
    if (savedApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedApiKey;
    if (savedApproval === undefined) delete process.env.RESEND_SEND_APPROVED;
    else process.env.RESEND_SEND_APPROVED = savedApproval;
  });

  it("isSendingEnabled is false with no RESEND_API_KEY and no approval flag", () => {
    expect(isSendingEnabled()).toBe(false);
    process.env.RESEND_API_KEY = "re_fake_key_for_test";
    expect(isSendingEnabled()).toBe(false); // approval flag still missing
    process.env.RESEND_SEND_APPROVED = "true";
    expect(isSendingEnabled()).toBe(true);
  });

  it("the default transport never sends and the log row records 'skipped', never touching a real provider", async () => {
    const db = createFakeDb(
      {
        rachandzach_upload_batches: [batchRow()],
        rachandzach_upload_items: [itemRow(ITEM_A)],
      },
      UNIQUE,
    );

    // No transport override: exercises the real default transport, which
    // must short-circuit before ever importing the Resend SDK.
    const result = await notifyNewBatch(BATCH_ID, { client: db.client });

    expect(result).toEqual({ sent: false, providerId: null });
    const logRows = db.tables.get("rachandzach_notification_log") ?? [];
    expect(logRows).toHaveLength(1);
    expect(logRows[0].status).toBe("skipped");
    expect(logRows[0].provider_id).toBeNull();
  });

  it("hardcodes the approved sender identity for whenever sending IS enabled", () => {
    expect(NOTIFICATION_SENDER).toBe('"0719 + co." <wedding@rachandzach.com>');
  });
});
