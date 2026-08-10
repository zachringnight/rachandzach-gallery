#!/usr/bin/env node
/**
 * Render the naming queue's look-alike stacks as numbered contact sheets.
 *
 * The browser tagger asks one face at a time. This asks the whole archive at
 * once: one numbered cell per stack, showing up to three of that stack's
 * clearest faces, how many photographs naming it would tag, and who is ALREADY
 * tagged in those photographs. That last line is the real hint. These stacks
 * are unresolved precisely because no saved profile matched them, so the
 * model has no suggestion to offer, but "appears in 6 photos with Tom and
 * Nita Myers" is often enough for a human to put a name to a face immediately.
 *
 * Answers come back as plain text ("3 is Linda Willey, 7 is Danny, 12 skip")
 * and are applied with apply-stack-names.mjs, which writes the same reviewed
 * additions the tagger writes.
 *
 * Local only. Reads gitignored face artifacts and local derivatives, never
 * opens an original, never touches Supabase.
 *
 * The default is the useful Rach pass: only stacks with at least one face
 * clear enough to recognize. Pass --include-blurry to render the whole tail.
 *
 *   node scripts/face/render-stack-sheets.mjs [--per-sheet 9] [--min-size 2]
 *   node scripts/face/render-stack-sheets.mjs --include-blurry
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
const OUT_DIR = join(repoRoot, "metadata/faces/stack-sheets");
const CANDIDATE_REJECTIONS = join(
  repoRoot,
  "metadata/identity-review/stack-candidate-rejections.json",
);

const CELL = 360;
const IMAGE_HEIGHT = 300;
const MAIN_FACE_WIDTH = 240;
const SUPPORT_FACE_WIDTH = CELL - MAIN_FACE_WIDTH;
const CAPTION = 92;
const PAD = 18;
const COLS = 3;
const HEADER = 76;

// cluster-face-quality.json measures the detector crop directly. A score of
// 12 is a comfortably recognizable face in this archive. A lower score can
// still pass when the face is large enough to survive modest softness. These
// thresholds deliberately keep c0180/c0618 (large, readable faces) while
// dropping the genuinely smeared c0663/c0967 tail.
const CLEAR_SCORE = 12;
const CLEAR_PIXELS = 40;
const SOFT_CLEAR_SCORE = 5;
const SOFT_CLEAR_PIXELS = 80;
const SOFT_CLEAR_FOCUS = 50;
const SOFT_CLEAR_DETECTION = 0.7;
// Some June CSV faces do not map cleanly to the later detector run and have no
// quality row. For those only, a fixed-size Laplacian check separates a clear
// crop (g004 is 433+) from the blurred tail (g030 is 17).
const FALLBACK_CLEAR_FOCUS = 100;
// These detector scores are inflated by an obstruction or film grain rather
// than facial detail. Every available view has the same problem, so they
// belong in the browser long tail even though the numeric focus score is high.
const VISUALLY_HELD_STACKS = new Set(["c0700", "c0710"]);

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

function measuredScore(entry) {
  return entry.detScore * Math.sqrt(Math.min(entry.focus, 900));
}

function measuredIsClear(entry) {
  const score = measuredScore(entry);
  return (
    (score >= CLEAR_SCORE && entry.px >= CLEAR_PIXELS) ||
    (score >= SOFT_CLEAR_SCORE &&
      entry.px >= SOFT_CLEAR_PIXELS &&
      entry.focus >= SOFT_CLEAR_FOCUS &&
      entry.detScore >= SOFT_CLEAR_DETECTION)
  );
}

function laplacianVariance(buffer, width, height) {
  let count = 0;
  let sum = 0;
  let sumSquares = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const offset = y * width + x;
      const value =
        4 * buffer[offset] -
        buffer[offset - 1] -
        buffer[offset + 1] -
        buffer[offset - width] -
        buffer[offset + width];
      count += 1;
      sum += value;
      sumSquares += value * value;
    }
  }
  if (!count) return 0;
  return sumSquares / count - (sum / count) ** 2;
}

function cropGeometry(item, metadata, padding = 1.7) {
  const box = item.box;
  const naturalWidth = metadata.width;
  const naturalHeight = metadata.height;
  const size = box
    ? Math.round(
        Math.max(box.width * naturalWidth, box.height * naturalHeight) * padding,
      )
    : Math.min(naturalWidth, naturalHeight);
  const centerX = box ? (box.x + box.width / 2) * naturalWidth : naturalWidth / 2;
  const centerY = box ? (box.y + box.height / 2) * naturalHeight : naturalHeight / 2;
  const left = Math.max(
    0,
    Math.min(naturalWidth - 8, Math.round(centerX - size / 2)),
  );
  const top = Math.max(
    0,
    Math.min(naturalHeight - 8, Math.round(centerY - size / 2)),
  );
  return {
    left,
    top,
    width: Math.max(8, Math.min(size, naturalWidth - left)),
    height: Math.max(8, Math.min(size, naturalHeight - top)),
  };
}

async function fallbackQuality(item) {
  const previewPath = join(repoRoot, decodeURIComponent(item.photoUrl));
  if (!existsSync(previewPath) || !item.box) return { clear: false, score: 0 };
  const metadata = await sharp(previewPath).metadata();
  const facePixels = Math.round(
    Math.max(item.box.width * metadata.width, item.box.height * metadata.height),
  );
  const crop = cropGeometry(item, metadata, 1);
  const { data, info } = await sharp(previewPath)
    .extract(crop)
    .resize(160, 160, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const focus = laplacianVariance(data, info.width, info.height);
  return {
    clear: facePixels >= SOFT_CLEAR_PIXELS && focus >= FALLBACK_CLEAR_FOCUS,
    // Only compared with other fallback rows. A logarithm keeps one noisy
    // crop from dominating every other recognizable view in the same stack.
    score: Math.log2(1 + focus) + Math.min(facePixels, 300) / 300,
    focus,
    facePixels,
  };
}

async function rankMember(item, quality) {
  const measured = quality.get(`${item.photoId}:${item.faceIndex}`);
  if (measured) {
    return {
      item,
      clear: measuredIsClear(measured),
      score: measuredScore(measured),
      source: "measured",
    };
  }
  const fallback = await fallbackQuality(item);
  return { item, source: "fallback", ...fallback };
}

function distinctPhotos(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.item.catalogPath)) return false;
    seen.add(entry.item.catalogPath);
    return true;
  });
}

async function renderFaceCrop(item, width, height, padding) {
  const previewPath = join(repoRoot, decodeURIComponent(item.photoUrl));
  if (!existsSync(previewPath)) return null;
  const metadata = await sharp(previewPath).metadata();
  return sharp(previewPath)
    .extract(cropGeometry(item, metadata, padding))
    .resize(width, height, { fit: "cover" })
    .toBuffer();
}

async function main() {
  const perSheet = flag("--per-sheet", 9);
  const minSize = flag("--min-size", 2);
  const includeBlurry = process.argv.includes("--include-blurry");

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
    .map((guest) => ({ name: guest.displayName, slug: guest.personSlug }));
  const missingBySurname = new Map();
  for (const candidate of missingGuests) {
    const surname = candidate.name.split(" ").pop().toLowerCase();
    if (!missingBySurname.has(surname)) missingBySurname.set(surname, []);
    missingBySurname.get(surname).push(candidate);
  }

  // A human can rule out a context-based suggestion without knowing who the
  // face actually is. Keep that evidence by stable stack ID so future sheets
  // stop repeating the rejected name while the stack itself stays open.
  const rejectedCandidatesByStack = new Map();
  if (existsSync(CANDIDATE_REJECTIONS)) {
    const candidateRejections = JSON.parse(
      await fs.readFile(CANDIDATE_REJECTIONS, "utf8"),
    ).rejections ?? [];
    for (const rejection of candidateRejections) {
      if (!rejection?.stackId || !rejection?.personSlug) continue;
      if (!rejectedCandidatesByStack.has(rejection.stackId)) {
        rejectedCandidatesByStack.set(rejection.stackId, new Set());
      }
      rejectedCandidatesByStack.get(rejection.stackId).add(rejection.personSlug);
    }
  }

  const itemByKey = new Map(model.items.map((item) => [item.key, item]));
  const candidateGroups = model.groups
    .filter((group) => group.keys.length >= minSize)
    // Only what is still open and still nameless. A stack somebody already
    // named, ruled out, or called too blurry has no business on this sheet.
    .filter(
      (group) =>
        !group.keys.some((key) => ledger[key]?.action === "tag") &&
        group.keys.some((key) => !SETTLED.has(ledger[key]?.action)),
    )
    .sort((left, right) => right.keys.length - left.keys.length);

  const stacks = [];
  const excluded = [];
  for (const group of candidateGroups) {
      const members = group.keys.map((key) => itemByKey.get(key)).filter(Boolean);
      const reviewableMembers = members.filter(
        (member) => !SETTLED.has(ledger[member.key]?.action),
      );
      const ranked = (
        await Promise.all(reviewableMembers.map((member) => rankMember(member, quality)))
      ).sort((left, right) => right.score - left.score);
      const clear = distinctPhotos(ranked.filter((entry) => entry.clear));
      if (!includeBlurry && (clear.length === 0 || VISUALLY_HELD_STACKS.has(group.id))) {
        excluded.push({
          stackId: group.id,
          faces: reviewableMembers.length,
          reason: VISUALLY_HELD_STACKS.has(group.id)
            ? "all views are visibly occluded or degraded"
            : "no clear representative",
          keys: reviewableMembers.map((member) => member.key),
        });
        continue;
      }
      // The large face plus two supporting views make the stack visible as a
      // stack, not merely a count. In --include-blurry mode the best available
      // views are used, but the normal Rach pass never promotes a blurry one.
      const representatives = (includeBlurry ? distinctPhotos(ranked) : clear).slice(0, 3);
      const best = representatives[0]?.item;
      if (!best) continue;
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
      const suggestions = new Map();
      const rejectedCandidates =
        rejectedCandidatesByStack.get(group.id) ?? new Set();
      for (const name of coTagNames) {
        for (const candidate of missingBySurname.get(name.split(" ").pop().toLowerCase()) ?? []) {
          if (!rejectedCandidates.has(candidate.slug)) {
            suggestions.set(candidate.slug, candidate.name);
          }
        }
      }
      stacks.push({
        id: group.id,
        members,
        openCount: reviewableMembers.length,
        best,
        representatives,
        photoCount: photos.size,
        coTags: coTagNames.slice(0, 4),
        suggestions: [...suggestions.values()].slice(0, 3),
      });
  }

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
    const height = rows * (IMAGE_HEIGHT + CAPTION + PAD) + PAD + HEADER;
    const composites = [];
    const labels = [];

    for (const [cellIndex, stack] of page.entries()) {
      number += 1;
      index.push({
        number,
        stackId: stack.id,
        faces: stack.members.length,
        openFaces: stack.openCount,
        photos: stack.photoCount,
        coTags: stack.coTags,
        representativeKeys: stack.representatives.map((entry) => entry.item.key),
        keys: stack.members.map((member) => member.key),
      });

      const column = cellIndex % COLS;
      const row = Math.floor(cellIndex / COLS);
      const left = PAD + column * (CELL + PAD);
      const top = HEADER + row * (IMAGE_HEIGHT + CAPTION + PAD);

      const reps = stack.representatives.map((entry) => entry.item);
      const slots =
        reps.length === 1
          ? [{ item: reps[0], left, top, width: CELL, height: IMAGE_HEIGHT, padding: 1.7 }]
          : reps.length === 2
            ? [
                {
                  item: reps[0],
                  left,
                  top,
                  width: MAIN_FACE_WIDTH,
                  height: IMAGE_HEIGHT,
                  padding: 1.7,
                },
                {
                  item: reps[1],
                  left: left + MAIN_FACE_WIDTH,
                  top,
                  width: SUPPORT_FACE_WIDTH,
                  height: IMAGE_HEIGHT,
                  padding: 1.55,
                },
              ]
            : [
                {
                  item: reps[0],
                  left,
                  top,
                  width: MAIN_FACE_WIDTH,
                  height: IMAGE_HEIGHT,
                  padding: 1.7,
                },
                {
                  item: reps[1],
                  left: left + MAIN_FACE_WIDTH,
                  top,
                  width: SUPPORT_FACE_WIDTH,
                  height: IMAGE_HEIGHT / 2,
                  padding: 1.5,
                },
                {
                  item: reps[2],
                  left: left + MAIN_FACE_WIDTH,
                  top: top + IMAGE_HEIGHT / 2,
                  width: SUPPORT_FACE_WIDTH,
                  height: IMAGE_HEIGHT / 2,
                  padding: 1.5,
                },
              ];
      for (const slot of slots) {
        const buffer = await renderFaceCrop(
          slot.item,
          slot.width,
          slot.height,
          slot.padding,
        );
        if (buffer) composites.push({ input: buffer, left: slot.left, top: slot.top });
      }

      const coverage = `${stack.openCount} faces · ${stack.photoCount} photos`;
      const withLine = stack.coTags.length
        ? `with ${ellipsize(stack.coTags.join(", "), 34)}`
        : "nobody else named here";
      labels.push(
        `<text x="${left}" y="${top - 8}" font-family="Helvetica" font-size="21" font-weight="bold" fill="#2b2118">${number}</text>`,
        `<text x="${left + 30}" y="${top - 8}" font-family="Helvetica" font-size="14" fill="#6f5f4d">${escapeXml(coverage)}</text>`,
        `<text x="${left}" y="${top + IMAGE_HEIGHT + 22}" font-family="Helvetica" font-size="13.5" fill="#4a3f33">${escapeXml(withLine)}</text>`,
        stack.suggestions.length
          ? `<text x="${left}" y="${top + IMAGE_HEIGHT + 42}" font-family="Helvetica" font-size="13" font-weight="bold" fill="#a8451f">${escapeXml(ellipsize(`maybe ${stack.suggestions.join(" / ")}`, 43))}</text>`
          : `<text x="${left}" y="${top + IMAGE_HEIGHT + 42}" font-family="Helvetica" font-size="12" fill="#8a7862">${escapeXml(ellipsize(stack.best.event, 36))}</text>`,
      );
    }

    const sheetNumber = Math.floor(offset / perSheet) + 1;
    const heading =
      `clear nameless stacks ${number - page.length + 1} to ${number}  ·  sheet ${sheetNumber}`;
    const answerHint = `answer like “1 Name, 2 Name”   ·   still unphotographed: ${ellipsize(missingGuests.map((guest) => guest.name).join(", "), 120)}`;
    composites.push({
      input: Buffer.from(
        `<svg width="${width}" height="${height}">` +
          `<text x="${PAD}" y="24" font-family="Helvetica" font-size="16" font-weight="bold" fill="#4a3f33">${escapeXml(heading)}</text>` +
          `<text x="${PAD}" y="49" font-family="Helvetica" font-size="13" fill="#8a7862">${escapeXml(answerHint)}</text>` +
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
    `${JSON.stringify(
      {
        builtFrom: model.buildFingerprint,
        mode: includeBlurry ? "all-open-stacks" : "clear-open-stacks",
        summary: {
          stacks: index.length,
          faces: index.reduce((total, entry) => total + entry.openFaces, 0),
          excludedStacks: excluded.length,
          excludedFaces: excluded.reduce((total, entry) => total + entry.faces, 0),
        },
        stacks: index,
        excluded,
      },
      null,
      1,
    )}\n`,
  );

  const covered = index.reduce((total, entry) => total + entry.openFaces, 0);
  console.log(
    `${index.length} stacks covering ${covered} faces on ` +
      `${Math.ceil(index.length / perSheet)} sheets in ${OUT_DIR}`,
  );
  if (excluded.length) {
    console.log(
      `Held back ${excluded.length} stacks covering ` +
        `${excluded.reduce((total, entry) => total + entry.faces, 0)} faces with no clear view.`,
    );
    console.log("Re-run with --include-blurry to render those too.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
