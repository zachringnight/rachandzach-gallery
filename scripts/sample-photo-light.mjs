#!/usr/bin/env node
// P3/P4 (design upgrade plan): sample the dominant LIGHT of every catalog
// photograph, plus a 64-bit perceptual hash, into a committed build artifact.
//
// The Light Bar (P3) renders its rail tints from this data and the contact
// sheet (P4) clusters near-duplicate bursts with the hash. Everything here is
// derived from the photographs themselves -- no hand-authored gradients.
//
// This runs entirely LOCALLY against the import pipeline's preview
// derivatives (metadata/import/derivatives/previews/{imageDataHash}/480.webp).
// It performs zero network and zero database operations, and never touches
// the read-only clean master. The long-term home for these values is a cached
// column written at import time (see the P3 report); until that migration is
// authorized, this JSON is the cache.
//
// Usage:
//   node scripts/sample-photo-light.mjs \
//     [--catalog src/generated/gallery-v2.json] \
//     [--previews-dir metadata/import/derivatives/previews] \
//     [--out src/generated/photo-light.json]
import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

const catalogPath = resolve(
  repoRoot,
  argValue("--catalog", "src/generated/gallery-v2.json"),
);
const previewsDir = resolve(
  repoRoot,
  argValue("--previews-dir", "metadata/import/derivatives/previews"),
);
const outPath = resolve(
  repoRoot,
  argValue("--out", "src/generated/photo-light.json"),
);

const SAMPLE_SIZE = 32; // tint sampling grid
const HASH_W = 9; // dHash: 9x8 grayscale, 64 comparisons
const HASH_H = 8;

/** Relative luminance (0-255) of an sRGB pixel, cheap approximation. */
function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Dominant light: average the pixels in the upper-middle luminance band
 * (50th-95th percentile). That band is where the scene's LIGHT lives --
 * sky, windows, candlelight, dance-floor wash -- rather than shadows or
 * clipped highlights, so morning frames sample cool and the reception
 * samples warm without any manual color decisions.
 */
function dominantLight(pixels) {
  const withLum = [];
  for (let i = 0; i < pixels.length; i += 3) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    withLum.push({ r, g, b, l: luminance(r, g, b) });
  }
  withLum.sort((a, b) => a.l - b.l);
  const from = Math.floor(withLum.length * 0.5);
  const to = Math.max(from + 1, Math.floor(withLum.length * 0.95));
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = from; i < to; i += 1) {
    r += withLum[i].r;
    g += withLum[i].g;
    b += withLum[i].b;
  }
  const n = to - from;
  const meanLum =
    withLum.reduce((sum, px) => sum + px.l, 0) / (withLum.length * 255);
  return {
    tint: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
    lum: Math.round(meanLum * 100) / 100,
  };
}

function toHex([r, g, b]) {
  return [r, g, b]
    .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"))
    .join("");
}

/** 64-bit dHash over a 9x8 grayscale reduction, hex-encoded (16 chars). */
function dHash(gray) {
  let bits = 0n;
  for (let y = 0; y < HASH_H; y += 1) {
    for (let x = 0; x < HASH_W - 1; x += 1) {
      const left = gray[y * HASH_W + x];
      const right = gray[y * HASH_W + x + 1];
      bits = (bits << 1n) | (left < right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

async function samplePhoto(hash) {
  const file = join(previewsDir, hash, "480.webp");
  const image = sharp(await fs.readFile(file));
  const [tintRaw, hashRaw] = await Promise.all([
    image
      .clone()
      .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer(),
    image
      .clone()
      .grayscale()
      .resize(HASH_W, HASH_H, { fit: "fill" })
      .raw()
      .toBuffer(),
  ]);
  const { tint, lum } = dominantLight(tintRaw);
  return { t: toHex(tint), l: lum, p: dHash(hashRaw) };
}

async function main() {
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  const hashes = [
    ...new Set(catalog.photos.map((photo) => photo.imageDataHash)),
  ];
  const photos = {};
  const missing = [];
  let done = 0;

  const CONCURRENCY = 8;
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= hashes.length) return;
      const hash = hashes[index];
      try {
        photos[hash] = await samplePhoto(hash);
      } catch (error) {
        if (error && error.code === "ENOENT") missing.push(hash);
        else throw error;
      }
      done += 1;
      if (done % 250 === 0) {
        process.stderr.write(`sampled ${done}/${hashes.length}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const ordered = {};
  for (const hash of [...hashes].sort()) {
    if (photos[hash]) ordered[hash] = photos[hash];
  }
  const artifact = {
    version: 1,
    generatedAt: new Date().toISOString(),
    method: {
      source: "480.webp preview derivative",
      tint: "mean sRGB of the 50th-95th luminance percentile over a 32x32 grid",
      lum: "mean relative luminance, 0-1",
      p: "64-bit dHash (9x8 grayscale, row-wise), hex",
    },
    photos: ordered,
  };
  await fs.writeFile(outPath, `${JSON.stringify(artifact)}\n`);
  process.stderr.write(
    `wrote ${Object.keys(ordered).length} entries to ${outPath}` +
      (missing.length ? `; MISSING previews for ${missing.length}` : "") +
      "\n",
  );
  if (missing.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
