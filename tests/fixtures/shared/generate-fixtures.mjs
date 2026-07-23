// Synthetic test-fixture generator for tests/fixtures/shared/
// All images are procedurally generated (solid colors + gradients). No real photos, no faces.
//
// Usage (from repo root):
//   node tests/fixtures/shared/generate-fixtures.mjs
// Then convert the HEIC base with macOS sips (see README.md):
//   sips -s format heic tests/fixtures/shared/.heic-base.jpg --out tests/fixtures/shared/synthetic-4.heic
//
// Deterministic: same inputs produce pixel-identical raw buffers. Encoded bytes are
// stable for a given sharp/libvips version (this pack was built with sharp 0.35.3).

import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));

const TINY = { w: 64, h: 64 };
const PHONE = { w: 3000, h: 2000 };

// Build a raw RGB buffer from a per-pixel color function.
function rawImage(w, h, fn) {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x / (w - 1), y / (h - 1));
      const i = (y * w + x) * 3;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
    }
  }
  return buf;
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

// Pattern 1 (JPEG): horizontal gradient teal -> coral with a solid navy band.
const pat1 = (u, v) => (v > 0.4 && v < 0.6) ? [16, 42, 84] : mix([0, 128, 128], [255, 127, 80], u);
// Pattern 2 (PNG): vertical gradient purple -> gold with a solid white band.
const pat2 = (u, v) => (u > 0.45 && u < 0.55) ? [255, 255, 255] : mix([96, 32, 160], [255, 200, 40], v);
// Pattern 3 (WebP): diagonal gradient forest -> sky over a solid charcoal corner.
const pat3 = (u, v) => (u < 0.15 && v < 0.15) ? [40, 40, 48] : mix([24, 96, 48], [96, 168, 255], (u + v) / 2);
// Pattern 4 (HEIC base JPEG): horizontal gradient magenta -> cyan with a solid black band.
const pat4 = (u, v) => (v > 0.7 && v < 0.8) ? [0, 0, 0] : mix([200, 32, 160], [32, 200, 220], u);

async function make(name, { w, h }, fn, format, options) {
  const img = sharp(rawImage(w, h, fn), { raw: { width: w, height: h, channels: 3 } });
  const outPath = join(OUT, name);
  await img.toFormat(format, options).toFile(outPath);
  console.log(`wrote ${name} (${w}x${h} ${format})`);
}

await make('synthetic-1-tiny.jpg', TINY, pat1, 'jpeg', { quality: 85 });
await make('synthetic-1-phone.jpg', PHONE, pat1, 'jpeg', { quality: 85 });
await make('synthetic-2-tiny.png', TINY, pat2, 'png', { compressionLevel: 9 });
await make('synthetic-2-phone.png', PHONE, pat2, 'png', { compressionLevel: 9 });
await make('synthetic-3-tiny.webp', TINY, pat3, 'webp', { quality: 85 });
await make('synthetic-3-phone.webp', PHONE, pat3, 'webp', { quality: 85 });
// Base JPEG for the sips HEIC conversion. Hidden dotfile; not itself a fixture.
await make('.heic-base.jpg', { w: 1024, h: 768 }, pat4, 'jpeg', { quality: 90 });

// Invalid case: plain text bytes with a .jpg name (MIME/magic mismatch).
writeFileSync(join(OUT, 'fake.jpg'),
  'This is not an image. It is a plain text file renamed to fake.jpg to test magic-byte validation.\n');
console.log('wrote fake.jpg (text masquerading as JPEG)');

// Invalid case: must-reject type (SVG can carry scripts; galleries should reject it).
writeFileSync(join(OUT, 'tiny-svg.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#602aa0"/></svg>\n');
console.log('wrote tiny-svg.svg (must-reject type)');

console.log('done (truncated.jpg and synthetic-4.heic are produced by follow-up commands, see README.md)');
