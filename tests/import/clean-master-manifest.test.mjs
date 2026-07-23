import { promises as fs } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadCleanMasterManifest,
  parseCsv,
  EVENT_ORDER,
  EXCLUDED_DIRECTORIES
} from "../../scripts/lib/clean-master-manifest.mjs";
import {
  buildManifestFixture,
  sha256File,
  snapshotStats,
  HASH_A,
  HASH_B,
  HASH_C,
  HASH_G,
  HASH_R
} from "./fixtures.mjs";

let fixture;
let catalog;
let statsBefore;
let statsAfter;

beforeAll(async () => {
  fixture = await buildManifestFixture();
  statsBefore = await snapshotStats(fixture.root);
  catalog = await loadCleanMasterManifest(fixture.root);
  statsAfter = await snapshotStats(fixture.root);
}, 60000);

afterAll(async () => {
  if (fixture) {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

describe("parseCsv", () => {
  it("keeps quoted fields containing commas intact", () => {
    const rows = parseCsv('a,"Bond, Lauren; Rachel",c\nd,e,f\n');
    expect(rows).toEqual([
      ["a", "Bond, Lauren; Rachel", "c"],
      ["d", "e", "f"]
    ]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    const rows = parseCsv('x,"He said ""hi""",z\n');
    expect(rows).toEqual([["x", 'He said "hi"', "z"]]);
  });
});

describe("loadCleanMasterManifest", () => {
  it("imports exactly the valid manifest rows", () => {
    expect(catalog.photos).toHaveLength(5);
    expect(catalog.photos.map((photo) => photo.imageDataHash)).toEqual([
      HASH_A,
      HASH_B,
      HASH_R,
      HASH_C,
      HASH_G
    ]);
    expect(catalog.stats.manifestRows).toBe(12);
    expect(catalog.stats.importedPhotos).toBe(5);
    expect(catalog.stats.rejectedRows).toBe(7);
  });

  it("uses imageDataHash as the stable photo id, unique across the catalog", () => {
    const ids = catalog.photos.map((photo) => photo.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const photo of catalog.photos) {
      expect(photo.id).toBe(photo.imageDataHash);
    }
  });

  it("rejects the duplicate imageDataHash row and reports it", () => {
    const issue = catalog.stats.issues.find((entry) => entry.type === "duplicate_hash");
    expect(issue).toBeDefined();
    expect(issue.path).toBe("02 Dancing/dancing-5.jpg");
    expect(issue.imageDataHash).toBe(HASH_A);
    expect(
      catalog.photos.filter((photo) => photo.imageDataHash === HASH_A).map((p) => p.originalRelativePath)
    ).toEqual(["01 Ceremony/ceremony-1.jpg"]);
  });

  it("reports missing files, bad dimensions, bad hashes, size mismatches, and shifted rows", () => {
    const types = catalog.stats.issues.map((issue) => issue.type).sort();
    expect(types).toEqual([
      "bad_dimensions",
      "bad_hash",
      "bad_row",
      "duplicate_hash",
      "excluded_path",
      "missing_file",
      "size_mismatch"
    ]);
    const missing = catalog.stats.issues.find((issue) => issue.type === "missing_file");
    expect(missing.path).toBe("01 Ceremony/ceremony-404.jpg");
  });

  it("rejects a row whose column count differs from the header, naming its line", () => {
    const badRow = catalog.stats.issues.find((issue) => issue.type === "bad_row");
    expect(badRow).toBeDefined();
    expect(badRow.path).toBe("02 Dancing/dancing-7.jpg");
    expect(badRow.message).toBe("Row at line 12 has 17 columns, expected 16");
    // The shifted row must never import, not even with shifted attribution.
    expect(
      catalog.photos.some((photo) => photo.originalRelativePath === "02 Dancing/dancing-7.jpg")
    ).toBe(false);
  });

  it("never imports from _Review, _Metadata, or By Person", () => {
    expect(EXCLUDED_DIRECTORIES).toEqual(["_Review", "_Metadata", "By Person"]);
    for (const photo of catalog.photos) {
      for (const excluded of EXCLUDED_DIRECTORIES) {
        expect(photo.originalRelativePath.startsWith(excluded)).toBe(false);
      }
    }
  });

  it("excludes By Person rows case-insensitively", () => {
    const excluded = catalog.stats.issues.find((issue) => issue.type === "excluded_path");
    expect(excluded).toBeDefined();
    expect(excluded.path).toBe("by person/Rachel Casciano/ceremony-1.jpg");
    expect(
      catalog.photos.some((photo) => photo.originalRelativePath.toLowerCase().startsWith("by person"))
    ).toBe(false);
  });

  it("computes fileSha256 from the current source bytes", async () => {
    const photoA = catalog.photos.find((photo) => photo.imageDataHash === HASH_A);
    const expected = await sha256File(`${fixture.root}/01 Ceremony/ceremony-1.jpg`);
    expect(photoA.fileSha256).toBe(expected);
    expect(photoA.originalBytes).toBeGreaterThan(0);
  });

  it("extracts capturedAt from EXIF with offset, and leaves it null when absent", () => {
    const photoA = catalog.photos.find((photo) => photo.imageDataHash === HASH_A);
    const photoB = catalog.photos.find((photo) => photo.imageDataHash === HASH_B);
    expect(photoA.capturedAt).toBe("2025-07-19T17:30:00-07:00");
    expect(photoB.capturedAt).toBeNull();
  });

  it("extracts embedded XMP keywords and leaves them empty when absent", () => {
    const photoA = catalog.photos.find((photo) => photo.imageDataHash === HASH_A);
    const photoB = catalog.photos.find((photo) => photo.imageDataHash === HASH_B);
    expect(photoA.keywords).toEqual(["Golden Hour", "Wedding"]);
    expect(photoB.keywords).toEqual([]);
  });

  it("classifies orientation", () => {
    const byHash = new Map(catalog.photos.map((photo) => [photo.imageDataHash, photo]));
    expect(byHash.get(HASH_A).orientation).toBe("landscape");
    expect(byHash.get(HASH_B).orientation).toBe("portrait");
    expect(byHash.get(HASH_C).orientation).toBe("square");
  });

  it("swaps to display dimensions for EXIF Orientation 6 and plans from them", () => {
    const photoR = catalog.photos.find((photo) => photo.imageDataHash === HASH_R);
    // Encoded 800x600 landscape; Orientation 6 rotates 90 CW to 600x800 portrait.
    expect(photoR.width).toBe(600);
    expect(photoR.height).toBe(800);
    expect(photoR.orientation).toBe("portrait");
    // Plans derive from the ORIENTED width (600): only 480 qualifies, and the
    // planned height follows the oriented aspect ratio (800 * 480 / 600).
    expect(photoR.previewObjects.map((object) => object.objectPath)).toEqual([
      `previews/${HASH_R}/480.avif`,
      `previews/${HASH_R}/480.webp`
    ]);
    for (const object of photoR.previewObjects) {
      expect(object.width).toBe(480);
      expect(object.height).toBe(640);
    }
  });

  it("keeps authoritative people labels, including a comma inside a quoted field", () => {
    const photoA = catalog.photos.find((photo) => photo.imageDataHash === HASH_A);
    expect(photoA.peopleSlugs).toEqual(["bond-lauren", "rachel-casciano"]);
    const lauren = catalog.people.find((person) => person.slug === "bond-lauren");
    expect(lauren.name).toBe("Bond, Lauren");
    expect(lauren.photoCount).toBe(1);
  });

  it("normalizes malformed people lists without crashing", () => {
    const photoG = catalog.photos.find((photo) => photo.imageDataHash === HASH_G);
    const names = catalog.people
      .filter((person) => photoG.peopleSlugs.includes(person.slug))
      .map((person) => person.name)
      .sort();
    expect(names).toEqual(["Bob Jones", "Maddie Slomovitz"]);
    expect(photoG.peopleSlugs).toEqual(["bob-jones", "maddie-slomovitz"]);
  });

  it("orders events by the canonical event order", () => {
    expect(EVENT_ORDER[0]).toBe("Day 1");
    expect(EVENT_ORDER).toHaveLength(14);
    expect(catalog.events.map((event) => event.name)).toEqual(["Ceremony", "Dancing"]);
    expect(catalog.events.map((event) => event.photoCount)).toEqual([3, 2]);
  });

  it("plans immutable preview derivatives per photo without upscaling", () => {
    const photoA = catalog.photos.find((photo) => photo.imageDataHash === HASH_A);
    const photoC = catalog.photos.find((photo) => photo.imageDataHash === HASH_C);
    expect(photoA.previewObjects.map((object) => object.objectPath)).toEqual([
      `previews/${HASH_A}/480.avif`,
      `previews/${HASH_A}/480.webp`,
      `previews/${HASH_A}/960.avif`,
      `previews/${HASH_A}/960.webp`
    ]);
    for (const object of photoA.previewObjects) {
      expect(object.cacheControl).toBe("public,max-age=31536000,immutable");
    }
    expect(photoC.previewObjects).toEqual([]);
  });

  it("marks every record as an approved photographer photo", () => {
    for (const photo of catalog.photos) {
      expect(photo.source).toBe("photographer");
      expect(photo.status).toBe("approved");
    }
  });

  it("never writes to the source tree", () => {
    expect(Object.fromEntries(statsAfter)).toEqual(Object.fromEntries(statsBefore));
  });

  it("emits catalog metadata", () => {
    expect(catalog.sourceRoot).toBe(fixture.root);
    expect(typeof catalog.generatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(catalog.generatedAt))).toBe(false);
    expect(catalog.stats.totalOriginalBytes).toBeGreaterThan(0);
    // All fixture files parse cleanly, so no per-file metadata read errors.
    expect(catalog.stats.metadataErrors).toEqual([]);
  });
});
