#!/usr/bin/env node
/**
 * Backfill the missing 2400-wide AVIF preview tier.
 *
 * The immutable derivative policy (scripts/lib/image-derivatives.mjs) shipped
 * AVIF + WebP at 480/960/1600 and a compatibility JPEG at 2400. The lightbox
 * always requests the WIDEST preview, so every opened photo costs the ~1.1 MB
 * 2400 JPEG. This script ADDS previews/{imageDataHash}/2400.avif using the
 * SAME quality the existing AVIF tiers were approved at (QUALITY.avif = 55,
 * sharp's default effort), so the new tier is visually consistent with them.
 *
 * Strictly additive and safe by construction:
 *  - Originals are only ever DOWNLOADED. Nothing in rachandzach-originals (or
 *    rachandzach-guest-approved) is written, moved, re-encoded, or deleted.
 *  - No existing preview row or object is updated or removed. The 2400.jpeg
 *    tier stays exactly as it is, as the fallback.
 *  - The rachandzach_photo_previews row is inserted ONLY after the object
 *    upload for that photo has succeeded. A missing row degrades to the JPEG
 *    fallback; a row pointing at a missing object would break the lightbox, so
 *    the failure direction is always "no row".
 *
 * Idempotent and resumable: the work queue is "photos that have a 2400 JPEG
 * preview but no 2400 AVIF preview", recomputed on every run. Re-running after
 * an interruption picks up exactly what is left. An object that already exists
 * at the target path can only be this script's own output from a died-before-
 * insert attempt (the path is content-addressed by image_data_hash and the
 * encode is deterministic), so it is treated as done and the row is inserted.
 *
 * Photos narrower than 2400px are excluded automatically: they have no 2400
 * JPEG either, because the policy never upscales. They are counted and
 * reported, never encoded.
 *
 * Usage:
 *   node scripts/backfill-2400-avif.mjs --dry-run
 *   node scripts/backfill-2400-avif.mjs --sample 5 --out /tmp/avif-sample
 *   node scripts/backfill-2400-avif.mjs --execute
 *   node scripts/backfill-2400-avif.mjs --execute --limit 50 --concurrency 3
 *   node scripts/backfill-2400-avif.mjs --verify
 *
 * Flags:
 *   --dry-run           Report the queue and exit (default when no mode given).
 *   --execute           Encode + upload + insert rows.
 *   --sample N          Encode N photos to local files only. No upload, no DB
 *                       write. Used for the pre-run quality gate.
 *   --only <hash,...>   Restrict to these image_data_hash values.
 *   --out <dir>         Output directory for --sample (default ./.avif-sample).
 *   --limit N           Process at most N photos.
 *   --concurrency N     Photos in flight (default 3).
 *   --quality N         AVIF quality (default 55, from the shipped policy).
 *   --env-file <path>   Default .env.local.
 *   --verify            Print per-tier counts/avg bytes and exit.
 */
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- Policy constants (mirrored from scripts/lib/image-derivatives.mjs) -----
// Do not diverge from these without regenerating the whole tier: the point of
// this backfill is that 2400.avif matches the already-approved 480/960/1600.
const TARGET_WIDTH = 2400;
const TARGET_FORMAT = "avif";
const DEFAULT_AVIF_QUALITY = 55;
const CACHE_CONTROL = "public,max-age=31536000,immutable";
const PREVIEWS_BUCKET = "rachandzach-previews";
const CONTENT_TYPE = "image/avif";

// --- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    sample: 0,
    only: null,
    out: join(REPO_ROOT, ".avif-sample"),
    limit: 0,
    concurrency: 3,
    quality: DEFAULT_AVIF_QUALITY,
    envFile: join(REPO_ROOT, ".env.local"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--dry-run": args.mode = "dry-run"; break;
      case "--execute": args.mode = "execute"; break;
      case "--verify": args.mode = "verify"; break;
      case "--sample": args.mode = "sample"; args.sample = Number(next()); break;
      case "--only": args.only = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--out": args.out = resolve(next()); break;
      case "--limit": args.limit = Number(next()); break;
      case "--concurrency": args.concurrency = Number(next()); break;
      case "--quality": args.quality = Number(next()); break;
      case "--env-file": args.envFile = resolve(next()); break;
      case "--help": case "-h": args.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

// --- Environment -----------------------------------------------------------

async function loadEnv(envFile) {
  let text;
  try {
    text = await fs.readFile(envFile, "utf8");
  } catch {
    throw new Error(
      `Could not read ${envFile}. This script needs NEXT_PUBLIC_SUPABASE_URL ` +
        `and SUPABASE_SERVICE_ROLE_KEY. Refusing to guess credentials.`,
    );
  }
  const env = {};
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
  const missing = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    throw new Error(`${envFile} is missing: ${missing.join(", ")}. Refusing to guess.`);
  }
  return { url: url.replace(/\/$/, ""), serviceRoleKey };
}

/**
 * Bounds the HTTP connection pool and keeps connections alive.
 *
 * Measured here 2026-07-27: with the default dispatcher, a sustained run at
 * concurrency 4-5 opened a fresh TLS connection per request and degraded into
 * near-total "fetch failed" after ~100 photos (failure rate climbing run-long,
 * while the exact same requests succeeded one at a time). Serial execution was
 * 25/25 clean but ~8s/photo. A small keep-alive pool gets the throughput back
 * without the socket fan-out that caused the collapse.
 */
async function installBoundedDispatcher(connections) {
  try {
    const { Agent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(
      new Agent({
        connections,
        keepAliveTimeout: 30_000,
        keepAliveMaxTimeout: 120_000,
        headersTimeout: 120_000,
        bodyTimeout: 300_000,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Two clients on purpose. PostgREST answers on the main domain; storage is
 * routed to the DEDICATED <ref>.storage.supabase.co hostname, matching the
 * measured-live note in scripts/sync-gallery-storage.mjs (the main-domain
 * storage route wedged there, the dedicated hostname answered in ~150ms).
 */
function makeClients(credentials) {
  const { createClient } = require("@supabase/supabase-js");
  const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
  const db = createClient(credentials.url, credentials.serviceRoleKey, { auth });
  const storageUrl = credentials.url.replace(".supabase.co", ".storage.supabase.co");
  const storage = createClient(storageUrl, credentials.serviceRoleKey, { auth });
  return { db, storage };
}

// --- Queue -----------------------------------------------------------------

/** Pages past PostgREST's row cap so a 1,700-row catalog comes back whole. */
async function fetchPage(db, table, columns, orderColumn, tune) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = db.from(table).select(columns);
    if (tune) query = tune(query);
    const { data, error } = await query
      .order(orderColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

/**
 * Builds the work queue. Resumability lives entirely here: the queue is
 * derived fresh from the database on every run, so an interrupted run leaves
 * no state to reconcile.
 */
async function buildQueue(db, options) {
  const photos = await fetchPage(
    db,
    "rachandzach_photos",
    "id, image_data_hash, width, height, original_bucket, original_object",
    "id",
  );
  const previews = await fetchPage(
    db,
    "rachandzach_photo_previews",
    "photo_id, width, format, object_path, bytes",
    "photo_id",
    (q) => q.eq("width", TARGET_WIDTH),
  );

  const hasJpeg = new Set();
  const hasAvif = new Set();
  for (const preview of previews) {
    if (preview.format === "jpeg") hasJpeg.add(preview.photo_id);
    if (preview.format === TARGET_FORMAT) hasAvif.add(preview.photo_id);
  }

  const queue = [];
  const skipped = { noJpegTier: [], alreadyDone: 0, notWideEnough: [] };
  for (const photo of photos) {
    if (options.only && !options.only.includes(photo.image_data_hash)) continue;
    if (hasAvif.has(photo.id)) {
      skipped.alreadyDone += 1;
      continue;
    }
    if (!hasJpeg.has(photo.id)) {
      // No 2400 tier at all. Either the source is <= 2400px wide (the policy
      // never upscales) or the JPEG itself never landed. Both are "leave it
      // alone" -- generating a 2400 AVIF for a 1600px source would upscale.
      if (photo.width > TARGET_WIDTH) skipped.noJpegTier.push(photo.image_data_hash);
      else skipped.notWideEnough.push(photo.image_data_hash);
      continue;
    }
    queue.push(photo);
  }
  queue.sort((a, b) => a.image_data_hash.localeCompare(b.image_data_hash));
  return { queue, skipped, totalPhotos: photos.length };
}

// --- Encode ----------------------------------------------------------------

function plannedHeight(photo) {
  return Math.max(1, Math.round((photo.height * TARGET_WIDTH) / photo.width));
}

/**
 * Encodes one 2400-wide AVIF from the ORIGINAL bytes (never from the 2400
 * JPEG -- re-encoding a lossy intermediate would bake its artifacts in).
 * autoOrient + keepIccProfile match generateDerivatives exactly.
 */
async function encodeAvif(originalBytes, photo, quality) {
  const buffer = Buffer.from(originalBytes);
  const encoded = await sharp(buffer, { failOn: "error", limitInputPixels: 500_000_000 })
    .autoOrient()
    .keepIccProfile()
    .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
    .avif({ quality })
    .toBuffer({ resolveWithObject: true });
  return encoded;
}

/** Decodes the encoded bytes and measures both axes, as verifyDerivative does. */
async function verifyEncoded(bytes, photo) {
  const image = sharp(bytes, { failOn: "error" });
  const metadata = await image.metadata();
  const tagOrientation = metadata.orientation ?? 1;
  const swapped = tagOrientation >= 5 && tagOrientation <= 8;
  const width = swapped ? metadata.height : metadata.width;
  const height = swapped ? metadata.width : metadata.height;
  const expectedHeight = plannedHeight(photo);
  if (width !== TARGET_WIDTH) {
    throw new Error(`decoded width ${width}, expected ${TARGET_WIDTH}`);
  }
  if (!Number.isInteger(height) || height < 1 || Math.abs(height - expectedHeight) > 1) {
    throw new Error(`decoded height ${height}, expected ${expectedHeight} (+/-1)`);
  }
  // Force a full decode so truncated output can never be published.
  await image.stats();
  return { width, height };
}

// --- Storage ---------------------------------------------------------------

/** Unwraps undici's opaque "fetch failed" so a transient blip is diagnosable. */
function describeError(error) {
  const parts = [error?.message ?? String(error)];
  let cause = error?.cause;
  for (let depth = 0; cause && depth < 3; depth += 1) {
    const detail = [cause.code, cause.message].filter(Boolean).join(" ");
    if (detail) parts.push(detail);
    cause = cause.cause;
  }
  return parts.join(" <- ");
}

/**
 * Network I/O against Supabase Storage, retried with exponential backoff.
 * A ~1,500-item run WILL hit transient socket resets; without this a blip
 * turns into a thousand spurious failures.
 */
async function withRetry(label, attempt, { attempts = 5, baseDelayMs = 500 } = {}) {
  let lastError;
  for (let tryIndex = 0; tryIndex < attempts; tryIndex += 1) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (tryIndex === attempts - 1) break;
      const delay = baseDelayMs * 2 ** tryIndex + Math.round(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(`${label}: ${describeError(lastError)}`);
}

/** Read-only. The originals bucket is never written by this script. */
async function downloadOriginal(storage, photo) {
  return withRetry(
    `download ${photo.original_bucket}/${photo.original_object}`,
    async () => {
      const { data, error } = await storage.storage
        .from(photo.original_bucket)
        .download(photo.original_object);
      if (error || !data) throw error ?? new Error("no body");
      return new Uint8Array(await data.arrayBuffer());
    },
  );
}

function isAlreadyExists(error) {
  const message = error?.message ?? "";
  return /already exists|duplicate|resource already/i.test(message) || error?.statusCode === "409";
}

/**
 * upsert:false so this can never overwrite an object. The only object that can
 * already sit at this path is our own deterministic output from an attempt
 * that died before the row insert, so "already exists" is success, not an
 * error -- that re-observation IS the recovery.
 */
async function uploadPreview(storage, objectPath, bytes) {
  return withRetry(`upload ${PREVIEWS_BUCKET}/${objectPath}`, async () => {
    const { error } = await storage.storage
      .from(PREVIEWS_BUCKET)
      .upload(objectPath, bytes, {
        contentType: CONTENT_TYPE,
        cacheControl: CACHE_CONTROL,
        upsert: false,
      });
    // "Already exists" is our own output from an attempt that died before the
    // row insert, so it is a terminal success -- never retried, never an error.
    if (error && !isAlreadyExists(error)) throw error;
    return error ? "existed" : "uploaded";
  });
}

/**
 * Additive insert only. Never an update: a 23505 means a concurrent or earlier
 * run already recorded this exact tier, which is the same end state.
 */
async function insertPreviewRow(db, photo, objectPath, bytes) {
  return withRetry(`insert row for ${photo.image_data_hash}`, async () => {
    const { error } = await db.from("rachandzach_photo_previews").insert({
      photo_id: photo.id,
      width: TARGET_WIDTH,
      format: TARGET_FORMAT,
      bucket: PREVIEWS_BUCKET,
      object_path: objectPath,
      bytes,
    });
    if (error && error.code !== "23505") throw error;
    return error ? "existed" : "inserted";
  });
}

// --- Runner ----------------------------------------------------------------

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(await fs.readFile(fileURLToPath(import.meta.url), "utf8").then((t) =>
      t.split("\n").slice(1, 52).join("\n"),
    ));
    return;
  }

  const credentials = await loadEnv(args.envFile);
  const { db, storage } = makeClients(credentials);

  if (args.mode === "verify") {
    const rows = await fetchPage(
      db,
      "rachandzach_photo_previews",
      "photo_id, width, format, bytes",
      "photo_id",
    );
    const tiers = new Map();
    for (const row of rows) {
      const key = `${row.width}.${row.format}`;
      const tier = tiers.get(key) ?? { rows: 0, bytes: 0 };
      tier.rows += 1;
      tier.bytes += Number(row.bytes);
      tiers.set(key, tier);
    }
    console.log("tier         rows     avg bytes     total");
    for (const key of [...tiers.keys()].sort()) {
      const tier = tiers.get(key);
      console.log(
        `${key.padEnd(12)} ${String(tier.rows).padStart(5)}  ` +
          `${formatBytes(Math.round(tier.bytes / tier.rows)).padStart(12)}  ` +
          `${formatBytes(tier.bytes).padStart(10)}`,
      );
    }
    return;
  }

  const { queue, skipped, totalPhotos } = await buildQueue(db, args);
  console.log(
    `catalog ${totalPhotos} photos | already have 2400.${TARGET_FORMAT}: ${skipped.alreadyDone} | ` +
      `no 2400 tier (source <= ${TARGET_WIDTH}px, skipped): ${skipped.notWideEnough.length} | ` +
      `wide but missing the 2400 JPEG (skipped): ${skipped.noJpegTier.length} | ` +
      `to encode: ${queue.length}`,
  );
  if (skipped.noJpegTier.length > 0) {
    console.log(`  wide-without-jpeg hashes: ${skipped.noJpegTier.slice(0, 20).join(", ")}`);
  }

  if (args.mode === "dry-run") return;

  let work = queue;
  if (args.mode === "sample" && args.sample > 0) work = work.slice(0, args.sample);
  if (args.limit > 0) work = work.slice(0, args.limit);
  if (work.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (args.mode === "sample") {
    await fs.mkdir(args.out, { recursive: true });
    console.log(`sample mode: ${work.length} photos -> ${args.out} (no upload, no DB write)`);
  } else {
    // Cap libvips' own thread pool so N photos in flight x sharp's default 4
    // threads does not oversubscribe the machine and slow every encode down.
    const perEncodeThreads = Math.max(1, Math.floor(8 / Math.max(1, args.concurrency)));
    sharp.concurrency(perEncodeThreads);
    const pooled = await installBoundedDispatcher(args.concurrency + 2);
    console.log(
      `execute: ${work.length} photos, concurrency ${args.concurrency} ` +
        `(${perEncodeThreads} libvips threads each), quality ${args.quality}, ` +
        `${pooled ? `bounded pool of ${args.concurrency + 2} connections` : "DEFAULT dispatcher (undici unavailable -- expect socket churn; drop --concurrency to 1)"}`,
    );
  }

  const startedAt = Date.now();
  let done = 0;
  let avifBytesTotal = 0;
  let jpegBytesTotal = 0;
  const failures = [];

  // Existing 2400 JPEG sizes, for the savings report.
  const jpegRows = await fetchPage(
    db,
    "rachandzach_photo_previews",
    "photo_id, bytes",
    "photo_id",
    (q) => q.eq("width", TARGET_WIDTH).eq("format", "jpeg"),
  );
  const jpegBytesByPhoto = new Map(jpegRows.map((r) => [r.photo_id, Number(r.bytes)]));

  await runPool(work, args.mode === "sample" ? 2 : args.concurrency, async (photo) => {
    const objectPath = `previews/${photo.image_data_hash}/${TARGET_WIDTH}.${TARGET_FORMAT}`;
    try {
      const original = await downloadOriginal(storage, photo);
      const encoded = await encodeAvif(original, photo, args.quality);
      await verifyEncoded(encoded.data, photo);

      const jpegBytes = jpegBytesByPhoto.get(photo.id) ?? 0;
      const avifBytes = encoded.data.byteLength;

      if (args.mode === "sample") {
        // Also write the existing 2400 JPEG next to it, so the two can be
        // compared as images at identical pixel dimensions.
        const jpegPath = join(args.out, `${photo.image_data_hash}.2400.jpeg`);
        const avifPath = join(args.out, `${photo.image_data_hash}.2400.avif`);
        const { data: jpegBlob, error: jpegError } = await storage.storage
          .from(PREVIEWS_BUCKET)
          .download(`previews/${photo.image_data_hash}/2400.jpeg`);
        if (jpegError || !jpegBlob) throw new Error(`download 2400.jpeg: ${jpegError?.message}`);
        await fs.writeFile(jpegPath, Buffer.from(await jpegBlob.arrayBuffer()));
        await fs.writeFile(avifPath, encoded.data);
        // A PNG rendering of the AVIF too: some viewers cannot open AVIF.
        await sharp(encoded.data).png({ compressionLevel: 6 }).toFile(`${avifPath}.png`);
      } else {
        // Object first, row second. Always.
        await uploadPreview(storage, objectPath, encoded.data);
        await insertPreviewRow(db, photo, objectPath, avifBytes);
      }

      avifBytesTotal += avifBytes;
      jpegBytesTotal += jpegBytes;
      const saved = jpegBytes > 0 ? (1 - avifBytes / jpegBytes) * 100 : 0;
      if (args.mode === "sample") {
        console.log(
          `  ${photo.image_data_hash}  ${photo.width}x${photo.height}  ` +
            `jpeg ${formatBytes(jpegBytes)} -> avif ${formatBytes(avifBytes)}  ` +
            `(-${saved.toFixed(1)}%)`,
        );
      }
    } catch (error) {
      const reason = describeError(error);
      failures.push({ hash: photo.image_data_hash, reason });
      console.error(`  FAIL ${photo.image_data_hash}: ${reason}`);
    } finally {
      done += 1;
      if (args.mode !== "sample" && (done % 25 === 0 || done === work.length)) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = done / elapsed;
        const remaining = work.length - done;
        console.log(
          `  ${done}/${work.length} (${((done / work.length) * 100).toFixed(1)}%) ` +
            `${rate.toFixed(2)}/s, eta ${Math.round(remaining / Math.max(rate, 0.001) / 60)}m, ` +
            `${failures.length} failures, avif so far ${formatBytes(avifBytesTotal)}`,
        );
      }
    }
  });

  const ok = done - failures.length;
  console.log(
    `\nDone: ${ok} encoded, ${failures.length} failed, ` +
      `${formatBytes(avifBytesTotal)} of AVIF added ` +
      (jpegBytesTotal > 0
        ? `vs ${formatBytes(jpegBytesTotal)} of JPEG for the same photos ` +
          `(-${((1 - avifBytesTotal / jpegBytesTotal) * 100).toFixed(1)}%)`
        : ""),
  );
  if (failures.length > 0) {
    console.log("Failures (re-run the script to retry these; it is idempotent):");
    for (const failure of failures.slice(0, 25)) {
      console.log(`  ${failure.hash}: ${failure.reason}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
