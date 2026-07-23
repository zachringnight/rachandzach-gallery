/**
 * Submission Receipt tests (packet 11).
 *
 * Proves "a batch id without its receipt token reveals nothing":
 *   - No receipt token at all never even calls getUploadStatus.
 *   - A wrong token and an unknown batch id both resolve to the exact same
 *     opaque view -- not just "similar," but deep-equal -- so nothing about
 *     WHY a lookup failed ever reaches the guest.
 *   - Every guest-visible state has real, non-placeholder copy.
 *
 * The first half exercises loadSubmissionReceiptView/resolveSubmissionReceiptView
 * as pure logic with a stub getUploadStatus. The second half chains the REAL
 * getUploadStatus (task 08, src/lib/uploads/create-batch.ts) through a mocked
 * Supabase client, mirroring tests/uploads/status-isolation.test.ts's mock
 * shape, so the full realistic path is proven too, not just this packet's own
 * mapping layer.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { UPLOAD_STATES, hashReceiptToken, type PublicUploadStatus } from "@/lib/uploads/contracts";
import { getUploadStatus } from "@/lib/uploads/create-batch";
import {
  SUBMISSION_STATE_COPY,
  loadSubmissionReceiptView,
  resolveSubmissionReceiptView,
} from "@/lib/modules/contracts";

const BATCH_ID = "c1111111-2222-4333-8444-555555555555";
const OTHER_BATCH_ID = "d9999999-8888-4777-8666-555555555555";

function makeStatus(overrides: Partial<PublicUploadStatus> = {}): PublicUploadStatus {
  return {
    batchId: BATCH_ID,
    state: "submitted",
    counts: { total: 3, pending: 3, approved: 0, rejected: 0, removed: 0 },
    submittedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe("resolveSubmissionReceiptView", () => {
  it("maps a null status (any failure reason) to the opaque view", () => {
    expect(resolveSubmissionReceiptView(null)).toEqual({ kind: "opaque" });
  });

  it("pairs every guest-visible state with its own copy", () => {
    for (const state of UPLOAD_STATES) {
      const status = makeStatus({ state });
      const view = resolveSubmissionReceiptView(status);
      expect(view).toEqual({
        kind: "status",
        status,
        copy: SUBMISSION_STATE_COPY[state],
      });
    }
  });
});

describe("SUBMISSION_STATE_COPY", () => {
  const PLACEHOLDER = /\b(TODO|TBD|FIXME|lorem|ipsum|placeholder)\b/i;

  it("gives every upload state real headline and body copy", () => {
    for (const state of UPLOAD_STATES) {
      const copy = SUBMISSION_STATE_COPY[state];
      expect(copy, `missing copy for "${state}"`).toBeDefined();
      expect(copy.headline.trim().length, `empty headline for "${state}"`).toBeGreaterThan(0);
      expect(copy.body.trim().length, `empty body for "${state}"`).toBeGreaterThan(0);
      expect(PLACEHOLDER.test(copy.headline), `placeholder headline for "${state}"`).toBe(false);
      expect(PLACEHOLDER.test(copy.body), `placeholder body for "${state}"`).toBe(false);
    }
  });

  it("covers exactly the guest-facing state set, no more, no fewer", () => {
    expect(Object.keys(SUBMISSION_STATE_COPY).sort()).toEqual([...UPLOAD_STATES].sort());
  });
});

describe("loadSubmissionReceiptView reveals nothing without a real pairing", () => {
  it("never calls getUploadStatus when no receipt token is present", async () => {
    const getUploadStatusMock = vi.fn();
    const view = await loadSubmissionReceiptView(BATCH_ID, undefined, {
      getUploadStatus: getUploadStatusMock,
    });
    expect(view).toEqual({ kind: "opaque" });
    expect(getUploadStatusMock).not.toHaveBeenCalled();
  });

  it("never calls getUploadStatus for an empty-string receipt token", async () => {
    const getUploadStatusMock = vi.fn();
    const view = await loadSubmissionReceiptView(BATCH_ID, "", {
      getUploadStatus: getUploadStatusMock,
    });
    expect(view).toEqual({ kind: "opaque" });
    expect(getUploadStatusMock).not.toHaveBeenCalled();
  });

  it("resolves a wrong token to the opaque view", async () => {
    const view = await loadSubmissionReceiptView(BATCH_ID, "wrong-token", {
      getUploadStatus: async () => null,
    });
    expect(view).toEqual({ kind: "opaque" });
  });

  it("resolves an unknown batch id to the SAME opaque view as a wrong token", async () => {
    const wrongToken = await loadSubmissionReceiptView(BATCH_ID, "wrong-token", {
      getUploadStatus: async () => null,
    });
    const unknownBatch = await loadSubmissionReceiptView("00000000-0000-4000-8000-000000000000", "any-token", {
      getUploadStatus: async () => null,
    });
    expect(wrongToken).toEqual(unknownBatch);
    expect(wrongToken).toEqual({ kind: "opaque" });
  });

  it("passes batchId and receiptToken through unchanged to getUploadStatus", async () => {
    const getUploadStatusMock = vi.fn().mockResolvedValue(makeStatus());
    await loadSubmissionReceiptView(BATCH_ID, "the-real-token", {
      getUploadStatus: getUploadStatusMock,
    });
    expect(getUploadStatusMock).toHaveBeenCalledExactlyOnceWith(BATCH_ID, "the-real-token");
  });

  it("resolves a real match to the status view with the matching copy", async () => {
    const status = makeStatus({ state: "approved" });
    const view = await loadSubmissionReceiptView(BATCH_ID, "the-real-token", {
      getUploadStatus: async () => status,
    });
    expect(view).toEqual({ kind: "status", status, copy: SUBMISSION_STATE_COPY.approved });
  });
});

// ---------------------------------------------------------------------------
// End-to-end-ish: the real getUploadStatus (task 08) through a mocked
// Supabase client, chained through loadSubmissionReceiptView.
// ---------------------------------------------------------------------------

interface FakeBatchRow {
  id: string;
  status: string;
  created_at: string;
  submitted_at: string | null;
}

function mockDb(config: {
  receiptHash: string;
  batches: Record<string, FakeBatchRow>;
  items: Record<string, Array<{ status: string }>>;
}): SupabaseClient<Database> {
  return {
    from(table: string) {
      const state = { filters: {} as Record<string, string> };
      const api = {
        select() {
          return api;
        },
        eq(col: string, val: string) {
          state.filters[col] = val;
          return api;
        },
        maybeSingle: async () => {
          if (table === "rachandzach_upload_batches") {
            const row = state.filters.id ? config.batches[state.filters.id] : undefined;
            const match = row && row.status !== undefined && state.filters.receipt_hash === config.receiptHash;
            return { data: match ? row : null, error: null };
          }
          return { data: null, error: null };
        },
        then(
          onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          const items = table === "rachandzach_upload_items" ? (config.items[state.filters.batch_id] ?? []) : [];
          return Promise.resolve({ data: items, error: null }).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("real getUploadStatus chained through loadSubmissionReceiptView", () => {
  it("a batch id without its receipt token reveals nothing, end to end", async () => {
    const receiptHash = await hashReceiptToken("the-real-token");
    const db = mockDb({
      receiptHash,
      batches: {
        [BATCH_ID]: {
          id: BATCH_ID,
          status: "submitted",
          created_at: new Date().toISOString(),
          submitted_at: new Date().toISOString(),
        },
      },
      items: { [BATCH_ID]: [{ status: "pending" }] },
    });

    const deps = { getUploadStatus: (id: string, token: string) => getUploadStatus(id, token, db) };

    const wrongToken = await loadSubmissionReceiptView(BATCH_ID, "not-the-token", deps);
    const noToken = await loadSubmissionReceiptView(BATCH_ID, undefined, deps);
    const unknownBatch = await loadSubmissionReceiptView(OTHER_BATCH_ID, "the-real-token", deps);
    const malformedId = await loadSubmissionReceiptView("not-a-uuid", "the-real-token", deps);

    expect(wrongToken).toEqual({ kind: "opaque" });
    expect(noToken).toEqual({ kind: "opaque" });
    expect(unknownBatch).toEqual({ kind: "opaque" });
    expect(malformedId).toEqual({ kind: "opaque" });

    // The correct pairing, by contrast, resolves to real (but still
    // whitelisted -- see status-isolation.test.ts) state and counts.
    const correct = await loadSubmissionReceiptView(BATCH_ID, "the-real-token", deps);
    expect(correct.kind).toBe("status");
    if (correct.kind === "status") {
      expect(correct.status.state).toBe("submitted");
      expect(correct.status.counts.total).toBe(1);
      expect(JSON.stringify(correct.status)).not.toContain("object_path");
    }
  });
});
