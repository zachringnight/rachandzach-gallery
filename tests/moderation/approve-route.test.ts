import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createFakeDb } from "./fake-supabase";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  processApprovedPhoto: vi.fn(),
  reconcileProcessedPhoto: vi.fn(),
  notifyUploadDecision: vi.fn(),
}));

vi.mock("@/lib/auth/admin-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/admin-session")>();
  return { ...actual, requireAdmin: mocks.requireAdmin };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/moderation/process-approved-photo", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/moderation/process-approved-photo")
    >();
  return {
    ...actual,
    processApprovedPhoto: mocks.processApprovedPhoto,
    reconcileProcessedPhoto: mocks.reconcileProcessedPhoto,
  };
});

vi.mock("@/lib/notifications/resend", () => ({
  notifyUploadDecision: mocks.notifyUploadDecision,
}));

import { POST } from "@/app/api/admin/batches/[batchId]/approve/route";

const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_ITEM_ID = "77777777-7777-4777-8777-777777777777";
const BATCH_ID = "55555555-5555-4555-8555-555555555555";
const PHOTO_ID = "66666666-6666-4666-8666-666666666666";
const FILE_SHA256 = "b".repeat(64);

function batch() {
  return {
    id: BATCH_ID,
    receipt_hash: "a".repeat(64),
    email: "private@example.test",
    display_name: "Private Guest",
    note: "Private until finalization succeeds.",
    status: "under_review",
    submitted_at: new Date().toISOString(),
    reviewed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    batch_id: BATCH_ID,
    original_name: "photo.jpg",
    object_path: `pending/${BATCH_ID}/${ITEM_ID}/nonce`,
    bytes: 1024,
    media_type: "image/jpeg",
    sha256: FILE_SHA256,
    status: "pending",
    rejection_reason: null,
    note_approved: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function publishedPhoto(overrides: Record<string, unknown> = {}) {
  return {
    id: PHOTO_ID,
    file_sha256: FILE_SHA256,
    source: "guest",
    status: "published",
    processing_complete: true,
    ...overrides,
  };
}

function approveRequest(itemIds: string[] = [ITEM_ID]) {
  return new Request(
    `http://localhost/api/admin/batches/${BATCH_ID}/approve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemIds,
        eventSlug: null,
        peopleSlugs: [],
        keywords: [],
        noteApproved: true,
      }),
    },
  ) as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdmin.mockResolvedValue({
    userId: "admin-user-1",
    email: "wedding@rachandzach.com",
  });
  mocks.notifyUploadDecision.mockResolvedValue({ sent: true });
});

describe("POST /api/admin/batches/[batchId]/approve", () => {
  it("keeps a failed publication approved for retry and suppresses terminal notification", async () => {
    const db = createFakeDb({
      rachandzach_upload_batches: [batch()],
      rachandzach_upload_items: [item()],
    });
    mocks.createAdminClient.mockReturnValue(db.client);
    mocks.processApprovedPhoto.mockResolvedValue({
      photoId: PHOTO_ID,
      created: true,
    });
    mocks.reconcileProcessedPhoto
      .mockRejectedValueOnce(new Error("simulated publication failure"))
      .mockResolvedValueOnce({
        photoId: PHOTO_ID,
        owned: true,
        status: "pending",
        itemStatus: "approved",
      });

    const response = await POST(approveRequest(), {
      params: Promise.resolve({ batchId: BATCH_ID }),
    });
    const payload = await response.json();

    expect(payload.results).toEqual([
      {
        itemId: ITEM_ID,
        ok: false,
        error: "Could not approve this photo.",
      },
    ]);
    expect(payload.batchStatus).toBeNull();
    expect(db.tables.get("rachandzach_upload_items")?.[0]).toMatchObject({
      status: "approved",
      rejection_reason: null,
      note_approved: true,
    });
    expect(db.tables.get("rachandzach_upload_batches")?.[0].status).toBe(
      "under_review",
    );
    expect(
      db.inserts
        .filter(
          (entry) => entry.table === "rachandzach_moderation_actions",
        )
        .map((entry) => entry.row.action),
    ).toEqual(["approve_item"]);
    expect(mocks.notifyUploadDecision).not.toHaveBeenCalled();
  });

  it("does not undo a concurrently published result when an idempotent request fails", async () => {
    const db = createFakeDb({
      rachandzach_upload_batches: [batch()],
      rachandzach_upload_items: [
        item({ status: "approved", note_approved: true }),
      ],
      rachandzach_photos: [publishedPhoto()],
    });
    mocks.createAdminClient.mockReturnValue(db.client);
    mocks.processApprovedPhoto.mockResolvedValue({
      photoId: PHOTO_ID,
      created: false,
    });
    mocks.reconcileProcessedPhoto
      .mockRejectedValueOnce(new Error("stale request lost publication race"))
      .mockResolvedValueOnce({
        photoId: PHOTO_ID,
        owned: true,
        status: "published",
        itemStatus: "approved",
      });

    const response = await POST(approveRequest(), {
      params: Promise.resolve({ batchId: BATCH_ID }),
    });
    const payload = await response.json();

    expect(payload.results[0].ok).toBe(false);
    expect(payload.batchStatus).toBe("approved");
    expect(db.tables.get("rachandzach_upload_items")?.[0].status).toBe(
      "approved",
    );
    expect(db.tables.get("rachandzach_photos")?.[0].status).toBe("published");
    expect(
      db.inserts.filter(
        (entry) =>
          entry.table === "rachandzach_moderation_actions" &&
          entry.row.item_id === ITEM_ID,
      ),
    ).toHaveLength(0);
    expect(mocks.notifyUploadDecision).toHaveBeenCalledWith(BATCH_ID, {
      client: db.client,
    });
  });

  it("recomputes stale bulk approval conflicts so mixed winners converge", async () => {
    const db = createFakeDb({
      rachandzach_upload_batches: [batch()],
      rachandzach_upload_items: [
        item({ status: "approved", note_approved: true }),
        item({
          id: OTHER_ITEM_ID,
          sha256: "c".repeat(64),
          status: "rejected",
        }),
      ],
      rachandzach_photos: [publishedPhoto()],
    });
    mocks.createAdminClient.mockReturnValue(db.client);
    mocks.processApprovedPhoto.mockImplementation(async (itemId: string) => {
      if (itemId === ITEM_ID) {
        return { photoId: PHOTO_ID, created: false };
      }
      throw new Error("stale approve selection");
    });
    mocks.reconcileProcessedPhoto.mockResolvedValue({
      photoId: PHOTO_ID,
      owned: true,
      status: "published",
      itemStatus: "approved",
    });

    const response = await POST(
      approveRequest([ITEM_ID, OTHER_ITEM_ID]),
      {
        params: Promise.resolve({ batchId: BATCH_ID }),
      },
    );
    const payload = await response.json();

    expect(payload.results).toHaveLength(2);
    expect(payload.results.map((result: { ok: boolean }) => result.ok)).toEqual([
      true,
      false,
    ]);
    expect(payload.batchStatus).toBe("partially_approved");
    expect(db.tables.get("rachandzach_upload_batches")?.[0].status).toBe(
      "partially_approved",
    );
    expect(mocks.notifyUploadDecision).toHaveBeenCalledWith(BATCH_ID, {
      client: db.client,
    });
  });
});
