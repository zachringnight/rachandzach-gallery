# Shared synthetic test fixtures

Use these files for any test that needs consistent synthetic media: uploads, moderation, e2e. Everything here is procedurally generated (solid colors and gradients). No real photos, no faces, no EXIF, no personal data. `manifest.json` carries byte size, SHA-256, dimensions, actual MIME, magic-byte summary, and intended purpose for every file; treat it as the source of truth when asserting on fixture properties.

## Contents

Valid images (all fully decode with sharp):

| File | Format | Size | Pattern |
|---|---|---|---|
| `synthetic-1-tiny.jpg` | JPEG | 64x64 | horizontal teal-to-coral gradient, navy band |
| `synthetic-1-phone.jpg` | JPEG | 3000x2000 | same pattern at phone scale |
| `synthetic-2-tiny.png` | PNG | 64x64 | vertical purple-to-gold gradient, white band |
| `synthetic-2-phone.png` | PNG | 3000x2000 | same pattern at phone scale |
| `synthetic-3-tiny.webp` | WebP | 64x64 | diagonal forest-to-sky gradient, charcoal corner |
| `synthetic-3-phone.webp` | WebP | 3000x2000 | same pattern at phone scale |
| `synthetic-4.heic` | HEIC | 1024x768 | magenta-to-cyan gradient, black band; real HEIC produced by macOS `sips` |

Invalid or must-reject cases:

| File | What it is | What it tests |
|---|---|---|
| `fake.jpg` | plain text bytes named `.jpg` | MIME/magic mismatch; magic-byte sniffing must reject |
| `truncated.jpg` | first 16384 bytes of `synthetic-1-phone.jpg` | valid JPEG SOI header, no EOI marker; full decode must fail |
| `tiny-svg.svg` | well-formed 115-byte SVG | must-reject upload type (script/XSS surface); reject by allowlist |

Notes:

- The phone-scale files compress far below 3 MB because gradients compress extremely well. If a test needs a near-limit payload, pad or generate separately; do not add large binaries to this pack.
- `synthetic-4.heic` begins `00 00 00 24 66 74 79 70 68 65 69 63`: ISO BMFF `ftyp` box at offset 4 with brand `heic` at offset 8. sharp 0.35.3 in this repo reads its metadata (`heif`, 1024x768). Full pixel decode depends on libvips being built with a HEIF decoder, so prefer metadata or magic-byte assertions for HEIC in tests.
- sharp-generated JPEGs here start `ff d8 ff db` (SOI then DQT, no JFIF APP0 segment). Any correct JPEG sniffer matches on `ff d8 ff`; a sniffer that demands `ff d8 ff e0` is a bug these fixtures will catch.

## Regeneration (reproducible)

From the repo root:

```bash
# 1. Generate all sharp-produced files (valid images, fake.jpg, tiny-svg.svg,
#    and .heic-base.jpg used only as sips input)
node tests/fixtures/shared/generate-fixtures.mjs

# 2. Convert the base JPEG to HEIC with macOS sips
sips -s format heic tests/fixtures/shared/.heic-base.jpg --out tests/fixtures/shared/synthetic-4.heic
rm tests/fixtures/shared/.heic-base.jpg

# 3. Create the truncated JPEG (valid header, cut bytes)
head -c 16384 tests/fixtures/shared/synthetic-1-phone.jpg > tests/fixtures/shared/truncated.jpg

# 4. Rebuild the manifest (sizes, SHA-256, dimensions, magic bytes)
node tests/fixtures/shared/build-manifest.mjs
```

Raw pixel buffers are fully deterministic. Encoded bytes (and therefore SHA-256 values) are stable for a given encoder version; this pack was built with sharp 0.35.3 / libvips 8.18.3 and macOS sips. If either changes, rerun step 4 so the manifest hashes match the bytes on disk.

## Verification commands

```bash
# every valid raster image fully decodes
for f in synthetic-1-tiny.jpg synthetic-1-phone.jpg synthetic-2-tiny.png \
         synthetic-2-phone.png synthetic-3-tiny.webp synthetic-3-phone.webp; do
  node -e "require('sharp')('tests/fixtures/shared/$f').raw().toBuffer({resolveWithObject:true}).then(({info})=>console.log('$f OK',info.width+'x'+info.height))"
done

# HEIC magic bytes: ftyp at offset 4, heic brand at offset 8
xxd -l 16 tests/fixtures/shared/synthetic-4.heic

# invalid cases fail as intended
node -e "require('sharp')('tests/fixtures/shared/fake.jpg').raw().toBuffer().catch(e=>console.log('rejected:',e.message))"
node -e "require('sharp')('tests/fixtures/shared/truncated.jpg').raw().toBuffer().catch(e=>console.log('rejected:',e.message))"
```
