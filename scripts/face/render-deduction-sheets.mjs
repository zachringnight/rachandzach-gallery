#!/usr/bin/env node
/**
 * Render the by-elimination deductions for a human to confirm or deny.
 *
 * deduce-unmatched-tags.mjs works out which face a name already on a
 * photograph belongs to. This shows the work: the deduced face beside that
 * person's saved profile, so agreement or disagreement is visible at a
 * glance. People with no saved profile are rendered first and have no
 * comparison to show, which is exactly why they matter most: the deduction
 * would be their first face.
 *
 *   node scripts/face/render-deduction-sheets.mjs
 */
import { promises as fs, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(repoRoot, "metadata/faces/deduction-sheets");
const FACE = 260, PAD = 16, CAPTION = 62, COLS = 4, HEADER = 46;

function esc(v) { return String(v).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]); }
function ell(v, n) { return v.length <= n ? v : `${v.slice(0, n - 1)}…`; }

const deduced = JSON.parse(await fs.readFile(join(repoRoot, "metadata/faces/deduced.json"), "utf8"));
const catalog = JSON.parse(await fs.readFile(join(repoRoot, "src/generated/gallery-v2.json"), "utf8"));
const byHash = new Map(catalog.photos.map((p) => [p.imageDataHash, p]));

const detections = new Map();
for (const line of (await fs.readFile(join(repoRoot, "metadata/faces/detections.jsonl"), "utf8")).split("\n")) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  detections.set(r.photoId, r);
}

const rows = deduced.sole.slice();
await fs.mkdir(OUT, { recursive: true });
for (const stale of await fs.readdir(OUT).catch(() => [])) if (stale.endsWith(".jpg")) await fs.unlink(join(OUT, stale));

const PER = 12;
let n = 0;
const index = [];
for (let off = 0; off < rows.length; off += PER) {
  const page = rows.slice(off, off + PER);
  const gridRows = Math.ceil(page.length / COLS);
  const cellW = FACE * 2 + 8;
  const W = COLS * (cellW + PAD) + PAD;
  const H = gridRows * (FACE + CAPTION + PAD) + PAD + HEADER;
  const comps = [], labels = [];
  for (const [i, row] of page.entries()) {
    n += 1;
    const person = row.names[0];
    index.push({ number: n, photoId: row.photoId, path: row.path, slug: person.slug, faceIndex: row.faceIndexes[0] });
    const col = i % COLS, gr = Math.floor(i / COLS);
    const left = PAD + col * (cellW + PAD), top = HEADER + gr * (FACE + CAPTION + PAD);
    const prev = join(repoRoot, `metadata/import/derivatives/previews/${row.photoId}/1600.webp`);
    if (existsSync(prev)) {
      const det = detections.get(row.photoId);
      const face = det?.faces?.find((f) => f.i === row.faceIndexes[0]);
      if (face) {
        const meta = await sharp(prev).metadata();
        const s = Math.max(meta.width, meta.height) / Math.max(det.dw, det.dh);
        const [x1, y1, x2, y2] = face.bbox.map((v) => v * s);
        const size = Math.round(Math.max(x2 - x1, y2 - y1) * 1.8);
        const cl = Math.max(0, Math.min(meta.width - 8, Math.round((x1 + x2) / 2 - size / 2)));
        const ct = Math.max(0, Math.min(meta.height - 8, Math.round((y1 + y2) / 2 - size / 2)));
        comps.push({ input: await sharp(prev).extract({ left: cl, top: ct, width: Math.min(size, meta.width - cl), height: Math.min(size, meta.height - ct) }).resize(FACE, FACE, { fit: "cover" }).toBuffer(), left, top });
      }
    }
    // The Find me thumbnail, which exists for many people who have no learned
    // signature (it can come from a hand-picked crop). Those are different
    // things and conflating them mislabelled the whole first sheet.
    const saved = join(repoRoot, `public/faces/${person.slug}.webp`);
    const hasThumb = existsSync(saved);
    if (hasThumb) {
      comps.push({ input: await sharp(saved).resize(FACE, FACE, { fit: "cover" }).toBuffer(), left: left + FACE + 8, top });
    }
    labels.push(
      `<text x="${left}" y="${top - 6}" font-family="Helvetica" font-size="18" font-weight="bold" fill="#2b2118">${n}</text>`,
      `<text x="${left + 26}" y="${top - 6}" font-family="Helvetica" font-size="15" fill="#2b2118">${esc(person.name)}</text>`,
      `<text x="${left + 26 + person.name.length * 8.4}" y="${top - 6}" font-family="Helvetica" font-size="12" fill="${person.hasProfile ? "#8a7862" : "#a8451f"}">${hasThumb ? (person.hasProfile ? "  deduced | saved" : "  deduced | saved (no signature yet)") : "  no saved face to compare"}</text>`,
      `<text x="${left}" y="${top + FACE + 20}" font-family="Helvetica" font-size="12" fill="#6f5f4d">${esc(ell(row.path, 44))}</text>`,
    );
  }
  const sheet = Math.floor(off / PER) + 1;
  comps.push({ input: Buffer.from(`<svg width="${W}" height="${H}"><text x="${PAD}" y="26" font-family="Helvetica" font-size="15" fill="#8a7862">deduced by elimination ${n - page.length + 1} to ${n} · sheet ${sheet} · left = the deduced face, right = that person's saved face</text>${labels.join("")}</svg>`), top: 0, left: 0 });
  await sharp({ create: { width: W, height: H, channels: 3, background: "#f7f3eb" } }).composite(comps).jpeg({ quality: 88 }).toFile(join(OUT, `sheet-${String(sheet).padStart(3, "0")}.jpg`));
}
await fs.writeFile(join(OUT, "index.json"), `${JSON.stringify({ rows: index }, null, 1)}\n`);
console.log(`${index.length} deductions on ${Math.ceil(index.length / PER)} sheets in ${OUT}`);
