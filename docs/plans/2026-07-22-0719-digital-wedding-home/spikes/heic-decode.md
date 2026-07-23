# Spike: Server-side HEIC validation + conversion (stock sharp cannot decode HEIC)

Researched 2026-07-22 against live sources. Stack context: Next.js 16.2, React 19.2, Supabase Postgres + private Storage, Vercel (Node runtime, Fluid compute), Node 26 locally.

## Recommendation (act on this)

Use **`heic-decode` (v2.1.0, wraps `libheif-js` 1.19.8 wasm) to decode guest HEICs to raw RGBA inside a Vercel Node function at moderation/approval time, then pipe the raw pixels into stock `sharp` for resize + JPEG/WebP derivative encoding**. Validate uploads at submit time by sniffing the `ftyp` box magic bytes (brands `heic`, `heix`, `hevc`, `hevx`, `mif1`, `msf1`). Originals must go **directly to Supabase Storage via signed upload URLs** (Vercel's 4.5 MB body limit makes proxying a 10-50 MB HEIC through a function impossible); the moderation function downloads from Storage, decodes one photo per invocation, and uploads derivatives back. This fits comfortably inside Vercel limits (2 GB memory, 300 s default duration).

Primary mitigation to reduce HEIC volume at the source: set `accept="image/jpeg,image/png,image/webp"` on the file input. iOS Safari transcodes HEIC to JPEG automatically when the accept list excludes HEIC. Treat server-side HEIC decode as the safety net for files that arrive as HEIC anyway (drag-drop on desktop, AirDropped originals, Android HEIF, accept-attribute bypass).

Fallback if the wasm path proves unfit in practice (see "Fallback plan" below): client-side convert with `heic-to` before upload, and as last resort reject at submit with a guest-facing message asking for JPEG.

## Why (verified findings)

### 1. Stock sharp still cannot decode HEIC, and this will not change

- Current sharp is **v0.35.3** (published 2026-07-01, npm registry). The install docs list prebuilt-binary input formats as: JPEG, PNG, Ultra HDR, WebP, **AVIF**, TIFF, GIF, SVG. HEIC is absent.
- The output-options docs state verbatim: "Support for patent-encumbered HEIC images using `hevc` compression requires the use of a globally-installed libvips compiled with support for libheif, libde265 and x265." A globally installed custom libvips is not possible on Vercel's managed Node runtime. This is a patent-licensing exclusion (Nokia HEVC/HEIF pools), not a temporary gap.
- The optional `@img/sharp-wasm32` build mirrors the same format set; it does not add HEIC.
- Note the asymmetry: sharp DOES handle **AVIF** natively (AV1 is royalty-free). Only HEVC-compressed HEIC/HEIF is excluded. So the pipeline only needs the wasm decoder for the HEIC branch; every other format goes straight through sharp.

### 2. Library landscape (npm registry, checked 2026-07-22)

| Package | Latest | Published | Verdict |
|---|---|---|---|
| `heic-decode` | 2.1.0 | 2025-07-04 | **Pick.** Thin wrapper over libheif-js. Returns ImageData-shaped `{width, height, data: Uint8ClampedArray}` (RGBA). ISC license, deps: `libheif-js ^1.19.8` only. `@types/heic-decode` 2.0.0 exists (2026-04-30). Repo: catdad-experiments/heic-decode, active. |
| `libheif-js` | 1.19.8 | 2025-06-12 | The underlying Emscripten wasm build of libheif 1.19.8 (with libde265 HEVC decoder). LGPL-3.0. ~6.4 MB unpacked, no deps, engines node >=8. Use indirectly via heic-decode; use directly only if you need multi-image internals. |
| `heic-convert` | 2.1.0 | 2023-11-30 | Skip. Same decoder underneath but encodes with pure-JS `jpeg-js`/`pngjs`: slower, larger output, no resize. We already have sharp for encoding. |
| `wasm-vips` | 0.0.18 | 2026-06-09 | **Ruled out for HEIC.** Verified in its build.sh: libheif is compiled with `-DWITH_LIBDE265=OFF -DWITH_X265=OFF`, i.e. AVIF only, no HEVC decode. |
| `heic-to` | 1.5.2 | 2026-05-26 | Browser-side libheif wasm converter. This is the client-side fallback, not the server path. |
| `node-libheif` | 1.12.0-rc.1 | 2021-06-06 | Dead (native bindings, prerelease, 5 years stale). |
| `@saschazar/wasm-heif` | 2.0.0 | 2021-04-15 | Dead. |

Node 26 compatibility: heic-decode/libheif-js are plain CJS + Emscripten wasm, engines `>=8`, no native addons, nothing Node-version-sensitive. Also note the runtime reality: **Vercel functions run Node 24.x (default), 22.x, or 20.x** as of the current docs, not Node 26; local Node 26 is only your dev machine. Wasm behaves identically on both. Pin with `"engines": { "node": "24.x" }` in package.json awareness (Vercel maps `>=20` ranges to latest 24.x).

Performance and memory (estimates; no authoritative published benchmark exists, flagged for a build-time sanity test):

- Decoded RGBA size is the dominating memory cost: 12 MP (4032x3024) = ~49 MB; 24 MP = ~97 MB; 48 MP (8064x6048) = ~195 MB. Plus the 10-50 MB compressed input, wasm heap overhead, and sharp's output buffer. Worst case stays comfortably under the 2 GB function memory floor when processing **one photo per invocation**.
- Single-threaded wasm HEVC decode is slow relative to native (libheif was reported ~50x slower than iOS hardware decode): expect roughly 2-10 s for a 12-24 MP iPhone HEIC and up to ~20-40 s for a 48 MP ProRAW-adjacent HEIC in a 1 vCPU function. Against a 300 s default `maxDuration` this is comfortable. Benchmark with one real 48 MP file during build and bump `maxDuration` to 300 explicitly on the moderation route.
- heic-decode's readme warns the decode work is synchronous. Under Vercel Fluid compute, invocations can share an instance, so a long sync decode blocks other requests routed to that instance. For a wedding-gallery moderation queue (single admin, low volume) this is acceptable; if it ever matters, move the decode into a `node:worker_threads` worker as the readme suggests.
- Bundle size: libheif-js adds ~6.4 MB unpacked. Trivial against the 250 MB function limit.

### 3. Vercel limits that shape the flow (docs last updated 2026-07-01)

- **Request/response body: 4.5 MB hard limit** (413 FUNCTION_PAYLOAD_TOO_LARGE). This is the binding constraint: guest HEICs (10-50 MB) can NEVER transit a function body. Uploads must go browser -> Supabase Storage directly via `createSignedUploadUrl` (or TUS resumable for flaky venue Wi-Fi). Downloads inside the function (Storage -> function over supabase-js) are ordinary outbound fetches, not subject to this limit.
- Memory: Hobby 2 GB / 1 vCPU (fixed); Pro default 2 GB, max 4 GB / 2 vCPU. 2 GB is enough.
- Duration: 300 s default on all plans (Fluid); Hobby max 300 s; Pro max 800 s. Decode-at-moderation of a single photo fits with a wide margin.
- Function bundle: 250 MB uncompressed standard. No issue.
- Supabase Storage per-file cap: **50 MB max on the free plan** (500 GB on Pro). A 48 MP HEIC can brush against 50 MB. Either accept the rare rejection on free tier, or be on Pro and set the global upload limit + per-bucket limit (`file_size_limit`) to ~60 MB with `allowed_mime_types` on the originals bucket.

### 4. Magic-byte validation (verified against sindresorhus/file-type source)

ISO-BMFF layout: bytes 0-3 = big-endian box size, bytes 4-7 = ASCII `ftyp`, bytes 8-11 = major brand, bytes 16..boxSize = compatible brands (4 bytes each).

Accept these major brands as HEIC/HEIF:

| Major brand | Meaning |
|---|---|
| `heic`, `heix` | HEIC still image (the normal iPhone case) -> image/heic |
| `hevc`, `hevx` | HEIC image sequence (bursts/Live Photo stills) -> image/heic-sequence |
| `mif1` | Structural HEIF brand -> image/heif. Caution: some AVIF encoders also use `mif1` as major brand. When major is `mif1`, scan the compatible-brands list: `heic`/`heix`/`hevc`/`hevx` -> HEIC path; `avif`/`avis` -> hand to sharp directly. |
| `msf1` | HEIF sequence -> image/heif-sequence |

`avif`/`avis` majors are AVIF: valid uploads, but route to sharp natively, not to heic-decode.

## Exact APIs and snippets

Validation helper (submit-time and re-verified at approval; never trust client MIME or extension):

```ts
// lib/sniff.ts
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx']);
const HEIF_STRUCTURAL = new Set(['mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

export type SniffResult = 'heic' | 'avif' | 'jpeg' | 'png' | 'webp' | 'unknown';

export function sniffImage(buf: Uint8Array): SniffResult {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';

  // ISO-BMFF: 'ftyp' at offset 4, major brand at offset 8
  if (buf.length >= 16 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const latin1 = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]).trim();
    const major = latin1(8);
    if (HEIC_BRANDS.has(major)) return 'heic';
    if (AVIF_BRANDS.has(major)) return 'avif';
    if (HEIF_STRUCTURAL.has(major)) {
      const boxSize = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
      for (let o = 16; o + 4 <= Math.min(boxSize, buf.length); o += 4) {
        const b = latin1(o);
        if (HEIC_BRANDS.has(b)) return 'heic';
        if (AVIF_BRANDS.has(b)) return 'avif';
      }
      return 'heic'; // structural HEIF with no decisive brand: try the HEIC path, it fails safely
    }
  }
  return 'unknown';
}
```

Decode + derive at approval time (one photo per invocation):

```ts
// app/api/moderation/approve/route.ts (Node runtime)
export const maxDuration = 300;

import decode from 'heic-decode'; // needs esModuleInterop; types via @types/heic-decode@2.0.0
import sharp from 'sharp';
import { sniffImage } from '@/lib/sniff';

async function toDerivatives(original: Buffer) {
  const kind = sniffImage(new Uint8Array(original.buffer, original.byteOffset, 16 + 64));

  let base: sharp.Sharp;
  if (kind === 'heic') {
    // libheif applies irot/imir transform properties during decode,
    // so pixels normally arrive correctly oriented. VERIFY once with a
    // portrait-orientation iPhone photo during build; if a rotated case
    // appears, read EXIF Orientation from the original (e.g. exifr) and
    // apply sharp.rotate(angle) explicitly - raw input carries no EXIF.
    const { width, height, data } = await decode({ buffer: original });
    base = sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      raw: { width, height, channels: 4 },
    });
  } else if (kind === 'jpeg' || kind === 'png' || kind === 'webp' || kind === 'avif') {
    base = sharp(original, { limitInputPixels: 100_000_000 }).rotate(); // .rotate() = apply EXIF orientation
  } else {
    throw new Error('unsupported-format');
  }

  const [web, thumb] = await Promise.all([
    base.clone().resize({ width: 2048, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer(),
    base.clone().resize({ width: 480, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer(),
  ]);
  return { web, thumb };
}
// Then: supabase.storage.from('derivatives').upload(...) for each, service-role client.
```

Flow summary:

1. **Submit**: browser requests a signed upload URL from an API route; uploads the original straight to the private `originals` bucket (bypasses the 4.5 MB function body limit). File input uses `accept="image/jpeg,image/png,image/webp"` so iOS transcodes most HEICs to JPEG client-side before they ever upload. Client reads the first 32 bytes and sends the sniff result + size with the metadata insert; server rejects `unknown` kinds and files > ~60 MB immediately (cheap early feedback, re-verified later).
2. **Approval (moderation)**: function downloads the original from Storage, re-runs `sniffImage` on the actual bytes (authoritative check), branches HEIC -> heic-decode -> sharp raw, everything else -> sharp direct, writes `web` + `thumb` derivatives to the serving bucket, marks the row approved. Original is retained untouched as the archival copy.
3. **Serving**: gallery only ever serves derivatives (JPEG/WebP), so browsers never need HEIC support.

Install (build agent): `npm i heic-decode` and `npm i -D @types/heic-decode`. sharp is presumably already a dependency; no sharp config changes needed.

## Fallback plan (if wasm decode proves unfit)

Trigger conditions: measured decode of a representative 48 MP HEIC exceeds ~120 s, memory errors at 2 GB, or orientation/color (10-bit HDR) fidelity is unacceptable in the build-time test.

1. **First fallback: client-side conversion before upload.** Use `heic-to` (1.5.2, 2026-05-26, same libheif wasm but running in the guest's browser) to convert HEIC -> JPEG in the upload UI when `sniffImage` on the File's first bytes says `heic`. Cost is shifted to the guest device (which decoded the photo natively moments earlier anyway). Keep the server sniff as a gate: anything still arriving as HEIC gets a moderation-queue flag instead of derivatives.
2. **Last resort: reject at submit** with guest-facing copy: "That photo is in Apple's HEIC format, which we can't process yet. In Photos, share the image and choose 'Most Compatible', or screenshot it, and upload the JPEG instead." Only acceptable if both decode paths fail, because it loses guest photos at the worst possible moment (day-of goodwill).

Known edge cases for the build agent:

- Multi-image HEIC (bursts): `decode({buffer})` returns the primary image only, which is the right behavior. `decode.all()` exists if ever needed (must call `images.dispose()` with it).
- Live Photos: the still is a normal single-image HEIC; the motion part is a separate `.mov` the file picker does not attach.
- 10-bit HDR HEICs decode to 8-bit RGBA through this path; acceptable for gallery derivatives.
- `heic-decode` is CJS; with `"moduleResolution": "bundler"` and `esModuleInterop: true` the default-import form above works in Next.js route handlers.
- Licensing footnote: libheif-js is LGPL-3.0 (fine as an unmodified npm dependency in a server app); HEVC decoding is patent-encumbered, which is exactly why sharp's prebuilds exclude it, but a personal private wedding gallery is not a realistic exposure. Recorded for completeness, not a blocker.

## Sources

- sharp install docs (prebuilt format list, v0.35.3, wasm notes): https://sharp.pixelplumbing.com/install/
- sharp output docs (HEIC/hevc requires globally-installed custom libvips with libheif+libde265+x265): https://sharp.pixelplumbing.com/api-output/
- npm registry metadata (versions/dates/deps/engines/sizes, retrieved 2026-07-22): https://registry.npmjs.org/heic-decode , https://registry.npmjs.org/libheif-js , https://registry.npmjs.org/heic-convert , https://registry.npmjs.org/sharp , https://registry.npmjs.org/wasm-vips , https://registry.npmjs.org/heic-to , https://registry.npmjs.org/@types/heic-decode
- heic-decode README (API, dispose semantics, sync-work warning): https://github.com/catdad-experiments/heic-decode
- libheif-js repo (Emscripten build of libheif 1.19.8): https://github.com/catdad-experiments/libheif-js
- wasm-vips build.sh (libheif compiled with -DWITH_LIBDE265=OFF -DWITH_X265=OFF, so no HEIC): https://github.com/kleisauke/wasm-vips/blob/master/build.sh
- file-type ftyp/brand detection source (magic-byte table): https://github.com/sindresorhus/file-type/blob/main/source/index.js
- Vercel Functions limits (4.5 MB body, 2/4 GB memory, 300/800 s duration, 250 MB bundle; last updated 2026-07-01): https://vercel.com/docs/functions/limitations
- Vercel supported Node versions (24.x default, 22.x, 20.x): https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- Supabase Storage file limits (50 MB free plan / 500 GB Pro, per-bucket limits): https://supabase.com/docs/guides/storage/uploads/file-limits
- Decoded-size math and wasm decode slowness context (195 MB RGBA for 48 MP, libheif ~50x slower than native iOS decode): https://dev.to/glebr2d2/-how-i-built-a-client-side-heic-converter-no-server-required-2fl4 , https://news.ycombinator.com/item?id=25704624
- Lambda/serverless precedent for custom-libvips workaround (not applicable on Vercel, context only): https://obviy.us/blog/sharp-heic-on-aws-lambda/ , https://github.com/zoellner/sharp-heic-lambda-layer
