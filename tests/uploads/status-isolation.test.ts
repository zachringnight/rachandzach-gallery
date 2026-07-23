/**
 * Upload status isolation tests (packet 08).
 *
 * Proves the privacy contract around guest uploads:
 *   - Receipt tokens are hashed before storage; the plaintext never lands in
 *     any persisted field.
 *   - getUploadStatus reveals state + counts ONLY. Object paths, filenames,
 *     email, and the note never leave the server, so a guest cannot read or
 *     list their pending objects after upload.
 *   - A wrong receipt token and a nonexistent batch both resolve to null, so
 *     the endpoint cannot enumerate other guests' batches, and the lookup is
 *     always scoped by the receipt-token hash.
 *   - Reading status never touches storage.
 *
 * All exercised against mocked Supabase clients: no live database or storage.
 * (The complementary guarantee "a submitted fixture is absent from every
 * gallery query" is a query-layer/build concern verified by packets 06/13 and
 * the integration build, not reachable from this unit without a live DB.)
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { GallerySession } from "@/lib/auth/guest-session";
import {
  UPLOAD_BATCH_TTL_SECONDS,
  hashReceiptToken,
} from "@/lib/uploads/contracts";
import { createUploadBatch, getUploadStatus } from "@/lib/uploads/create-batch";

const SESSION: GallerySession = {
  sessionId: "session-abc",
  issuedAt: 0,
  expiresAt: 0,
  version: 1,
};

const BATCH_ID = "c1111111-2222-4333-8444-555555555555";

interface Captured {
  eqs: Array<{ table: string; col: string; val: string }>;
  selectCols: Array<{ table: string; cols: string }>;
}

function emptyCapture(): Captured {
  return { eqs: [], selectCols: [] };
}

// --- createUploadBatch mock ------------------------------------------------

function mockBatchInsertClient(captured: Array<{ table: string; row: Record<string, unknown> }>) {
  const client = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          captured.push({ table, row });
          return {
            select() {
              return {
                single: async () => ({
                  data: {
                    id: "b1111111-2222-4333-8444-555555555555",
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient<Database>;
  return client;
}

// --- getUploadStatus mock --------------------------------------------------

interface StatusConfig {
  batchId: string;
  receiptHash: string;
  batchRow: {
    id: string;
    status: string;
    created_at: string;
    submitted_at: string | null;
  } | null;
  items: Array<{ status: string; object_path?: string }>;
  capture: Captured;
}

function mockStatusClient(config: StatusConfig): SupabaseClient<Database> {
  const client = {
    from(table: string) {
      const state = { cols: "", filters: {} as Record<string, string> };
      const api = {
        select(cols: string) {
          state.cols = cols;
          return api;
        },
        eq(col: string, val: string) {
          state.filters[col] = val;
          config.capture.eqs.push({ table, col, val });
          return api;
        },
        maybeSingle: async () => {
          config.capture.selectCols.push({ table, cols: state.cols });
          if (table === "rachandzach_upload_batches") {
            const match =
              state.filters.id === config.batchId &&
              state.filters.receipt_hash === config.receiptHash;
            return { data: match ? config.batchRow : null, error: null };
          }
          return { data: null, error: null };
        },
        then(
          onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          const result =
            table === "rachandzach_upload_items"
              ? { data: config.items, error: null }
              : { data: [], error: null };
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
    storage: {
      from() {
        throw new Error("reading status must never touch storage");
      },
    },
  } as unknown as SupabaseClient<Database>;
  return client;
}

// --- Tests -----------------------------------------------------------------

describe("createUploadBatch hashes the receipt before storage", () => {
  it("persists only the hash, never the plaintext token", async () => {
    const captured: Array<{ table: string; row: Record<string, unknown> }> = [];
    const client = mockBatchInsertClient(captured);

    const receipt = await createUploadBatch(
      {
        displayName: "Grace",
        email: "grace@example.com",
        note: "a note",
        itemCount: 2,
      },
      SESSION,
      client,
    );

    expect(captured).toHaveLength(1);
    const row = captured[0].row;
    expect(captured[0].table).toBe("rachandzach_upload_batches");
    expect(row.status).toBe("draft");

    // The stored receipt_hash is exactly the SHA-256 of the returned token.
    expect(row.receipt_hash).toBe(await hashReceiptToken(receipt.receiptToken));
    expect(row.receipt_hash).toMatch(/^[0-9a-f]{64}$/);
    // The plaintext token appears in no persisted field.
    expect(row.receipt_hash).not.toBe(receipt.receiptToken);
    expect(JSON.stringify(row)).not.toContain(receipt.receiptToken);

    expect(receipt.batchId).toBe("b1111111-2222-4333-8444-555555555555");
    expect(Date.parse(receipt.expiresAt)).toBeGreaterThan(Date.now());
  });
});

describe("getUploadStatus reveals state and counts only", () => {
  const RECEIPT = "receipt-secret-abc123";

  async function build(overrides: Partial<StatusConfig> = {}) {
    const receiptHash = await hashReceiptToken(RECEIPT);
    const capture = overrides.capture ?? emptyCapture();
    const config: StatusConfig = {
      batchId: BATCH_ID,
      receiptHash,
      batchRow: {
        id: BATCH_ID,
        status: "submitted",
        created_at: new Date().toISOString(),
        submitted_at: new Date().toISOString(),
      },
      items: [
        { status: "pending", object_path: "pending/a/b/c" },
        { status: "approved", object_path: "pending/d/e/f" },
      ],
      capture,
      ...overrides,
    };
    return { client: mockStatusClient(config), capture, receiptHash };
  }

  it("returns exactly the whitelisted fields and never an object path", async () => {
    const { client } = await build();
    const status = await getUploadStatus(BATCH_ID, RECEIPT, client);

    expect(status).not.toBeNull();
    expect(Object.keys(status!).sort()).toEqual([
      "batchId",
      "counts",
      "expiresAt",
      "state",
      "submittedAt",
    ]);
    expect(status!.state).toBe("submitted");
    expect(status!.counts).toEqual({
      total: 2,
      pending: 1,
      approved: 1,
      rejected: 0,
      removed: 0,
    });

    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("object_path");
    expect(serialized).not.toContain("pending/");
  });

  it("never even selects the email or note columns for a status read", async () => {
    const { client, capture } = await build();
    await getUploadStatus(BATCH_ID, RECEIPT, client);
    const batchSelect = capture.selectCols.find(
      (entry) => entry.table === "rachandzach_upload_batches",
    );
    expect(batchSelect).toBeDefined();
    expect(batchSelect!.cols).not.toContain("email");
    expect(batchSelect!.cols).not.toContain("note");
    expect(batchSelect!.cols).not.toContain("receipt_hash");
  });

  it("scopes every lookup by the receipt-token hash", async () => {
    const { client, capture, receiptHash } = await build();
    await getUploadStatus(BATCH_ID, RECEIPT, client);
    const receiptFilter = capture.eqs.find(
      (entry) =>
        entry.table === "rachandzach_upload_batches" &&
        entry.col === "receipt_hash",
    );
    expect(receiptFilter).toBeDefined();
    expect(receiptFilter!.val).toBe(receiptHash);
  });

  it("resolves a wrong receipt token to null (no enumeration)", async () => {
    const { client } = await build();
    expect(await getUploadStatus(BATCH_ID, "the-wrong-token", client)).toBeNull();
  });

  it("resolves a nonexistent batch to null", async () => {
    const { client } = await build({ batchRow: null });
    expect(await getUploadStatus(BATCH_ID, RECEIPT, client)).toBeNull();
  });

  it("rejects a non-UUID batch id without ever querying", async () => {
    const capture = emptyCapture();
    const { client } = await build({ capture });
    expect(await getUploadStatus("not-a-uuid", RECEIPT, client)).toBeNull();
    expect(capture.eqs).toHaveLength(0);
  });

  it("reports expired for a draft past its TTL", async () => {
    const { client } = await build({
      batchRow: {
        id: BATCH_ID,
        status: "draft",
        created_at: new Date(
          Date.now() - (UPLOAD_BATCH_TTL_SECONDS + 120) * 1000,
        ).toISOString(),
        submitted_at: null,
      },
      items: [],
    });
    const status = await getUploadStatus(BATCH_ID, RECEIPT, client);
    expect(status!.state).toBe("expired");
  });
});
