// Runtime-generated fixtures for packet 12B verify script tests
// (scripts/verify-gallery-catalog.mjs, scripts/verify-original-integrity.mjs,
// scripts/estimate-storage-egress.mjs). Everything is created into an OS
// temp directory by the caller's beforeAll/afterAll; nothing here touches
// the real Wedding Master Clean, src/generated/gallery-v2.json, or any
// network.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";

const MANIFEST_HEADER =
  "output_path,source_path,event,filename,image_data_hash,width,height," +
  "source_file_size,output_file_size,review_status,correction_action," +
  "lightroom_people,google_people,people_added,final_people,metadata_mode";

function csvField(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function manifestRow(row) {
  const columns = [
    row.output_path,
    row.output_path,
    row.event,
    row.filename,
    row.image_data_hash,
    row.width,
    row.height,
    row.output_file_size,
    row.output_file_size,
    "confirmed_people",
    "",
    "",
    "",
    "",
    row.final_people ?? "",
    "canonical_rewrite",
  ];
  return columns.map(csvField).join(",");
}

async function makeJpeg(path, { width, height }) {
  await fs.mkdir(dirname(path), { recursive: true });
  await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 180, b: 160 } },
  })
    .jpeg({ quality: 80 })
    .toFile(path);
}

async function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(path));
  return hash.digest("hex");
}

/**
 * Builds a miniature clean-master root with two valid photos (Ceremony,
 * Dancing) and returns a matching gallery-v2.json-shaped catalog object
 * referencing the SAME two photos by image_data_hash. The two layers agree
 * by construction; individual tests mutate one side to exercise
 * reconciliation failures.
 */
export async function buildMiniFixture() {
  const masterRoot = await fs.mkdtemp(join(tmpdir(), "verify-fixture-master-"));
  const hashA = "a1".repeat(16); // 32 lowercase hex chars
  const hashB = "b2".repeat(16);

  const pathA = join(masterRoot, "01 Ceremony/ceremony-1.jpg");
  const pathB = join(masterRoot, "02 Dancing/dancing-1.jpg");
  await makeJpeg(pathA, { width: 640, height: 480 });
  await makeJpeg(pathB, { width: 480, height: 640 });

  const statA = await fs.stat(pathA);
  const statB = await fs.stat(pathB);
  const shaA = await sha256File(pathA);
  const shaB = await sha256File(pathB);

  const rows = [
    manifestRow({
      output_path: "01 Ceremony/ceremony-1.jpg",
      event: "Ceremony",
      filename: "ceremony-1.jpg",
      image_data_hash: hashA,
      width: 640,
      height: 480,
      output_file_size: statA.size,
      final_people: "Rachel Casciano",
    }),
    manifestRow({
      output_path: "02 Dancing/dancing-1.jpg",
      event: "Dancing",
      filename: "dancing-1.jpg",
      image_data_hash: hashB,
      width: 480,
      height: 640,
      output_file_size: statB.size,
      final_people: "Zach Soskin",
    }),
  ];
  await fs.mkdir(join(masterRoot, "_Metadata"), { recursive: true });
  await fs.writeFile(
    join(masterRoot, "_Metadata/photo-manifest.csv"),
    `${MANIFEST_HEADER}\n${rows.join("\n")}\n`,
  );

  const photos = [
    {
      id: hashA,
      imageDataHash: hashA,
      fileSha256: shaA,
      originalRelativePath: "01 Ceremony/ceremony-1.jpg",
      originalFilename: "ceremony-1.jpg",
      originalBytes: statA.size,
      width: 640,
      height: 480,
      orientation: "landscape",
      eventSlug: "ceremony",
      capturedAt: null,
      peopleSlugs: ["rachel-casciano"],
      keywords: [],
      previewObjects: [
        {
          objectPath: `previews/${hashA}/480.avif`,
          width: 480,
          height: 360,
          format: "avif",
          cacheControl: "public,max-age=31536000,immutable",
        },
      ],
      source: "photographer",
      status: "approved",
    },
    {
      id: hashB,
      imageDataHash: hashB,
      fileSha256: shaB,
      originalRelativePath: "02 Dancing/dancing-1.jpg",
      originalFilename: "dancing-1.jpg",
      originalBytes: statB.size,
      width: 480,
      height: 640,
      orientation: "portrait",
      eventSlug: "dancing",
      capturedAt: null,
      peopleSlugs: ["zach-soskin"],
      keywords: [],
      previewObjects: [
        {
          objectPath: `previews/${hashB}/480.avif`,
          width: 360,
          height: 480,
          format: "avif",
          cacheControl: "public,max-age=31536000,immutable",
        },
      ],
      source: "photographer",
      status: "approved",
    },
  ];

  function catalogObject(overrides = {}) {
    const base = {
      generatedAt: new Date().toISOString(),
      sourceRoot: masterRoot,
      photos,
      people: [
        { slug: "rachel-casciano", name: "Rachel Casciano", photoCount: 1 },
        { slug: "zach-soskin", name: "Zach Soskin", photoCount: 1 },
      ],
      events: [
        { slug: "ceremony", name: "Ceremony", order: 0, photoCount: 1 },
        { slug: "dancing", name: "Dancing", order: 1, photoCount: 1 },
      ],
      stats: {
        manifestRows: 2,
        importedPhotos: 2,
        rejectedRows: 0,
        people: 2,
        events: 2,
        totalOriginalBytes: statA.size + statB.size,
        issues: [],
      },
    };
    return { ...base, ...overrides };
  }

  async function writeCatalogFile(overrides = {}) {
    const dir = await fs.mkdtemp(join(tmpdir(), "verify-fixture-catalog-"));
    const catalogPath = join(dir, "gallery-v2.json");
    await fs.writeFile(catalogPath, JSON.stringify(catalogObject(overrides), null, 2));
    return catalogPath;
  }

  async function cleanup() {
    await fs.rm(masterRoot, { recursive: true, force: true });
  }

  return {
    masterRoot,
    hashA,
    hashB,
    pathA,
    pathB,
    statA,
    statB,
    shaA,
    shaB,
    photos,
    catalogObject,
    writeCatalogFile,
    cleanup,
  };
}

/** Writes a plain KEY=VALUE env file for readCredentialsFromEnvFile tests. */
export async function writeEnvFile(vars) {
  const dir = await fs.mkdtemp(join(tmpdir(), "verify-fixture-env-"));
  const path = join(dir, ".env.test");
  const text = Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  await fs.writeFile(path, `${text}\n`);
  return path;
}
