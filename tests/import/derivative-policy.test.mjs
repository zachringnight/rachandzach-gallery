import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildDerivativePlan,
  generateDerivatives,
  CACHE_CONTROL,
  DERIVATIVE_WIDTHS
} from "../../scripts/lib/image-derivatives.mjs";
import { makeJpeg, sha256File, HASH_GEN } from "./fixtures.mjs";

function photoStub({ width, height, imageDataHash = HASH_GEN }) {
  return {
    id: imageDataHash,
    imageDataHash,
    width,
    height,
    orientation: width === height ? "square" : width > height ? "landscape" : "portrait"
  };
}

describe("buildDerivativePlan", () => {
  it("emits AVIF and WebP at 480/960/1600 plus a high-quality JPEG at 2400", () => {
    const plan = buildDerivativePlan(photoStub({ width: 8000, height: 5000 }));
    expect(plan.map((entry) => `${entry.width}.${entry.format}`)).toEqual([
      "480.avif",
      "480.webp",
      "960.avif",
      "960.webp",
      "1600.avif",
      "1600.webp",
      "2400.jpeg"
    ]);
  });

  it("uses the immutable object path and cache policy", () => {
    const plan = buildDerivativePlan(photoStub({ width: 8000, height: 5000 }));
    expect(plan[0].objectPath).toBe(`previews/${HASH_GEN}/480.avif`);
    expect(plan.at(-1).objectPath).toBe(`previews/${HASH_GEN}/2400.jpeg`);
    for (const entry of plan) {
      expect(entry.cacheControl).toBe("public,max-age=31536000,immutable");
    }
    expect(CACHE_CONTROL).toBe("public,max-age=31536000,immutable");
    expect(DERIVATIVE_WIDTHS).toEqual([480, 960, 1600, 2400]);
  });

  it("never upscales: only widths strictly smaller than the source width", () => {
    expect(
      buildDerivativePlan(photoStub({ width: 1200, height: 800 })).map(
        (entry) => `${entry.width}.${entry.format}`
      )
    ).toEqual(["480.avif", "480.webp", "960.avif", "960.webp"]);
    expect(buildDerivativePlan(photoStub({ width: 480, height: 320 }))).toEqual([]);
    expect(
      buildDerivativePlan(photoStub({ width: 2400, height: 1600 })).map((entry) => entry.width)
    ).toEqual([480, 480, 960, 960, 1600, 1600]);
  });

  it("plans proportional heights", () => {
    const plan = buildDerivativePlan(photoStub({ width: 2000, height: 1000 }));
    const at480 = plan.find((entry) => entry.width === 480 && entry.format === "avif");
    expect(at480.height).toBe(240);
  });
});

describe("generateDerivatives", () => {
  let workDir;
  let sourcePath;
  let outputRoot;
  let photo;
  let result;
  let sourceHashBefore;
  let sourceHashAfter;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(join(tmpdir(), "derivative-fixture-"));
    sourcePath = join(workDir, "source.jpg");
    // P3 ICC profile so profile preservation is observable in every derivative.
    await makeJpeg(sourcePath, { width: 3000, height: 2000, icc: "p3" });
    outputRoot = join(workDir, "out");
    photo = photoStub({ width: 3000, height: 2000 });
    sourceHashBefore = await sha256File(sourcePath);
    result = await generateDerivatives(photo, sourcePath, outputRoot);
    sourceHashAfter = await sha256File(sourcePath);
  }, 120000);

  afterAll(async () => {
    if (workDir) {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  });

  it("writes every planned derivative to its immutable object path", async () => {
    const expected = buildDerivativePlan(photo).map((entry) => entry.objectPath);
    expect(result.objects.map((object) => object.objectPath)).toEqual(expected);
    for (const objectPath of expected) {
      const stat = await fs.stat(join(outputRoot, objectPath));
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  it("produces decodable derivatives at the planned widths and formats", async () => {
    for (const entry of buildDerivativePlan(photo)) {
      const metadata = await sharp(join(outputRoot, entry.objectPath)).metadata();
      expect(metadata.width).toBe(entry.width);
      const expectedFormat = entry.format === "avif" ? "heif" : entry.format;
      expect(metadata.format).toBe(expectedFormat);
    }
  });

  it("records MEASURED decoded width and height on every emitted object", async () => {
    for (const object of result.objects) {
      const metadata = await sharp(join(outputRoot, object.objectPath)).metadata();
      expect(object.width).toBe(metadata.width);
      expect(object.height).toBe(metadata.height);
    }
    // 3000x2000 source: measured heights follow the true aspect ratio.
    expect(result.objects.map((object) => `${object.width}x${object.height}`)).toEqual([
      "480x320",
      "480x320",
      "960x640",
      "960x640",
      "1600x1067",
      "1600x1067",
      "2400x1600"
    ]);
  });

  it("preserves the embedded ICC profile in derivatives", async () => {
    for (const entry of buildDerivativePlan(photo)) {
      const metadata = await sharp(join(outputRoot, entry.objectPath)).metadata();
      expect(metadata.icc, `${entry.objectPath} should carry ICC`).toBeDefined();
    }
  });

  it("does not modify the source file", () => {
    expect(sourceHashAfter).toBe(sourceHashBefore);
  });

  it("cleans up its temporary staging directory", async () => {
    const entries = await fs.readdir(outputRoot);
    expect(entries).toEqual(["previews"]);
  });

  it("reports the cache policy on every emitted object", () => {
    for (const object of result.objects) {
      expect(object.cacheControl).toBe(CACHE_CONTROL);
      expect(object.bytes).toBeGreaterThan(0);
    }
  });

  it("bakes EXIF Orientation 6 rotation and emits measured oriented dimensions", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "derivative-orient-"));
    try {
      const source = join(dir, "rotated.jpg");
      // Encoded 800x600 landscape; Orientation 6 displays as 600x800 portrait.
      await makeJpeg(source, { width: 800, height: 600, orientation: 6 });
      // The loader hands over ORIENTED dims, so the record arrives as 600x800.
      const rotated = photoStub({ width: 600, height: 800, imageDataHash: "5".repeat(32) });
      const out = join(dir, "out");
      const { objects } = await generateDerivatives(rotated, source, out);
      expect(objects.map((object) => `${object.width}x${object.height}.${object.format}`)).toEqual([
        "480x640.avif",
        "480x640.webp"
      ]);
      for (const object of objects) {
        const metadata = await sharp(join(out, object.objectPath)).metadata();
        expect(metadata.width).toBe(480);
        expect(metadata.height).toBe(640);
        // Rotation is baked into pixels; no orientation tag survives.
        expect(metadata.orientation ?? 1).toBe(1);
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("aborts loudly when a rotated source is planned from unswapped encoded dims", async () => {
    // The exact silent-corruption case from the review: plan built from encoded
    // dims while autoOrient rotates pixels. Height verification must now catch it.
    const dir = await fs.mkdtemp(join(tmpdir(), "derivative-orient-bad-"));
    try {
      const source = join(dir, "rotated.jpg");
      await makeJpeg(source, { width: 2000, height: 600, orientation: 6 });
      const unswapped = photoStub({ width: 2000, height: 600, imageDataHash: "6".repeat(32) });
      const out = join(dir, "out");
      await expect(generateDerivatives(unswapped, source, out)).rejects.toThrow(/height|width/i);
      const published = await fs.readdir(join(out, "previews")).catch(() => []);
      expect(published).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("incremental mode reuses verified outputs and regenerates corrupt ones", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "derivative-incremental-"));
    try {
      const source = join(dir, "source.jpg");
      await makeJpeg(source, { width: 1200, height: 800 });
      const small = photoStub({ width: 1200, height: 800, imageDataHash: "7".repeat(32) });
      const out = join(dir, "out");

      const first = await generateDerivatives(small, source, out);
      expect(first.reused).toBe(0);
      const paths = first.objects.map((object) => join(out, object.objectPath));
      const mtimesBefore = await Promise.all(paths.map(async (p) => (await fs.stat(p)).mtimeMs));

      const second = await generateDerivatives(small, source, out, { incremental: true });
      expect(second.reused).toBe(first.objects.length);
      expect(second.objects).toEqual(first.objects);
      const mtimesAfter = await Promise.all(paths.map(async (p) => (await fs.stat(p)).mtimeMs));
      expect(mtimesAfter).toEqual(mtimesBefore);

      // Corrupt one output; an incremental re-run must regenerate exactly it.
      await fs.writeFile(paths[0], "not an image");
      const third = await generateDerivatives(small, source, out, { incremental: true });
      expect(third.reused).toBe(first.objects.length - 1);
      const regenerated = await sharp(paths[0]).metadata();
      expect(regenerated.width).toBe(480);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 180000);

  it("aborts without publishing when the source cannot satisfy the plan", async () => {
    const liarDir = await fs.mkdtemp(join(tmpdir(), "derivative-liar-"));
    try {
      const liarSource = join(liarDir, "small.jpg");
      await makeJpeg(liarSource, { width: 900, height: 600 });
      // Manifest claims 5000px, so the plan demands widths the pixels cannot honor.
      const liar = photoStub({ width: 5000, height: 3333, imageDataHash: "0".repeat(32) });
      const liarOut = join(liarDir, "out");
      await expect(generateDerivatives(liar, liarSource, liarOut)).rejects.toThrow(/width/i);
      const published = await fs
        .readdir(join(liarOut, "previews"))
        .catch(() => []);
      expect(published).toEqual([]);
      const leftovers = (await fs.readdir(liarOut).catch(() => [])).filter((name) =>
        name.startsWith(".tmp")
      );
      expect(leftovers).toEqual([]);
    } finally {
      await fs.rm(liarDir, { recursive: true, force: true });
    }
  }, 60000);
});
