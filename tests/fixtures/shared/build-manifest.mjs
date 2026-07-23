// Builds manifest.json for tests/fixtures/shared/
// Usage (from repo root): node tests/fixtures/shared/build-manifest.mjs

import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

const FILES = [
  ['synthetic-1-tiny.jpg',  'image/jpeg', true,  'Valid tiny JPEG (64px). Fast-path decode, thumbnail, and dedupe tests.'],
  ['synthetic-1-phone.jpg', 'image/jpeg', true,  'Valid phone-scale JPEG (3000x2000). Upload, resize, and EXIF-free baseline tests.'],
  ['synthetic-2-tiny.png',  'image/png',  true,  'Valid tiny PNG (64px). Lossless format acceptance tests.'],
  ['synthetic-2-phone.png', 'image/png',  true,  'Valid phone-scale PNG (3000x2000). Large lossless upload tests.'],
  ['synthetic-3-tiny.webp', 'image/webp', true,  'Valid tiny WebP (64px). Modern-format acceptance tests.'],
  ['synthetic-3-phone.webp','image/webp', true,  'Valid phone-scale WebP (3000x2000). Modern-format large upload tests.'],
  ['synthetic-4.heic',      'image/heic', true,  'Valid HEIC (1024x768, sips-converted from sharp JPEG). iPhone-format detection and conversion tests.'],
  ['fake.jpg',              'text/plain', false, 'INVALID: plain text bytes with .jpg extension. MIME/magic mismatch; must be rejected by magic-byte sniffing.'],
  ['truncated.jpg',         'image/jpeg', false, 'INVALID: first 16384 bytes of synthetic-1-phone.jpg. Valid JPEG SOI header, no EOI; full decode must fail (sharp: "premature end of JPEG image").'],
  ['tiny-svg.svg',          'image/svg+xml', false, 'INVALID by policy: well-formed SVG, a must-reject upload type (script/XSS surface). Reject by MIME/extension allowlist.'],
];

function magicSummary(buf) {
  const hex = buf.subarray(0, 12).toString('hex').replace(/(..)/g, '$1 ').trim();
  let note = 'no known image signature';
  if (buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) note = 'JPEG SOI (ff d8 ff)';
  else if (buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) note = 'PNG signature (89 "PNG" 0d 0a 1a 0a)';
  else if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') note = 'RIFF/WEBP container';
  else if (buf.subarray(4, 8).toString('latin1') === 'ftyp') note = `ISO BMFF: "ftyp" at offset 4, brand "${buf.subarray(8, 12).toString('latin1')}" at offset 8`;
  else if (buf.subarray(0, 4).toString('latin1') === '<svg') note = 'XML/SVG text, no binary signature';
  else if (/^[\x09\x0a\x0d\x20-\x7e]+$/.test(buf.subarray(0, 12).toString('latin1'))) note = 'plain ASCII text, no binary signature';
  return { first_12_bytes_hex: hex, note };
}

const entries = [];
for (const [name, mime, isValidImage, purpose] of FILES) {
  const buf = readFileSync(join(DIR, name));
  const entry = {
    file: name,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    mime_actual: mime,
    magic: magicSummary(buf),
    valid_image: isValidImage,
    purpose,
  };
  if (isValidImage) {
    const m = await sharp(buf).metadata();
    entry.dimensions = { width: m.width, height: m.height };
    entry.sharp_format = m.format;
  }
  entries.push(entry);
}

const manifest = {
  pack: 'shared synthetic test fixtures',
  generated: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()),
  generator: 'generate-fixtures.mjs + sips (see README.md)',
  sharp_version: sharp.versions.sharp,
  libvips_version: sharp.versions.vips,
  note: 'All images are procedurally generated gradients and solid colors. No real photos, no faces, no EXIF.',
  files: entries,
};

writeFileSync(join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest.json written with ${entries.length} entries`);
