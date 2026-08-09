/**
 * /api/favorites route tests (Favorites v2): auth requirement, server-side
 * owner-key derivation (verified session id, never a client-supplied one),
 * person-slug validation against rachandzach_people, replace semantics, and
 * the session-to-person merge. getGuestSession and createAdminClient
 * are mocked (vi.mock, same pattern as tests/auth/route-protection.test.ts);
 * the Supabase client is a purpose-built in-memory fake that mirrors exactly
 * the call shapes src/lib/favorites/server.ts makes -- a mismatch is a
 * signal the production code changed shape, not a gap in the mock (the
 * tests/moderation/fake-supabase.ts philosophy).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { GalleryAccessConfigError } from "@/lib/auth/guest-session";
import {
  FAVORITES_SYNC_MAX,
  sanitizePhotoIds,
} from "@/lib/favorites/server";
import { GET, PUT } from "@/app/api/favorites/route";

const { getGuestSessionMock, createAdminClientMock } = vi.hoisted(() => ({
  getGuestSessionMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/auth/guest-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/guest-session")>();
  return { ...actual, getGuestSession: getGuestSessionMock };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

// --- In-memory fake covering exactly the favorites call shapes ------------

interface FavRow {
  owner_kind: string;
  owner_key: string;
  photo_id: string;
  created_at: string;
}

interface FakeFavoritesDb {
  client: SupabaseClient<Database>;
  favorites: () => FavRow[];
}

function rowKey(row: FavRow): string {
  return `${row.owner_kind}|${row.owner_key}|${row.photo_id}`;
}

function createFakeFavoritesDb(seed: {
  people?: string[];
  photos?: string[];
  favorites?: Array<Omit<FavRow, "created_at">>;
}): FakeFavoritesDb {
  const people = new Set(seed.people ?? []);
  const photos = new Set(seed.photos ?? []);
  let clock = 0;
  const stamp = () => `2026-07-22T00:00:${String((clock += 1)).padStart(2, "0")}Z`;
  let favorites: FavRow[] = (seed.favorites ?? []).map((row) => ({
    ...row,
    created_at: stamp(),
  }));

  function from(table: string) {
    if (table === "rachandzach_people") {
      return {
        select: () => ({
          eq: (_col: string, value: unknown) => ({
            maybeSingle: async () =>
              people.has(String(value))
                ? { data: { slug: value }, error: null }
                : { data: null, error: null },
          }),
        }),
      };
    }
    if (table === "rachandzach_photos") {
      return {
        select: () => ({
          in: (_col: string, ids: string[]) =>
            Promise.resolve({
              data: ids.filter((id) => photos.has(id)).map((id) => ({ id })),
              error: null,
            }),
        }),
      };
    }
    if (table === "rachandzach_guest_favorites") {
      const filters: Partial<Record<keyof FavRow, unknown>> = {};
      let photoIdSubset: string[] | null = null;

      const matching = () =>
        favorites.filter(
          (row) =>
            Object.entries(filters).every(
              ([col, value]) => row[col as keyof FavRow] === value,
            ) &&
            (photoIdSubset === null || photoIdSubset.includes(row.photo_id)),
        );

      let limitCount: number | null = null;
      const selectApi = {
        eq(col: keyof FavRow, value: unknown) {
          filters[col] = value;
          return selectApi;
        },
        order() {
          return selectApi;
        },
        limit(count: number) {
          limitCount = count;
          return selectApi;
        },
        then(
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          const rows = [...matching()].sort((a, b) =>
            a.created_at === b.created_at
              ? a.photo_id.localeCompare(b.photo_id)
              : a.created_at.localeCompare(b.created_at),
          );
          const sliced =
            limitCount === null ? rows : rows.slice(0, limitCount);
          return Promise.resolve({
            data: sliced.map(({ photo_id }) => ({ photo_id })),
            error: null,
          }).then(onFulfilled, onRejected);
        },
      };

      const deleteApi = {
        eq(col: keyof FavRow, value: unknown) {
          filters[col] = value;
          return deleteApi;
        },
        in(_col: string, values: string[]) {
          photoIdSubset = values;
          return deleteApi;
        },
        then(
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          const doomed = new Set(matching().map(rowKey));
          favorites = favorites.filter((row) => !doomed.has(rowKey(row)));
          return Promise.resolve({ data: null, error: null }).then(
            onFulfilled,
            onRejected,
          );
        },
      };

      return {
        select: () => selectApi,
        delete: () => deleteApi,
        upsert: (rows: Array<Omit<FavRow, "created_at">>) => {
          for (const row of rows) {
            const exists = favorites.some(
              (candidate) => rowKey(candidate) === rowKey({ ...row, created_at: "" }),
            );
            if (!exists) favorites.push({ ...row, created_at: stamp() });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    throw new Error(`fake favorites db: unexpected table ${table}`);
  }

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    favorites: () => [...favorites],
  };
}

// --- Helpers ---------------------------------------------------------------

const SESSION_ID = "3f2ee0a3-92d5-4a1a-9c40-2f4a1c8b7d10";
// Valid rachandzach_photos-shaped UUIDs.
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";
const P4 = "44444444-4444-4444-8444-444444444444";

function grantSession(sessionId = SESSION_ID): void {
  getGuestSessionMock.mockResolvedValue({
    sessionId,
    issuedAt: 0,
    expiresAt: 9999999999,
    version: 1,
  });
}

function getRequest(person?: string): NextRequest {
  const query = person ? `?person=${encodeURIComponent(person)}` : "";
  return new NextRequest(`https://gallery.test/api/favorites${query}`);
}

function putRequest(body: unknown): NextRequest {
  return new NextRequest("https://gallery.test/api/favorites", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  getGuestSessionMock.mockReset();
  createAdminClientMock.mockReset();
});

// --- Tests -----------------------------------------------------------------

describe("sanitizePhotoIds", () => {
  it("keeps only UUID-shaped strings, deduplicated, capped", () => {
    expect(
      sanitizePhotoIds([P1, "not-a-uuid", P1, 42, null, P2, ""]),
    ).toEqual([P1, P2]);
    const flood = Array.from({ length: FAVORITES_SYNC_MAX + 50 }, (_, i) =>
      `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
    );
    expect(sanitizePhotoIds(flood)).toHaveLength(FAVORITES_SYNC_MAX);
    expect(sanitizePhotoIds("nope")).toEqual([]);
  });
});

describe("GET /api/favorites", () => {
  it("does not turn an anonymous caller away", async () => {
    // No 401 left to assert: the password gate is gone and a caller with no
    // cookie is simply given a session id of their own. What still has to
    // hold is that the id comes from the server, never the request.
    getGuestSessionMock.mockResolvedValue({
      sessionId: "fresh-anonymous-session",
      issuedAt: 0,
      expiresAt: 0,
      version: 1,
    });
    createAdminClientMock.mockReturnValue(
      createFakeFavoritesDb({ photos: [] }).client,
    );
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ownerKind: "session",
      photoIds: [],
    });
  });

  it("maps storage failures to 500", async () => {
    grantSession();
    createAdminClientMock.mockImplementation(() => {
      throw new GalleryAccessConfigError("secret missing");
    });
    const response = await GET(getRequest());
    expect(response.status).toBe(500);
  });

  it("lists the caller's session-keyed favorites, derived from the verified session", async () => {
    grantSession();
    const db = createFakeFavoritesDb({
      photos: [P1, P2],
      favorites: [
        { owner_kind: "session", owner_key: SESSION_ID, photo_id: P1 },
        { owner_kind: "session", owner_key: "someone-else", photo_id: P2 },
      ],
    });
    createAdminClientMock.mockReturnValue(db.client);

    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ownerKind: "session",
      photoIds: [P1],
    });
  });

  it("keys by person when the supplied slug matches a real person", async () => {
    grantSession();
    const db = createFakeFavoritesDb({
      people: ["rach"],
      photos: [P1, P2],
      favorites: [
        { owner_kind: "person", owner_key: "rach", photo_id: P2 },
        { owner_kind: "session", owner_key: SESSION_ID, photo_id: P1 },
      ],
    });
    createAdminClientMock.mockReturnValue(db.client);

    const response = await GET(getRequest("rach"));
    expect(await response.json()).toEqual({
      ownerKind: "person",
      photoIds: [P2],
    });
  });

  it("falls back to session keying for an unknown or malformed person slug", async () => {
    grantSession();
    const db = createFakeFavoritesDb({
      people: ["rach"],
      photos: [P1],
      favorites: [
        { owner_kind: "session", owner_key: SESSION_ID, photo_id: P1 },
      ],
    });
    createAdminClientMock.mockReturnValue(db.client);

    for (const bogus of ["not-a-person", "Rach!", "-leading-hyphen"]) {
      const response = await GET(getRequest(bogus));
      expect(await response.json()).toEqual({
        ownerKind: "session",
        photoIds: [P1],
      });
    }
  });

  it("keeps a shortlist reachable for a slug whose catalog row is gone", async () => {
    // Orphan recovery: person-keyed rows anchor their own reachability, so
    // an identity deletion that interleaved with a favorite write (the
    // favorites table has no FK to rachandzach_people) can never strand a
    // guest's shortlist. Note the slug is absent from `people`.
    grantSession();
    const db = createFakeFavoritesDb({
      people: [],
      photos: [P1, P2],
      favorites: [
        { owner_kind: "person", owner_key: "aunt-carol", photo_id: P2 },
        { owner_kind: "session", owner_key: SESSION_ID, photo_id: P1 },
      ],
    });
    createAdminClientMock.mockReturnValue(db.client);

    const response = await GET(getRequest("aunt-carol"));
    expect(await response.json()).toEqual({
      ownerKind: "person",
      photoIds: [P2],
    });
  });
});

describe("PUT /api/favorites", () => {
  it("rejects malformed bodies", async () => {
    grantSession();
    createAdminClientMock.mockReturnValue(
      createFakeFavoritesDb({}).client,
    );
    expect((await PUT(putRequest("{not json"))).status).toBe(400);
    expect((await PUT(putRequest({ photoIds: "nope" }))).status).toBe(400);
    expect((await PUT(putRequest({}))).status).toBe(400);
  });

  it("replaces the session row set: inserts additions, deletes removals, drops unknown photos", async () => {
    grantSession();
    const db = createFakeFavoritesDb({
      photos: [P1, P2, P3],
      favorites: [
        { owner_kind: "session", owner_key: SESSION_ID, photo_id: P1 },
        { owner_kind: "session", owner_key: SESSION_ID, photo_id: P2 },
        { owner_kind: "session", owner_key: "someone-else", photo_id: P2 },
      ],
    });
    createAdminClientMock.mockReturnValue(db.client);

    // Keep P2, drop P1, add P3, and try to add P4 (not a real photo).
    const response = await PUT(putRequest({ photoIds: [P2, P3, P4] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ownerKind: "session",
      photoIds: [P2, P3],
    });

    const mine = db
      .favorites()
      .filter((row) => row.owner_key === SESSION_ID)
      .map((row) => row.photo_id)
      .sort();
    expect(mine).toEqual([P2, P3].sort());
    // Another owner's identical photo id is untouched by my replace.
    expect(
      db.favorites().some((row) => row.owner_key === "someone-else"),
    ).toBe(true);
  });

  it("replaces person-keyed rows when a valid person slug rides along", async () => {
    grantSession();
    const db = createFakeFavoritesDb({
      people: ["zach"],
      photos: [P1, P2],
    });
    createAdminClientMock.mockReturnValue(db.client);

    const response = await PUT(putRequest({ person: "zach", photoIds: [P1, P2] }));
    expect(await response.json()).toEqual({
      ownerKind: "person",
      photoIds: [P1, P2],
    });
    expect(
      db.favorites().every((row) => row.owner_kind === "person" && row.owner_key === "zach"),
    ).toBe(true);
  });

  it("migrateFromSession unions session rows into the person key and deletes them", async () => {
    grantSession();
    const db = createFakeFavoritesDb({
      people: ["zach"],
      photos: [P1, P2, P3],
      favorites: [
        // Collected anonymously before picking a person:
        { owner_kind: "session", owner_key: SESSION_ID, photo_id: P1 },
        // Already on the person key (e.g. from another device):
        { owner_kind: "person", owner_key: "zach", photo_id: P2 },
      ],
    });
    createAdminClientMock.mockReturnValue(db.client);

    const response = await PUT(
      putRequest({
        person: "zach",
        migrateFromSession: true,
        photoIds: [P1, P3], // local list: the session heart plus a fresh one
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ownerKind: string;
      photoIds: string[];
    };
    expect(body.ownerKind).toBe("person");
    expect([...body.photoIds].sort()).toEqual([P1, P2, P3].sort());

    // Union, not replace: the pre-existing person row survived.
    const personRows = db
      .favorites()
      .filter((row) => row.owner_kind === "person" && row.owner_key === "zach")
      .map((row) => row.photo_id)
      .sort();
    expect(personRows).toEqual([P1, P2, P3].sort());
    // The session rows are gone.
    expect(
      db.favorites().some((row) => row.owner_kind === "session"),
    ).toBe(false);
  });

  it("migrateFromSession with an invalid person degrades to a session-keyed replace", async () => {
    grantSession();
    const db = createFakeFavoritesDb({
      photos: [P1],
      favorites: [
        { owner_kind: "session", owner_key: SESSION_ID, photo_id: P1 },
      ],
    });
    createAdminClientMock.mockReturnValue(db.client);

    const response = await PUT(
      putRequest({
        person: "nobody-here",
        migrateFromSession: true,
        photoIds: [P1],
      }),
    );
    expect(await response.json()).toEqual({
      ownerKind: "session",
      photoIds: [P1],
    });
    expect(
      db.favorites().every((row) => row.owner_kind === "session"),
    ).toBe(true);
  });

  it("never adopts a session id from the request; the cookie session wins", async () => {
    grantSession(SESSION_ID);
    const db = createFakeFavoritesDb({ photos: [P1] });
    createAdminClientMock.mockReturnValue(db.client);

    // A hostile body naming someone else's session id has no field to land
    // in: sessionId is not part of the contract, and person only matches
    // rachandzach_people slugs (a session UUID is not one).
    const response = await PUT(
      putRequest({
        photoIds: [P1],
        sessionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        person: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      }),
    );
    expect(await response.json()).toEqual({
      ownerKind: "session",
      photoIds: [P1],
    });
    expect(
      db.favorites().every((row) => row.owner_key === SESSION_ID),
    ).toBe(true);
  });
});
