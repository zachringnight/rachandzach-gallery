/**
 * /api/memories route tests (Memories wall, Round Two): auth requirement,
 * approved-only reads (pending and rejected are invisible to every guest,
 * including their author), server-side owner-key derivation, validation
 * bounds, and the fail-closed rate limit. requireGalleryAccess and
 * createAdminClient are mocked (vi.mock, same pattern as
 * tests/favorites/api-favorites.test.ts); the database is the shared
 * in-memory fake in fake-memories-db.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  GalleryAccessConfigError,
  GalleryAccessError,
} from "@/lib/auth/guest-session";
import { GET, POST } from "@/app/api/memories/route";
import { createFakeMemoriesDb, type FakeMemoriesDb } from "./fake-memories-db";

const { requireGalleryAccessMock, createAdminClientMock } = vi.hoisted(() => ({
  requireGalleryAccessMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/auth/guest-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/guest-session")>();
  return { ...actual, requireGalleryAccess: requireGalleryAccessMock };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

const SESSION_ID = "3f2ee0a3-92d5-4a1a-9c40-2f4a1c8b7d10";
const PUBLISHED = "11111111-1111-4111-8111-111111111111";
const HIDDEN = "22222222-2222-4222-8222-222222222222";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

function grantSession(sessionId = SESSION_ID): void {
  requireGalleryAccessMock.mockResolvedValue({
    sessionId,
    issuedAt: 0,
    expiresAt: 9999999999,
    version: 1,
  });
}

function getRequest(photoId?: string): NextRequest {
  const query = photoId ? `?photoId=${encodeURIComponent(photoId)}` : "";
  return new NextRequest(`https://gallery.test/api/memories${query}`);
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest("https://gallery.test/api/memories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function seedDb(): FakeMemoriesDb {
  const db = createFakeMemoriesDb({
    people: ["rach"],
    photos: [
      { id: PUBLISHED, status: "published" },
      { id: HIDDEN, status: "hidden" },
    ],
    memories: [
      { photo_id: PUBLISHED, body: "First dance!", status: "approved", display_name: "Sarah" },
      { photo_id: PUBLISHED, body: "Still waiting", status: "pending" },
      { photo_id: PUBLISHED, body: "Not this one", status: "rejected" },
      { photo_id: HIDDEN, body: "On a hidden photo", status: "approved" },
    ],
  });
  createAdminClientMock.mockReturnValue(db.client);
  return db;
}

beforeEach(() => {
  requireGalleryAccessMock.mockReset();
  createAdminClientMock.mockReset();
  // hashRateLimitKey derives from the session secret; POST needs it set.
  vi.stubEnv("GALLERY_SESSION_SECRET", "s".repeat(48));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/memories", () => {
  it("requires a guest session", async () => {
    requireGalleryAccessMock.mockRejectedValue(new GalleryAccessError());
    const response = await GET(getRequest(PUBLISHED));
    expect(response.status).toBe(401);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("maps configuration failures to 500, not 401", async () => {
    requireGalleryAccessMock.mockRejectedValue(
      new GalleryAccessConfigError("secret missing"),
    );
    const response = await GET(getRequest(PUBLISHED));
    expect(response.status).toBe(500);
  });

  it("rejects a missing or malformed photoId", async () => {
    grantSession();
    seedDb();
    expect((await GET(getRequest())).status).toBe(400);
    expect((await GET(getRequest("not-a-uuid"))).status).toBe(400);
  });

  it("returns APPROVED memories only; pending and rejected are invisible", async () => {
    grantSession();
    seedDb();
    const response = await GET(getRequest(PUBLISHED));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      memories: Array<Record<string, unknown>>;
    };
    expect(payload.memories).toHaveLength(1);
    expect(payload.memories[0].body).toBe("First dance!");
    expect(payload.memories[0].displayName).toBe("Sarah");
  });

  it("never serializes owner keys or status to guests", async () => {
    grantSession();
    seedDb();
    const response = await GET(getRequest(PUBLISHED));
    const payload = (await response.json()) as {
      memories: Array<Record<string, unknown>>;
    };
    expect(Object.keys(payload.memories[0]).sort()).toEqual([
      "body",
      "createdAt",
      "displayName",
      "id",
    ]);
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain("owner");
    expect(raw).not.toContain(SESSION_ID);
  });

  it("answers a hidden photo and an unknown photo identically (empty wall)", async () => {
    grantSession();
    seedDb();
    const hidden = await GET(getRequest(HIDDEN));
    const unknown = await GET(getRequest(UNKNOWN));
    expect(hidden.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await hidden.json()).toEqual({ memories: [] });
    expect(await unknown.json()).toEqual({ memories: [] });
  });
});

describe("POST /api/memories", () => {
  it("requires a guest session", async () => {
    requireGalleryAccessMock.mockRejectedValue(new GalleryAccessError());
    const response = await POST(postRequest({ photoId: PUBLISHED, body: "hi" }));
    expect(response.status).toBe(401);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and bad fields before consuming rate limit", async () => {
    grantSession();
    const db = seedDb();
    expect((await POST(postRequest("{not json"))).status).toBe(400);
    expect((await POST(postRequest({ body: "hi" }))).status).toBe(400); // no photoId
    expect(
      (await POST(postRequest({ photoId: "nope", body: "hi" }))).status,
    ).toBe(400);
    expect(
      (await POST(postRequest({ photoId: PUBLISHED }))).status,
    ).toBe(422); // no body
    expect(
      (await POST(postRequest({ photoId: PUBLISHED, body: "   " }))).status,
    ).toBe(422);
    expect(
      (
        await POST(
          postRequest({ photoId: PUBLISHED, body: "x".repeat(501) }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await POST(
          postRequest({
            photoId: PUBLISHED,
            body: "fine",
            displayName: "n".repeat(81),
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await POST(
          postRequest({ photoId: PUBLISHED, body: "fine", displayName: 42 }),
        )
      ).status,
    ).toBe(422);
    // None of the rejects burned a rate-limit attempt or wrote a row.
    expect(db.rpcCalls()).toHaveLength(0);
    expect(db.rows()).toHaveLength(4);
  });

  it("creates a pending row keyed to the verified session", async () => {
    grantSession();
    const db = seedDb();
    const response = await POST(
      postRequest({ photoId: PUBLISHED, body: "  We loved this.  " }),
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { id: string; status: string };
    expect(payload.status).toBe("pending");

    const created = db.rows().find((row) => row.id === payload.id);
    expect(created).toBeDefined();
    expect(created!.status).toBe("pending");
    expect(created!.owner_kind).toBe("session");
    expect(created!.owner_key).toBe(SESSION_ID);
    expect(created!.body).toBe("We loved this.");
    expect(created!.display_name).toBeNull();
  });

  it("keys by person when the supplied slug matches a real person", async () => {
    grantSession();
    const db = seedDb();
    const response = await POST(
      postRequest({
        photoId: PUBLISHED,
        body: "From the aisle seat.",
        displayName: " Sarah ",
        person: "rach",
      }),
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const created = db.rows().find((row) => row.id === id)!;
    expect(created.owner_kind).toBe("person");
    expect(created.owner_key).toBe("rach");
    expect(created.display_name).toBe("Sarah");
  });

  it("falls back to session keying for unknown person slugs and ignores body session ids", async () => {
    grantSession();
    const db = seedDb();
    const response = await POST(
      postRequest({
        photoId: PUBLISHED,
        body: "sneaky",
        person: "nobody-here",
        sessionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      }),
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const created = db.rows().find((row) => row.id === id)!;
    expect(created.owner_kind).toBe("session");
    expect(created.owner_key).toBe(SESSION_ID);
  });

  it("answers 404 for hidden and unknown photos alike, writing nothing", async () => {
    grantSession();
    const db = seedDb();
    for (const photoId of [HIDDEN, UNKNOWN]) {
      const response = await POST(postRequest({ photoId, body: "hello" }));
      expect(response.status).toBe(404);
    }
    expect(db.rows()).toHaveLength(4);
  });

  it("denies with 429 when the rate limit bucket is exhausted", async () => {
    grantSession();
    const db = seedDb();
    db.setRateLimit("deny");
    const response = await POST(
      postRequest({ photoId: PUBLISHED, body: "over budget" }),
    );
    expect(response.status).toBe(429);
    expect(db.rows()).toHaveLength(4);
  });

  it("fails closed on rate-limit RPC errors and transport failures", async () => {
    grantSession();
    for (const behavior of ["error", "throw"] as const) {
      const db = seedDb();
      db.setRateLimit(behavior);
      const response = await POST(
        postRequest({ photoId: PUBLISHED, body: "no database" }),
      );
      expect(response.status, `behavior ${behavior}`).toBe(429);
      expect(db.rows()).toHaveLength(4);
    }
  });

  it("fails closed (500) when the rate-limit secret is missing", async () => {
    grantSession();
    const db = seedDb();
    vi.stubEnv("GALLERY_SESSION_SECRET", "");
    const response = await POST(
      postRequest({ photoId: PUBLISHED, body: "no secret" }),
    );
    expect(response.status).toBe(500);
    expect(db.rows()).toHaveLength(4);
  });
});
