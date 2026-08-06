#!/usr/bin/env node
/**
 * Render the naming queue's look-alike stacks as numbered contact sheets.
 *
 * The browser tagger asks one face at a time. This asks the whole archive at
 * once: one numbered cell per stack, showing that stack's sharpest face, how
 * many photographs naming it would tag, and who is ALREADY tagged in those
 * photographs. That last line is the real hint. These stacks are unresolved
 * precisely because no saved profile matched them, so the model has no
 * suggestion to offer, but "appears in 6 photos with Tom and Nita Myers" is
 * often enough for a human to put a name to a face immediately.
 *
 * Answers come back as plain text ("3 is Linda Willey, 7 is Danny, 12 skip")
 * and are applied with apply-stack-names.mjs, which writes the same reviewed
 * additions the tagger writes.
 *
 * Local only. Reads gitignored face artifacts and local derivatives, never
 * opens an original, never touches Supabase.
 *
 *   node scripts/face/render-stack-sheets.mjs [--per-sheet 12] [--min-size 2]
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MODEL = join(repoRoot, "metadata/identity-review/naming-tool-model.json");
const QUALITY = join(repoRoot, "metadata/faces/cluster-face-quality.json");
const CATALOG = join(repoRoot, "src/generated/gallery-v2.json");
const PREVIEWS = join(repoRoot, "metadata/import/derivatives/previews");
const OUT_DIR = join(repoRoot, "metadata/faces/stack-sheets");

const CELL = 300;
const CAPTION = 86;
const PAD = 18;
const COLS = 4;
const HEADER = 56;

function flag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
}

function escapeXml(value) {
  return String(value).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

function ellipsize(value, max) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

async function main() {
  const perSheet = flag("--per-sheet", 12);
  const minSize = flag("--min-size", 2);

  const model = JSON.parse(await fs.readFile(MODEL, "utf8"));
  const catalog = JSON.parse(await fs.readFile(CATALOG, "utf8"));
  const nameBySlug = new Map(catalog.people.map((p) => [p.slug, p.name]));
  const photoBySlugPath = new Map(
    catalog.photos.map((p) => [p.originalRelativePath, p]),
  );

  const quality = new Map();
  if (existsSync(QUALITY)) {
    for (const entry of JSON.parse(await fs.readFile(QUALITY, "utf8"))) {
      if (entry?.faceKey) quality.set(entry.faceKey, entry);
    }
  }

  // The two open sets, and the whole point of this sheet: a face nobody has
  // named is very probably a guest who appears in no photograph. Pairing
  // those two lists is a far smaller question than "who is this, out of 189".
  const ledger = JSON.parse(
    await fs.readFile(join(repoRoot, "metadata/identity-review/naming-decisions.json"), "utf8"),
  ).entries ?? {};
  const SETTLED = new Set(["tag", "not-a-guest", "too-blurry", "remove"]);
  const taggedCount = new Map();
  for (const photo of catalog.photos) {
    for (const slug of photo.peopleSlugs ?? []) {
      taggedCount.set(slug, (taggedCount.get(slug) ?? 0) + 1);
    }
  }
  const attendees = JSON.parse(
    await fs.readFile(join(repoRoot, "metadata/wedding-attendees.json"), "utf8"),
  ).attendees;
  const missingGuests = attendees
    .filter((guest) => !taggedCount.get(guest.personSlug))
    .map((guest) => guest.displayName);
  const missingBySurname = new Map();
  for (const name of missingGuests) {
    const surname = name.split(" ").pop().toLowerCase();
    if (!missingBySurname.has(surname)) missingBySurname.set(surname, []);
    missingBySurname.get(surname).push(name);
  }

  const itemByKey = new Map(model.items.map((item) => [item.key, item]));
  const stacks = model.groups
    .filter((group) => group.keys.length >= minSize)
    // Only what is still open and still nameless. A stack somebody already
    // named, ruled out, or called too blurry has no business on this sheet.
    .filter(
      (group) =>
        !group.keys.some((key) => ledger[key]?.action === "tag") &&
        group.keys.some((key) => !SETTLED.has(ledger[key]?.action)),
    )
    .map((group) => {
      const members = group.keys.map((key) => itemByKey.get(key)).filter(Boolean);
      // Best face = the most RECOGNIZABLE one, which is not the same as the
      // sharpest. Sharpness alone promotes a crisp back of a head, because
      // blur and frontality are different measurements. The detector's own
      // confidence carries frontality (a turned or occluded head scores low),
      // so rank on that first and let focus break ties. Unmeasured faces fall
      // back to size.
      const scoreOf = (item) => {
        const measured = quality.get(`${item.photoId}:${item.faceIndex}`);
        if (!measured) return (item.box?.height ?? 0) * 0.1;
        return measured.detScore * Math.sqrt(Math.min(measured.focus, 900));
      };
      const best = members
        .slice()
        .sort((left, right) => scoreOf(right) - scoreOf(left))[0];
      // Who is already named in this stack's photographs: the hint that lets
      // a human place a face the model could not.
      const coTags = new Map();
      const photos = new Set();
      for (const member of members) {
        photos.add(member.catalogPath);
        const photo = photoBySlugPath.get(member.catalogPath);
        for (const slug of photo?.peopleSlugs ?? []) {
          coTags.set(slug, (coTags.get(slug) ?? 0) + 1);
        }
      }
      const coTagNames = [...coTags.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([slug]) => nameBySlug.get(slug) ?? slug);
      // Families sit together and are photographed together, so a nameless
      // face standing beside two Myerses is very likely the Myers who has no
      // photographs yet. This narrows 34 candidates to two or three.
      const suggestions = new Set();
      for (const name of coTagNames) {
        for (const candidate of missingBySurname.get(name.split(" ").pop().toLowerCase()) ?? []) {
          suggestions.add(candidate);
        }
      }
      return {
        id: group.id,
        members,
        best,
        photoCount: photos.size,
        coTags: coTagNames.slice(0, 4),
        suggestions: [...suggestions].slice(0, 3),
      };
    })
    .filter((stack) => stack.best)
    .sort((left, right) => right.members.length - left.members.length);

  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const stale of await fs.readdir(OUT_DIR).catch(() => [])) {
    if (stale.endsWith(".jpg")) await fs.unlink(join(OUT_DIR, stale));
  }

  const index = [];
  let number = 0;
  for (let offset = 0; offset < stacks.length; offset += perSheet) {
    const page = stacks.slice(offset, offset + perSheet);
    const rows = Math.ceil(page.length / COLS);
    const width = COLS * (CELL + PAD) + PAD;
    const height = rows * (CELL + CAPTION + PAD) + PAD + HEADER;
    const composites = [];
    const labels = [];

    for (const [cellIndex, stack] of page.entries()) {
      number += 1;
      index.push({
        number,
        stackId: stack.id,
        faces: stack.members.length,
        photos: stack.photoCount,
        coTags: stack.coTags,
        keys: stack.members.map((member) => member.key),
      });

      const column = cellIndex % COLS;
      const row = Math.floor(cellIndex / COLS);
      const left = PAD + column * (CELL + PAD);
      const top = HEADER + row * (CELL + CAPTION + PAD);

      const item = stack.best;
      const previewPath = join(repoRoot, decodeURIComponent(item.photoUrl));
      if (existsSync(previewPath)) {
        const meta = await sharp(previewPath).metadata();
        // Crop from the face box directly rather than the tagger's tightCrop,
        // which leaves enough room that a neighbouring guest often shares the
        // cell and it stops being obvious who the question is about. 1.7x the
        // longest side keeps hair, ears and a little shoulder: enough to
        // recognize somebody, not enough to be ambiguous.
        const box = item.box;
        const size = box
          ? Math.round(Math.max(box.width * meta.width, box.height * meta.height) * 1.7)
          : Math.min(meta.width, meta.height);
        const centerX = box ? (box.x + box.width / 2) * meta.width : meta.width / 2;
        const centerY = box ? (box.y + box.height / 2) * meta.height : meta.height / 2;
        const cropLeft = Math.max(0, Math.min(meta.width - 8, Math.round(centerX - size / 2)));
        const cropTop = Math.max(0, Math.min(meta.height - 8, Math.round(centerY - size / 2)));
        const buffer = await sharp(previewPath)
          .extract({
            left: cropLeft,
            top: cropTop,
            width: Math.max(8, Math.min(size, meta.width - cropLeft)),
            height: Math.max(8, Math.min(size, meta.height - cropTop)),
          })
          .resize(CELL, CELL, { fit: "cover" })
          .toBuffer();
        composites.push({ input: buffer, left, top });
      }

      const coverage = `${stack.members.length} faces · ${stack.photoCount} photos`;
      const withLine = stack.coTags.length
        ? `with ${ellipsize(stack.coTags.join(", "), 34)}`
        : "nobody else named here";
      labels.push(
        `<text x="${left}" y="${top - 8}" font-family="Helvetica" font-size="21" font-weight="bold" fill="#2b2118">${number}</text>`,
        `<text x="${left + 30}" y="${top - 8}" font-family="Helvetica" font-size="14" fill="#6f5f4d">${escapeXml(coverage)}</text>`,
        `<text x="${left}" y="${top + CELL + 22}" font-family="Helvetica" font-size="13.5" fill="#4a3f33">${escapeXml(withLine)}</text>`,
        stack.suggestions.length
          ? `<text x="${left}" y="${top + CELL + 42}" font-family="Helvetica" font-size="13" font-weight="bold" fill="#a8451f">${escapeXml(ellipsize(`maybe ${stack.suggestions.join(" / ")}`, 36))}</text>`
          : `<text x="${left}" y="${top + CELL + 42}" font-family="Helvetica" font-size="12" fill="#8a7862">${escapeXml(ellipsize(stack.best.event, 30))}</text>`,
      );
    }

    const sheetNumber = Math.floor(offset / perSheet) + 1;
    const heading =
      `nameless faces ${number - page.length + 1} to ${number}  ·  sheet ${sheetNumber}   ` +
      `|   still unphotographed: ${ellipsize(missingGuests.join(", "), 150)}`;
    composites.push({
      input: Buffer.from(
        `<svg width="${width}" height="${height}">` +
          `<text x="${PAD}" y="24" font-family="Helvetica" font-size="15" fill="#8a7862">${escapeXml(heading)}</text>` +
          labels.join("") +
          `</svg>`,
      ),
      top: 0,
      left: 0,
    });

    await sharp({
      create: { width, height, channels: 3, background: "#f7f3eb" },
    })
      .composite(composites)
      .jpeg({ quality: 90 })
      .toFile(join(OUT_DIR, `sheet-${String(sheetNumber).padStart(3, "0")}.jpg`));
  }

  await fs.writeFile(
    join(OUT_DIR, "index.json"),
    `${JSON.stringify({ builtFrom: model.buildFingerprint, stacks: index }, null, 1)}\n`,
  );

  const covered = index.reduce((total, entry) => total + entry.faces, 0);
  console.log(
    `${index.length} stacks covering ${covered} faces on ` +
      `${Math.ceil(index.length / perSheet)} sheets in ${OUT_DIR}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
