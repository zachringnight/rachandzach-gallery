/**
 * Upload contract tests (packet 08).
 *
 * Covers the binding validation rules with real fixture bytes: allowed
 * formats, extension checks, magic-byte sniffing, size, batch count, malformed
 * batch metadata, receipt-token hashing, server-issued object paths, the TUS
 * endpoint derivation, batch-state resolution (including expired receipts), and
 * the signed-upload target flow against a mocked Supabase client. No live
 * database or storage is touched.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  GUEST_PENDING_BUCKET,
  MAX_FILE_BYTES,
  MAX_FILES_PER_BATCH,
  UPLOAD_BATCH_TTL_SECONDS,
  UPLOAD_TUS_CHUNK_SIZE,
  UploadValidationError,
  generateReceiptToken,
  hashReceiptToken,
  isUuid,
  parseCreateUploadBatchInput,
  resolveBatchState,
  resolveTusEndpoint,
  summarizeItemCounts,
} from "@/lib/uploads/contracts";
import {
  buildPendingObjectPath,
  generateObjectNonce,
  normalizeDisplayFilename,
  sniffImage,
  validateUploadFile,
} from "@/lib/uploads/validate-upload";
import { createSignedUploadTarget } from "@/lib/uploads/sign-upload";

// --- Fixture helpers -------------------------------------------------------

function fixture(name: string): Buffer {
  return readFileSync(
    fileURLToPath(new URL(`../fixtures/shared/${name}`, import.meta.url)),
  );
}

function head(name: string, n = 32): Uint8Array {
  return new Uint8Array(fixture(name).subarray(0, n));
}

const UUID_A = "11111111-2222-4333-8444-555555555555";
const UUID_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NONCE = "0123456789abcdef0123456789abcdef";

// --- Magic-byte sniffing ---------------------------------------------------

describe("sniffImage", () => {
  it("detects each allowed raster format from real bytes", () => {
    expect(sniffImage(head("synthetic-1-tiny.jpg"))).toBe("jpeg");
    expect(sniffImage(head("synthetic-2-tiny.png"))).toBe("png");
    expect(sniffImage(head("synthetic-3-tiny.webp"))).toBe("webp");
    expect(sniffImage(head("synthetic-4.heic"))).toBe("heic");
  });

  it("returns unknown for text renamed to .jpg and for SVG", () => {
    expect(sniffImage(head("fake.jpg"))).toBe("unknown");
    expect(sniffImage(head("tiny-svg.svg"))).toBe("unknown");
  });

  it("still sniffs a truncated JPEG as jpeg (magic-byte scope only)", () => {
    // Deep-decode validation is deferred to packet 10; the header is valid.
    expect(sniffImage(head("truncated.jpg"))).toBe("jpeg");
  });
});

// --- Per-file validation ---------------------------------------------------

describe("validateUploadFile", () => {
  it("accepts each allowed format when declared type and bytes agree", () => {
    const jpeg = validateUploadFile({
      filename: "grace.jpg",
      declaredType: "image/jpeg",
      bytes: 707,
      head: head("synthetic-1-tiny.jpg"),
    });
    expect(jpeg).toMatchObject({ ok: true, mediaType: "image/jpeg" });

    expect(
      validateUploadFile({
        filename: "grace.png",
        declaredType: "image/png",
        bytes: 640,
        head: head("synthetic-2-tiny.png"),
      }),
    ).toMatchObject({ ok: true, mediaType: "image/png" });

    expect(
      validateUploadFile({
        filename: "grace.webp",
        declaredType: "image/webp",
        bytes: 206,
        head: head("synthetic-3-tiny.webp"),
      }),
    ).toMatchObject({ ok: true, mediaType: "image/webp" });

    expect(
      validateUploadFile({
        filename: "grace.heic",
        declaredType: "image/heic",
        bytes: 3957,
        head: head("synthetic-4.heic"),
      }),
    ).toMatchObject({ ok: true, mediaType: "image/heic" });
  });

  it("accepts a .heif extension mapped to image/heic", () => {
    expect(
      validateUploadFile({
        filename: "burst.heif",
        declaredType: "image/heic",
        bytes: 3957,
        head: head("synthetic-4.heic"),
      }),
    ).toMatchObject({ ok: true, mediaType: "image/heic" });
  });

  it("rejects SVG by extension", () => {
    expect(
      validateUploadFile({
        filename: "logo.svg",
        declaredType: "image/svg+xml",
        bytes: 115,
        head: head("tiny-svg.svg"),
      }),
    ).toEqual({ ok: false, reason: "unsupported-extension" });
  });

  it("rejects a disallowed declared type even with an allowed extension", () => {
    expect(
      validateUploadFile({
        filename: "logo.jpg",
        declaredType: "image/svg+xml",
        bytes: 115,
        head: head("tiny-svg.svg"),
      }),
    ).toEqual({ ok: false, reason: "unsupported-type" });
  });

  it("rejects an executable by extension", () => {
    expect(
      validateUploadFile({
        filename: "payload.exe",
        declaredType: "application/octet-stream",
        bytes: 4096,
        head: head("synthetic-1-tiny.jpg"),
      }),
    ).toEqual({ ok: false, reason: "unsupported-extension" });
  });

  it("rejects text bytes wearing a .jpg name (magic-byte mismatch)", () => {
    expect(
      validateUploadFile({
        filename: "fake.jpg",
        declaredType: "image/jpeg",
        bytes: 97,
        head: head("fake.jpg"),
      }),
    ).toEqual({ ok: false, reason: "magic-byte-mismatch" });
  });

  it("rejects real HEIC bytes declared as JPEG (declared/actual mismatch)", () => {
    expect(
      validateUploadFile({
        filename: "iphone.jpg",
        declaredType: "image/jpeg",
        bytes: 3957,
        head: head("synthetic-4.heic"),
      }),
    ).toEqual({ ok: false, reason: "declared-type-mismatch" });
  });

  it("rejects empty and oversized files", () => {
    expect(
      validateUploadFile({
        filename: "empty.jpg",
        declaredType: "image/jpeg",
        bytes: 0,
        head: head("synthetic-1-tiny.jpg"),
      }),
    ).toEqual({ ok: false, reason: "empty-file" });

    expect(
      validateUploadFile({
        filename: "huge.jpg",
        declaredType: "image/jpeg",
        bytes: MAX_FILE_BYTES + 1,
        head: head("synthetic-1-tiny.jpg"),
      }),
    ).toEqual({ ok: false, reason: "file-too-large" });
  });

  it("accepts a file exactly at the size limit", () => {
    expect(
      validateUploadFile({
        filename: "atlimit.jpg",
        declaredType: "image/jpeg",
        bytes: MAX_FILE_BYTES,
        head: head("synthetic-1-tiny.jpg"),
      }),
    ).toMatchObject({ ok: true });
  });
});

// --- Display filename normalization ---------------------------------------

describe("normalizeDisplayFilename", () => {
  it("strips any path component so a filename can never be an object path", () => {
    expect(normalizeDisplayFilename("../../etc/passwd")).toBe("passwd");
    expect(normalizeDisplayFilename("C:\\Users\\me\\pic.jpg")).toBe("pic.jpg");
  });

  it("trims, drops leading dots, and never returns empty", () => {
    expect(normalizeDisplayFilename("  spaced.jpg  ")).toBe("spaced.jpg");
    expect(normalizeDisplayFilename("...hidden.png")).toBe("hidden.png");
    expect(normalizeDisplayFilename("/")).toBe("photo");
  });
});

// --- Batch metadata parsing ------------------------------------------------

describe("parseCreateUploadBatchInput", () => {
  it("accepts a fully specified batch", () => {
    const result = parseCreateUploadBatchInput({
      displayName: "Grace Kelly",
      email: "grace@example.com",
      note: "From the ceremony",
      itemCount: 3,
    });
    expect(result.ok).toBe(true);
  });

  it("coerces empty strings and undefined to null", () => {
    const result = parseCreateUploadBatchInput({
      displayName: "",
      email: "",
      note: "",
      itemCount: 2,
    });
    expect(result).toEqual({
      ok: true,
      value: { displayName: null, email: null, note: null, itemCount: 2 },
    });
  });

  it("accepts explicit nulls", () => {
    expect(
      parseCreateUploadBatchInput({
        displayName: null,
        email: null,
        note: null,
        itemCount: 1,
      }).ok,
    ).toBe(true);
  });

  it("enforces the batch size window [1, 50]", () => {
    expect(parseCreateUploadBatchInput({ displayName: null, email: null, note: null, itemCount: 0 }).ok).toBe(false);
    expect(parseCreateUploadBatchInput({ displayName: null, email: null, note: null, itemCount: MAX_FILES_PER_BATCH }).ok).toBe(true);
    expect(parseCreateUploadBatchInput({ displayName: null, email: null, note: null, itemCount: MAX_FILES_PER_BATCH + 1 }).ok).toBe(false);
  });

  it("rejects non-integer and non-numeric counts", () => {
    expect(parseCreateUploadBatchInput({ displayName: null, email: null, note: null, itemCount: 2.5 }).ok).toBe(false);
    expect(parseCreateUploadBatchInput({ displayName: null, email: null, note: null, itemCount: "3" }).ok).toBe(false);
    expect(parseCreateUploadBatchInput({ displayName: null, email: null, note: null }).ok).toBe(false);
  });

  it("rejects malformed email, over-long note, and over-long name", () => {
    expect(parseCreateUploadBatchInput({ displayName: null, email: "not-an-email", note: null, itemCount: 1 }).ok).toBe(false);
    expect(parseCreateUploadBatchInput({ displayName: null, email: null, note: "x".repeat(2001), itemCount: 1 }).ok).toBe(false);
    expect(parseCreateUploadBatchInput({ displayName: "y".repeat(121), email: null, note: null, itemCount: 1 }).ok).toBe(false);
  });
});

// --- Receipt tokens --------------------------------------------------------

describe("receipt tokens", () => {
  it("mints opaque tokens and stores only a one-way hash", async () => {
    const token = generateReceiptToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(20);

    const hash = await hashReceiptToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Satisfies the DB receipt_hash check ^[0-9a-f]{32,64}$.
    expect(hash).not.toBe(token);
  });

  it("is deterministic per token and distinct across tokens", async () => {
    const token = generateReceiptToken();
    expect(await hashReceiptToken(token)).toBe(await hashReceiptToken(token));
    expect(await hashReceiptToken(generateReceiptToken())).not.toBe(
      await hashReceiptToken(generateReceiptToken()),
    );
  });
});

// --- Object paths ----------------------------------------------------------

describe("server-issued object paths", () => {
  it("builds pending/{batchId}/{itemId}/{nonce}", () => {
    expect(buildPendingObjectPath(UUID_A, UUID_B, NONCE)).toBe(
      `pending/${UUID_A}/${UUID_B}/${NONCE}`,
    );
  });

  it("rejects non-UUID components and bad nonces", () => {
    expect(() => buildPendingObjectPath("not-a-uuid", UUID_B, NONCE)).toThrow();
    expect(() => buildPendingObjectPath(UUID_A, UUID_B, "short")).toThrow();
    expect(() => buildPendingObjectPath(UUID_A, UUID_B, "../escape")).toThrow();
  });

  it("generates 32-hex nonces", () => {
    expect(generateObjectNonce()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateObjectNonce()).not.toBe(generateObjectNonce());
  });
});

// --- TUS endpoint ----------------------------------------------------------

describe("resolveTusEndpoint", () => {
  it("rewrites a hosted project URL to the direct storage host", () => {
    expect(resolveTusEndpoint("https://abcdef123.supabase.co")).toBe(
      "https://abcdef123.storage.supabase.co/storage/v1/upload/resumable/sign",
    );
  });

  it("appends the sign path to a local stack URL as-is", () => {
    expect(resolveTusEndpoint("http://127.0.0.1:54321")).toBe(
      "http://127.0.0.1:54321/storage/v1/upload/resumable/sign",
    );
  });

  it("trims trailing slashes", () => {
    expect(resolveTusEndpoint("http://127.0.0.1:54321/")).toBe(
      "http://127.0.0.1:54321/storage/v1/upload/resumable/sign",
    );
  });
});

// --- Batch state -----------------------------------------------------------

describe("resolveBatchState", () => {
  const now = Date.UTC(2026, 6, 22, 12, 0, 0);

  it("distinguishes draft, uploading, and expired", () => {
    expect(resolveBatchState("draft", 0, now, now)).toBe("draft");
    expect(resolveBatchState("draft", 3, now, now)).toBe("uploading");
    const old = now - (UPLOAD_BATCH_TTL_SECONDS + 60) * 1000;
    expect(resolveBatchState("draft", 0, old, now)).toBe("expired");
  });

  it("maps terminal database statuses", () => {
    expect(resolveBatchState("submitted", 5, now, now)).toBe("submitted");
    expect(resolveBatchState("under_review", 5, now, now)).toBe("submitted");
    expect(resolveBatchState("approved", 5, now, now)).toBe("approved");
    expect(resolveBatchState("partially_approved", 5, now, now)).toBe("partially_approved");
    expect(resolveBatchState("rejected", 5, now, now)).toBe("rejected");
  });
});

describe("summarizeItemCounts", () => {
  it("tallies items by status", () => {
    expect(
      summarizeItemCounts([
        { status: "pending" },
        { status: "pending" },
        { status: "approved" },
        { status: "rejected" },
        { status: "removed" },
      ]),
    ).toEqual({ total: 5, pending: 2, approved: 1, rejected: 1, removed: 1 });
  });
});

// --- Constants -------------------------------------------------------------

describe("pinned constants", () => {
  it("hold the spec-required values", () => {
    expect(UPLOAD_TUS_CHUNK_SIZE).toBe(6 * 1024 * 1024);
    expect(MAX_FILES_PER_BATCH).toBe(50);
    expect(MAX_FILE_BYTES).toBe(52_428_800);
    expect(GUEST_PENDING_BUCKET).toBe("rachandzach-guest-pending");
    expect(ALLOWED_UPLOAD_MIME_TYPES).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
    ]);
  });
});

// --- Signed upload target (mocked Supabase client) -------------------------

interface CapturedInsert {
  table: string;
  row: Record<string, unknown>;
}

function mockSignClient(token: string) {
  const inserts: CapturedInsert[] = [];
  const signCalls: string[] = [];
  const client = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
    storage: {
      from(_bucket: string) {
        return {
          createSignedUploadUrl(path: string) {
            signCalls.push(path);
            return Promise.resolve({
              data: { signedUrl: `https://storage.test/${path}`, token, path },
              error: null,
            });
          },
        };
      },
    },
  } as unknown as SupabaseClient<Database>;
  return { client, inserts, signCalls };
}

describe("createSignedUploadTarget", () => {
  it("creates the item row before minting the token and returns a server-issued path", async () => {
    const { client, inserts, signCalls } = mockSignClient("signed-token-xyz");
    const target = await createSignedUploadTarget(
      UUID_A,
      {
        originalName: "../../evil/IMG_2201.HEIC".replace(".HEIC", ".heic"),
        mediaType: "image/heic",
        bytes: 1_500_000,
        sha256: null,
      },
      { client, supabaseUrl: "https://proj123.supabase.co" },
    );

    expect(target.objectPath).toMatch(
      /^pending\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{32}$/,
    );
    expect(target.objectPath.startsWith(`pending/${UUID_A}/${target.itemId}/`)).toBe(true);
    expect(isUuid(target.itemId)).toBe(true);
    expect(target.signedToken).toBe("signed-token-xyz");
    expect(target.tusEndpoint).toBe(
      "https://proj123.storage.supabase.co/storage/v1/upload/resumable/sign",
    );
    expect(Date.parse(target.expiresAt)).toBeGreaterThan(Date.now());

    // Item row was inserted first, at the exact server-issued path, with a
    // normalized display name (never the path-bearing original).
    expect(inserts).toHaveLength(1);
    const row = inserts[0].row;
    expect(inserts[0].table).toBe("rachandzach_upload_items");
    expect(row.object_path).toBe(target.objectPath);
    expect(row.id).toBe(target.itemId);
    expect(row.media_type).toBe("image/heic");
    expect(row.original_name).toBe("IMG_2201.heic");
    expect(row.status).toBe("pending");
    // The signing call used the same path the row records.
    expect(signCalls).toEqual([target.objectPath]);
  });

  it("rejects an invalid batch id before any write", async () => {
    const { client, inserts } = mockSignClient("t");
    await expect(
      createSignedUploadTarget(
        "not-a-uuid",
        { originalName: "a.jpg", mediaType: "image/jpeg", bytes: 10 },
        { client, supabaseUrl: "http://127.0.0.1:54321" },
      ),
    ).rejects.toBeInstanceOf(UploadValidationError);
    expect(inserts).toHaveLength(0);
  });

  it("rejects an oversized declared size before any write", async () => {
    const { client, inserts } = mockSignClient("t");
    await expect(
      createSignedUploadTarget(
        UUID_A,
        { originalName: "a.jpg", mediaType: "image/jpeg", bytes: MAX_FILE_BYTES + 1 },
        { client, supabaseUrl: "http://127.0.0.1:54321" },
      ),
    ).rejects.toBeInstanceOf(UploadValidationError);
    expect(inserts).toHaveLength(0);
  });
});
