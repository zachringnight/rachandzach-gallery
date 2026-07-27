/**
 * Original-download integrity test (packet 09).
 *
 * Proves the exact check a real signed-URL download must satisfy: bytes
 * fetched for a photo hash to that photo's GalleryPhotoRecord.fileSha256.
 * Uses ONLY the shared local fixtures (tests/fixtures/shared) -- no network,
 * no Supabase, and the real archive at
 * "/Users/zsoskin/Rachel & Zach - Wedding Master Clean" is never
 * touched. "Downloading" a fixture here means reading its bytes from disk,
 * standing in for what a signed-URL fetch would return: the manifest never
 * resizes/recompresses/rewrites originals, so a real download's bytes are
 * exactly the source bytes on disk, which is what this test hashes.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/downloads/contracts";
import type { GalleryPhotoRecord } from "@/types/gallery";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "shared",
);

interface ManifestEntry {
  file: string;
  bytes: number;
  sha256: string;
  valid_image: boolean;
}

interface Manifest {
  files: ManifestEntry[];
}

const manifest: Manifest = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "manifest.json"), "utf8"),
);

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

function manifestEntry(file: string): ManifestEntry {
  const entry = manifest.files.find((candidate) => candidate.file === file);
  if (!entry) {
    throw new Error(`Fixture manifest is missing an entry for "${file}".`);
  }
  return entry;
}

/** A minimal fixture GalleryPhotoRecord standing in for a real synced catalog
 *  row, with fileSha256 sourced from the fixture manifest's known-good hash. */
function buildRecord(
  file: string,
  overrides: Partial<GalleryPhotoRecord> = {},
): GalleryPhotoRecord {
  const entry = manifestEntry(file);
  return {
    id: "fixture-photo-1",
    imageDataHash: "fixture-image-data-hash",
    fileSha256: entry.sha256,
    originalRelativePath: `01 Ceremony/${file}`,
    originalFilename: file,
    originalBytes: entry.bytes,
    width: 100,
    height: 100,
    orientation: "landscape",
    eventSlug: "ceremony",
    capturedAt: null,
    peopleSlugs: [],
    keywords: [],
    previewObjects: [],
    source: "photographer",
    status: "approved",
    ...overrides,
  };
}

describe("original download integrity", () => {
  it("hashes downloaded fixture bytes to the catalog record's fileSha256", async () => {
    const record = buildRecord("synthetic-1-phone.jpg");
    const downloaded = readFixture("synthetic-1-phone.jpg");
    expect(await sha256Hex(downloaded)).toBe(record.fileSha256);
  });

  it("matches for every fixture in the shared pack, cross-checking the manifest itself", async () => {
    for (const entry of manifest.files) {
      const record = buildRecord(entry.file);
      const downloaded = readFixture(entry.file);
      expect(await sha256Hex(downloaded)).toBe(record.fileSha256);
    }
  });

  it("also verifies the guest-source (HEIC) upload path, not just photographer JPEGs", async () => {
    const record = buildRecord("synthetic-4.heic", {
      source: "guest",
      originalFilename: "synthetic-4.heic",
    });
    const downloaded = readFixture("synthetic-4.heic");
    expect(await sha256Hex(downloaded)).toBe(record.fileSha256);
  });

  it("catches a substituted download: the wrong file never satisfies the record's hash", async () => {
    const record = buildRecord("synthetic-1-phone.jpg");
    const wrongBytes = readFixture("synthetic-2-phone.png");
    expect(await sha256Hex(wrongBytes)).not.toBe(record.fileSha256);
  });

  it("catches single-byte corruption of an otherwise-correct download", async () => {
    const record = buildRecord("synthetic-1-tiny.jpg");
    const downloaded = readFixture("synthetic-1-tiny.jpg");
    const corrupted = new Uint8Array(downloaded);
    corrupted[0] = corrupted[0] ^ 0xff;
    expect(await sha256Hex(corrupted)).not.toBe(record.fileSha256);
  });

  it("catches a truncated download (partial transfer)", async () => {
    const record = buildRecord("synthetic-1-phone.jpg");
    const truncated = readFixture("synthetic-1-phone.jpg").slice(0, -1);
    expect(await sha256Hex(truncated)).not.toBe(record.fileSha256);
  });

  it("produces a lowercase 64-character hex digest", async () => {
    const digest = await sha256Hex(readFixture("synthetic-3-tiny.webp"));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across repeated hashing of the same bytes", async () => {
    const bytes = readFixture("synthetic-2-tiny.png");
    expect(await sha256Hex(bytes)).toBe(await sha256Hex(bytes));
  });
});
