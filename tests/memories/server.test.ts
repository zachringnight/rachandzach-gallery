/**
 * Unit tests for the pure memories server logic
 * (src/lib/memories/server.ts): validation bounds (mirrored by the Postgres
 * check constraints and the composer's maxLength), owner derivation, and
 * the deterministic approved-only listing. The route suites cover the same
 * functions end to end; these pin the edges directly.
 */
import { describe, expect, it } from "vitest";
import {
  MEMORY_BODY_MAX_LENGTH,
  MEMORY_DISPLAY_NAME_MAX_LENGTH,
  MemoryValidationError,
  listApprovedMemories,
  normalizeMemoryBody,
  normalizeMemoryDisplayName,
  normalizeMemoryId,
  normalizePhotoId,
  resolveMemoryOwner,
  reviewMemory,
} from "@/lib/memories/server";
import { createFakeMemoriesDb } from "./fake-memories-db";

const PHOTO = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "3f2ee0a3-92d5-4a1a-9c40-2f4a1c8b7d10";

describe("normalizeMemoryBody", () => {
  it("trims and strips NUL characters", () => {
    expect(normalizeMemoryBody("  such a night \u0000 ")).toBe("such a night");
  });

  it("accepts exactly the maximum length", () => {
    expect(normalizeMemoryBody("x".repeat(MEMORY_BODY_MAX_LENGTH))).toHaveLength(
      MEMORY_BODY_MAX_LENGTH,
    );
  });

  it("rejects non-strings, blanks, and over-length bodies", () => {
    for (const bad of [undefined, null, 42, "", "   ", "x".repeat(501)]) {
      expect(() => normalizeMemoryBody(bad)).toThrow(MemoryValidationError);
    }
  });
});

describe("normalizeMemoryDisplayName", () => {
  it("treats missing and blank as anonymous", () => {
    expect(normalizeMemoryDisplayName(undefined)).toBeNull();
    expect(normalizeMemoryDisplayName(null)).toBeNull();
    expect(normalizeMemoryDisplayName("   ")).toBeNull();
  });

  it("trims a real name and accepts exactly the maximum length", () => {
    expect(normalizeMemoryDisplayName("  Sarah  ")).toBe("Sarah");
    expect(
      normalizeMemoryDisplayName("n".repeat(MEMORY_DISPLAY_NAME_MAX_LENGTH)),
    ).toHaveLength(MEMORY_DISPLAY_NAME_MAX_LENGTH);
  });

  it("rejects non-strings and over-length names", () => {
    expect(() => normalizeMemoryDisplayName(42)).toThrow(MemoryValidationError);
    expect(() => normalizeMemoryDisplayName("n".repeat(81))).toThrow(
      MemoryValidationError,
    );
  });
});

describe("id validation", () => {
  it("accepts UUID shapes and rejects everything else with a 400", () => {
    expect(normalizePhotoId(PHOTO)).toBe(PHOTO);
    expect(normalizeMemoryId(PHOTO)).toBe(PHOTO);
    for (const bad of [undefined, "", "abc", `${PHOTO} `, 42]) {
      for (const normalize of [normalizePhotoId, normalizeMemoryId]) {
        try {
          normalize(bad);
          expect.unreachable("expected a validation error");
        } catch (error) {
          expect(error).toBeInstanceOf(MemoryValidationError);
          expect((error as MemoryValidationError).status).toBe(400);
        }
      }
    }
  });
});

describe("resolveMemoryOwner", () => {
  it("keys by person only for a real slug; everything else is the session", async () => {
    const db = createFakeMemoriesDb({ people: ["rach"] });
    expect(await resolveMemoryOwner(db.client, SESSION_ID, "rach")).toEqual({
      kind: "person",
      key: "rach",
    });
    for (const bogus of ["zach-not-seeded", "Rach!", "-leading", 42, null]) {
      expect(await resolveMemoryOwner(db.client, SESSION_ID, bogus)).toEqual({
        kind: "session",
        key: SESSION_ID,
      });
    }
  });
});

describe("listApprovedMemories", () => {
  it("orders deterministically and stays inside one photo's approved set", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const db = createFakeMemoriesDb({
      photos: [
        { id: PHOTO, status: "published" },
        { id: other, status: "published" },
      ],
      memories: [
        { photo_id: PHOTO, body: "first", status: "approved" },
        { photo_id: PHOTO, body: "second", status: "approved" },
        { photo_id: PHOTO, body: "hidden work", status: "pending" },
        { photo_id: other, body: "someone else's photo", status: "approved" },
      ],
    });
    const memories = await listApprovedMemories(db.client, PHOTO);
    expect(memories.map((memory) => memory.body)).toEqual(["first", "second"]);
  });

  it("returns an empty wall for photos that are not guest-visible", async () => {
    const db = createFakeMemoriesDb({
      photos: [{ id: PHOTO, status: "hidden" }],
      memories: [{ photo_id: PHOTO, body: "invisible", status: "approved" }],
    });
    expect(await listApprovedMemories(db.client, PHOTO)).toEqual([]);
  });
});

describe("reviewMemory", () => {
  it("stamps the supplied reviewed_at and surfaces unknown ids as 404", async () => {
    const db = createFakeMemoriesDb({
      photos: [{ id: PHOTO, status: "published" }],
      memories: [{ photo_id: PHOTO, body: "decide me", status: "pending" }],
    });
    const target = db.rows()[0];
    const reviewedAt = "2026-07-23T12:00:00.000Z";
    const result = await reviewMemory(
      db.client,
      target.id,
      "approved",
      reviewedAt,
    );
    expect(result).toEqual({ id: target.id, status: "approved" });
    expect(db.rows()[0].reviewed_at).toBe(reviewedAt);

    try {
      await reviewMemory(
        db.client,
        "88888888-8888-4888-8888-888888888888",
        "rejected",
      );
      expect.unreachable("expected a 404-shaped validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryValidationError);
      expect((error as MemoryValidationError).status).toBe(404);
    }
  });
});
