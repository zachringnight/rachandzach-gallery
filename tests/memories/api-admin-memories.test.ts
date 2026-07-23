/**
 * /api/admin/memories route tests (Memories wall, Round Two): the review
 * queue list plus approve / reject decisions. requireAdmin and
 * createAdminClient are mocked; a guest session is deliberately never
 * consulted by these routes, so admin denial alone decides access. Pending
 * and rejected notes exist only behind these handlers, which is what the
 * guest-side tests' approved-only assertions rely on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AdminAccessError } from "@/lib/auth/admin-session";
import { GET as listMemories } from "@/app/api/admin/memories/route";
import { POST as approveMemory } from "@/app/api/admin/memories/[memoryId]/approve/route";
import { POST as rejectMemory } from "@/app/api/admin/memories/[memoryId]/reject/route";
import { createFakeMemoriesDb, type FakeMemoriesDb } from "./fake-memories-db";

const { requireAdminMock, createAdminClientMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/auth/admin-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/admin-session")>();
  return { ...actual, requireAdmin: requireAdminMock };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

const PHOTO = "11111111-1111-4111-8111-111111111111";

function grantAdmin(): void {
  requireAdminMock.mockResolvedValue({
    userId: "00000000-0000-4000-8000-000000000001",
    email: "wedding@rachandzach.com",
  });
}

function listRequest(status?: string): NextRequest {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return new NextRequest(`https://gallery.test/api/admin/memories${query}`);
}

function decisionRequest(memoryId: string, decision: string): NextRequest {
  return new NextRequest(
    `https://gallery.test/api/admin/memories/${memoryId}/${decision}`,
    { method: "POST" },
  );
}

function params(memoryId: string): { params: Promise<{ memoryId: string }> } {
  return { params: Promise.resolve({ memoryId }) };
}

function seedDb(): FakeMemoriesDb {
  const db = createFakeMemoriesDb({
    photos: [{ id: PHOTO, status: "published" }],
    memories: [
      { photo_id: PHOTO, body: "Waiting one", status: "pending", display_name: "Sarah" },
      { photo_id: PHOTO, body: "Waiting two", status: "pending" },
      { photo_id: PHOTO, body: "Already live", status: "approved" },
      { photo_id: PHOTO, body: "Already declined", status: "rejected" },
    ],
  });
  createAdminClientMock.mockReturnValue(db.client);
  return db;
}

beforeEach(() => {
  requireAdminMock.mockReset();
  createAdminClientMock.mockReset();
});

describe("GET /api/admin/memories", () => {
  it("maps admin denial through: 401 unauthenticated, 403 wrong account", async () => {
    for (const status of [401, 403] as const) {
      requireAdminMock.mockRejectedValueOnce(
        new AdminAccessError("denied", status),
      );
      const response = await listMemories(listRequest());
      expect(response.status).toBe(status);
    }
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("lists pending memories by default, oldest first, with the admin shape", async () => {
    grantAdmin();
    seedDb();
    const response = await listMemories(listRequest());
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      memories: Array<Record<string, unknown>>;
    };
    expect(payload.memories.map((memory) => memory.body)).toEqual([
      "Waiting one",
      "Waiting two",
    ]);
    expect(Object.keys(payload.memories[0]).sort()).toEqual([
      "body",
      "createdAt",
      "displayName",
      "id",
      "photoId",
      "reviewedAt",
      "status",
    ]);
    expect(payload.memories[0].status).toBe("pending");
    // Even the admin payload carries no owner key; it adds nothing to decide on.
    expect(JSON.stringify(payload)).not.toContain("owner");
  });

  it("lists other statuses on request and rejects unknown ones", async () => {
    grantAdmin();
    seedDb();
    const approved = await listMemories(listRequest("approved"));
    const payload = (await approved.json()) as {
      memories: Array<{ body: string }>;
    };
    expect(payload.memories.map((memory) => memory.body)).toEqual([
      "Already live",
    ]);
    expect((await listMemories(listRequest("bogus"))).status).toBe(400);
  });
});

describe("POST /api/admin/memories/[memoryId]/approve and /reject", () => {
  it("requires admin before touching the database", async () => {
    requireAdminMock.mockRejectedValue(new AdminAccessError("denied", 401));
    const response = await approveMemory(
      decisionRequest(PHOTO, "approve"),
      params(PHOTO),
    );
    expect(response.status).toBe(401);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("approves a pending memory and stamps reviewed_at", async () => {
    grantAdmin();
    const db = seedDb();
    const target = db.rows().find((row) => row.body === "Waiting one")!;
    const response = await approveMemory(
      decisionRequest(target.id, "approve"),
      params(target.id),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: target.id, status: "approved" });
    const after = db.rows().find((row) => row.id === target.id)!;
    expect(after.status).toBe("approved");
    expect(after.reviewed_at).not.toBeNull();
  });

  it("rejects a pending memory, and a later approve can reverse it", async () => {
    grantAdmin();
    const db = seedDb();
    const target = db.rows().find((row) => row.body === "Waiting two")!;
    const rejected = await rejectMemory(
      decisionRequest(target.id, "reject"),
      params(target.id),
    );
    expect(rejected.status).toBe(200);
    expect(db.rows().find((row) => row.id === target.id)!.status).toBe(
      "rejected",
    );

    const reversed = await approveMemory(
      decisionRequest(target.id, "approve"),
      params(target.id),
    );
    expect(reversed.status).toBe(200);
    expect(db.rows().find((row) => row.id === target.id)!.status).toBe(
      "approved",
    );
  });

  it("answers 400 for malformed ids and 404 for unknown ones", async () => {
    grantAdmin();
    seedDb();
    expect(
      (
        await approveMemory(
          decisionRequest("not-a-uuid", "approve"),
          params("not-a-uuid"),
        )
      ).status,
    ).toBe(400);
    const ghost = "88888888-8888-4888-8888-888888888888";
    expect(
      (
        await rejectMemory(decisionRequest(ghost, "reject"), params(ghost))
      ).status,
    ).toBe(404);
  });
});
