// Shared fixture builders for the read-only import pipeline tests.
// Fixtures are generated at test runtime into an OS temp directory and
// removed afterwards. Nothing here touches the real Wedding Master Clean.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";

export const HASH_A = "a".repeat(32);
export const HASH_B = "b".repeat(32);
export const HASH_C = "c".repeat(32);
export const HASH_G = "d".repeat(32);
export const HASH_E = "e".repeat(32);
export const HASH_H = "1234567890abcdef1234567890abcdef";
export const HASH_GEN = "f".repeat(32);
export const HASH_R = "2".repeat(32);

const XMP_PACKET = [
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
  '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">',
  "<dc:subject><rdf:Bag>",
  "<rdf:li>Wedding</rdf:li><rdf:li>Golden Hour</rdf:li>",
  "</rdf:Bag></dc:subject>",
  "</rdf:Description></rdf:RDF></x:xmpmeta>",
  '<?xpacket end="w"?>'
].join("");

export async function makeJpeg(
  path,
  { width, height, exif = false, xmp = false, icc = null, orientation = null } = {}
) {
  await fs.mkdir(dirname(path), { recursive: true });
  let pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 210, g: 170, b: 120 } }
  }).jpeg({ quality: 82 });
  if (orientation) {
    // Writes an EXIF Orientation tag WITHOUT rotating pixels: the encoded
    // dimensions stay width x height while viewers display the rotated image.
    pipeline = pipeline.withMetadata({ orientation });
  }
  if (exif) {
    pipeline = pipeline.withExif({
      IFD0: { Make: "Fixture" },
      IFD2: {
        DateTimeOriginal: "2025:07:19 17:30:00",
        OffsetTimeOriginal: "-07:00"
      }
    });
  }
  if (xmp) {
    pipeline = pipeline.withXmp(XMP_PACKET);
  }
  if (icc) {
    pipeline = pipeline.withIccProfile(icc);
  }
  await pipeline.toFile(path);
  return path;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(path));
  return hash.digest("hex");
}

function csvField(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export const MANIFEST_HEADER =
  "output_path,source_path,event,filename,image_data_hash,width,height," +
  "source_file_size,output_file_size,review_status,correction_action," +
  "lightroom_people,google_people,people_added,final_people,metadata_mode";

export function manifestRow(row) {
  const columns = [
    row.output_path,
    row.source_path ?? row.output_path,
    row.event,
    row.filename,
    row.image_data_hash,
    row.width,
    row.height,
    row.source_file_size ?? row.output_file_size ?? 0,
    row.output_file_size ?? 0,
    row.review_status ?? "confirmed_people",
    row.correction_action ?? "",
    row.lightroom_people ?? "",
    row.google_people ?? "",
    row.people_added ?? "",
    row.final_people ?? "",
    row.metadata_mode ?? "canonical_rewrite"
  ];
  return columns.map(csvField).join(",");
}

/**
 * Builds a miniature clean-master root:
 *  - valid photos A (landscape, EXIF+XMP), B (portrait, bare), C (square), G (malformed people),
 *    R (EXIF Orientation 6: encoded landscape, displays portrait)
 *  - rejected rows: bad dimensions, bad hash, duplicate hash, missing file,
 *    size mismatch, shifted row (extra unquoted comma)
 *  - _Review, _Metadata junk, and a By Person symlink that must never be crawled
 */
export async function buildManifestFixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "clean-master-fixture-"));

  const photoA = await makeJpeg(join(root, "01 Ceremony/ceremony-1.jpg"), {
    width: 1024,
    height: 683,
    exif: true,
    xmp: true
  });
  const photoB = await makeJpeg(join(root, "01 Ceremony/ceremony-2.jpg"), { width: 600, height: 900 });
  // Encoded 800x600 landscape with EXIF Orientation 6 (Rotate 90 CW): the
  // display image is 600x800 portrait. The manifest records ENCODED dims,
  // exactly like exiftool -ImageWidth/-ImageHeight did for the real archive.
  const photoR = await makeJpeg(join(root, "01 Ceremony/ceremony-3.jpg"), {
    width: 800,
    height: 600,
    orientation: 6
  });
  const photoC = await makeJpeg(join(root, "02 Dancing/dancing-1.jpg"), { width: 400, height: 400 });
  const photoG = await makeJpeg(join(root, "02 Dancing/dancing-2.jpg"), { width: 500, height: 300 });
  const photoBadDims = await makeJpeg(join(root, "02 Dancing/dancing-3.jpg"), { width: 320, height: 200 });
  const photoBadHash = await makeJpeg(join(root, "02 Dancing/dancing-4.jpg"), { width: 320, height: 200 });
  const photoDup = await makeJpeg(join(root, "02 Dancing/dancing-5.jpg"), { width: 320, height: 200 });
  const photoSizeMismatch = await makeJpeg(join(root, "02 Dancing/dancing-6.jpg"), { width: 320, height: 200 });

  // Directories the importer must never crawl.
  await fs.mkdir(join(root, "_Review"), { recursive: true });
  await fs.writeFile(join(root, "_Review/review-notes.txt"), "do not import\n");
  await makeJpeg(join(root, "_Review/rejected.jpg"), { width: 100, height: 100 });
  await fs.mkdir(join(root, "_Metadata"), { recursive: true });
  await fs.mkdir(join(root, "By Person/Rachel Casciano"), { recursive: true });
  await fs.symlink(
    join("..", "..", "01 Ceremony", "ceremony-1.jpg"),
    join(root, "By Person/Rachel Casciano/ceremony-1.jpg")
  );

  const size = async (path) => (await fs.stat(path)).size;

  const rows = [
    manifestRow({
      output_path: "01 Ceremony/ceremony-1.jpg",
      event: "Ceremony",
      filename: "ceremony-1.jpg",
      image_data_hash: HASH_A,
      width: 1024,
      height: 683,
      output_file_size: await size(photoA),
      // Quoted field containing a comma: the parser must keep it as one field.
      final_people: "Bond, Lauren; Rachel Casciano"
    }),
    manifestRow({
      output_path: "01 Ceremony/ceremony-2.jpg",
      event: "Ceremony",
      filename: "ceremony-2.jpg",
      image_data_hash: HASH_B,
      width: 600,
      height: 900,
      output_file_size: await size(photoB)
    }),
    manifestRow({
      output_path: "01 Ceremony/ceremony-3.jpg",
      event: "Ceremony",
      filename: "ceremony-3.jpg",
      image_data_hash: HASH_R,
      // Encoded dimensions, as exiftool reports them; Orientation 6 means the
      // loader must emit 600x800 portrait.
      width: 800,
      height: 600,
      output_file_size: await size(photoR)
    }),
    manifestRow({
      output_path: "02 Dancing/dancing-1.jpg",
      event: "Dancing",
      filename: "dancing-1.jpg",
      image_data_hash: HASH_C,
      width: 400,
      height: 400,
      output_file_size: await size(photoC),
      final_people: "Zach Soskin"
    }),
    manifestRow({
      output_path: "02 Dancing/dancing-2.jpg",
      event: "Dancing",
      filename: "dancing-2.jpg",
      image_data_hash: HASH_G,
      width: 500,
      height: 300,
      output_file_size: await size(photoG),
      // Malformed people list: blanks, doubled separators, stray spaces, duplicate.
      final_people: ";  ; Maddie   Slomovitz ;;Bob Jones ;Bob Jones; "
    }),
    manifestRow({
      output_path: "02 Dancing/dancing-3.jpg",
      event: "Dancing",
      filename: "dancing-3.jpg",
      image_data_hash: HASH_E,
      width: "abc",
      height: 200,
      output_file_size: await size(photoBadDims)
    }),
    manifestRow({
      output_path: "02 Dancing/dancing-4.jpg",
      event: "Dancing",
      filename: "dancing-4.jpg",
      image_data_hash: "not-a-real-hash",
      width: 320,
      height: 200,
      output_file_size: await size(photoBadHash)
    }),
    manifestRow({
      output_path: "02 Dancing/dancing-5.jpg",
      event: "Dancing",
      filename: "dancing-5.jpg",
      image_data_hash: HASH_A, // duplicate of ceremony-1
      width: 320,
      height: 200,
      output_file_size: await size(photoDup)
    }),
    manifestRow({
      output_path: "01 Ceremony/ceremony-404.jpg",
      event: "Ceremony",
      filename: "ceremony-404.jpg",
      image_data_hash: HASH_H,
      width: 320,
      height: 200,
      output_file_size: 12345
    }),
    manifestRow({
      output_path: "02 Dancing/dancing-6.jpg",
      event: "Dancing",
      filename: "dancing-6.jpg",
      image_data_hash: "9".repeat(32),
      width: 320,
      height: 200,
      output_file_size: (await size(photoSizeMismatch)) + 999
    }),
    // Shifted row: an extra UNQUOTED comma in lightroom_people yields 17
    // columns against a 16-column header. Must be rejected by line number,
    // never imported with silently shifted cells.
    [
      "02 Dancing/dancing-7.jpg",
      "02 Dancing/dancing-7.jpg",
      "Dancing",
      "dancing-7.jpg",
      "3".repeat(32),
      "320",
      "200",
      "100",
      "100",
      "confirmed_people",
      "",
      "Alice, Bob", // intentionally unquoted: splits into two cells
      "",
      "",
      "Alice",
      "canonical_rewrite"
    ].join(","),
    // Lowercase excluded directory: APFS resolves it to the real By Person
    // tree, so exclusion matching must be case-insensitive.
    manifestRow({
      output_path: "by person/Rachel Casciano/ceremony-1.jpg",
      event: "Ceremony",
      filename: "ceremony-1.jpg",
      image_data_hash: "4".repeat(32),
      width: 320,
      height: 200,
      output_file_size: 100
    })
  ];

  const manifestPath = join(root, "_Metadata/photo-manifest.csv");
  await fs.writeFile(manifestPath, `${MANIFEST_HEADER}\n${rows.join("\n")}\n`);

  return { root, manifestPath };
}

export async function snapshotStats(root) {
  const snapshot = new Map();
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(path);
      } else {
        const stat = await fs.stat(path);
        snapshot.set(path, `${stat.size}:${stat.mtimeMs}`);
      }
    }
  };
  await walk(root);
  return snapshot;
}
