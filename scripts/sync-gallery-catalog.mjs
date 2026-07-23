#!/usr/bin/env node
// Packet 13: idempotent catalog upsert into the rachandzach_* tables.
//
// Runs AFTER scripts/sync-gallery-storage.mjs: a photo row is only written
// once its original and every planned preview are recorded as verified in the
// shared checkpoint state ("upload media before catalog rows").
//
// Default mode is DRY-RUN. Real execution requires the same fail-closed gate
// as the storage sync: --execute --project-ref <ref> --allowlist <refs>
// --env-file <path>, credentials only from the named env file.
//
// Ordering per the packet: events and people first, then photos, previews,
// people joins, and keywords in bounded batches. supabase-js has no
// client-side transactions, so "bounded transactions" are bounded idempotent
// batches: every write is an upsert on a stable key (slug /
// image_data_hash / composite PKs), each batch is verified by requerying
// counts and sampled joins, and the run stops at the first failed batch so a
// rerun can resume safely. Retries can never create a second photo because
// photos upsert on image_data_hash.
//
// After each batch, denormalized counts are recomputed: people.photo_count is
// rewritten from the joins, and per-event photo counts are requeried and
// compared against the catalog (events have no count column; mismatches are
// reported as failures). Guest-facing facets come from task 06's live
// group-by, not from these numbers.
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORIGINALS_BUCKET,
  PREVIEWS_BUCKET,
  CATALOG_TO_DB_SOURCE,
  CATALOG_TO_DB_STATUS,
  SYNC_DEFAULTS,
  parseSyncCatalog,
  originalObjectPath,
  readCredentialsFromEnvFile,
  assertExecutionAllowed,
  emptySyncResult,
} from "../src/lib/import/sync-contracts.ts";
import {
  loadSyncState,
  saveSyncState,
  recordCatalogRow,
  hasVerifiedObject,
  objectKey,
} from "../src/lib/import/sync-state.ts";

export function parseCatalogArgs(argv) {
  const args = {
    catalogPath: null,
    sourceRoot: null,
    derivativeRoot: null,
    execute: false,
    dryRunFlag: false,
    projectRef: null,
    allowedProjectRefs: [],
    envFilePath: null,
    localMode: false,
    resumeStatePath: SYNC_DEFAULTS.resumeStatePath,
    reportPath: SYNC_DEFAULTS.reportPath,
    concurrency: SYNC_DEFAULTS.concurrency,
    catalogBatchSize: SYNC_DEFAULTS.catalogBatchSize,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--catalog") args.catalogPath = argv[++index];
    else if (arg === "--source") args.sourceRoot = argv[++index];
    else if (arg === "--dry-run") args.dryRunFlag = true;
    else if (arg === "--execute") args.execute = true;
    else if (arg === "--project-ref") args.projectRef = argv[++index];
    else if (arg === "--allowlist")
      args.allowedProjectRefs = String(argv[++index] ?? "")
        .split(",")
        .map((ref) => ref.trim())
        .filter(Boolean);
    else if (arg === "--env-file") args.envFilePath = argv[++index];
    else if (arg === "--local") args.localMode = true;
    else if (arg === "--resume-state") args.resumeStatePath = argv[++index];
    else if (arg === "--report") args.reportPath = argv[++index];
    else if (arg === "--batch-size") args.catalogBatchSize = Number(argv[++index]);
    else if (arg === "--help" || arg === "-h") return { help: true };
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.execute && args.dryRunFlag) {
    throw new Error("--execute and --dry-run are mutually exclusive.");
  }
  if (!args.catalogPath) throw new Error("--catalog <path> is required.");
  return args;
}

function normalizeOptions(options) {
  const batchSize = options.catalogBatchSize ?? SYNC_DEFAULTS.catalogBatchSize;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("batch size must be an integer between 1 and 500.");
  }
  return {
    execute: Boolean(options.execute),
    catalogPath: resolve(options.catalogPath),
    resumeStatePath: resolve(options.resumeStatePath ?? SYNC_DEFAULTS.resumeStatePath),
    reportPath: resolve(options.reportPath ?? SYNC_DEFAULTS.reportPath),
    projectRef: options.projectRef ?? null,
    allowedProjectRefs: options.allowedProjectRefs ?? [],
    envFilePath: options.envFilePath ?? null,
    localMode: Boolean(options.localMode),
    catalogBatchSize: batchSize,
  };
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Storage gate: a photo is catalog-ready only when its original and every
 * planned preview are checkpoint-verified. Returns { ready, gated } where
 * gated photos carry a failure describing exactly what is missing.
 */
export function partitionByStorageReadiness(catalog, state) {
  const ready = [];
  const gated = [];
  for (const photo of catalog.photos) {
    const missing = [];
    const originalPath = originalObjectPath(photo);
    if (!hasVerifiedObject(state, ORIGINALS_BUCKET, originalPath, photo.fileSha256)) {
      missing.push(`${ORIGINALS_BUCKET}/${originalPath}`);
    }
    for (const preview of photo.previewObjects) {
      const record = state?.objects?.[objectKey(PREVIEWS_BUCKET, preview.objectPath)];
      if (!record) missing.push(`${PREVIEWS_BUCKET}/${preview.objectPath}`);
    }
    if (missing.length === 0) {
      ready.push(photo);
    } else {
      gated.push({
        photo,
        failure: {
          stage: "storage-gate",
          imageDataHash: photo.imageDataHash,
          objectPath: missing[0],
          reason:
            `photo is not storage-verified yet (${missing.length} object(s) missing, ` +
            `first: ${missing[0]}); run sync-gallery-storage first`,
        },
      });
    }
  }
  return { ready, gated };
}

function plannedRowCounts(catalog, readyPhotos) {
  let previews = 0;
  let joins = 0;
  let keywords = 0;
  for (const photo of readyPhotos) {
    previews += photo.previewObjects.length;
    joins += photo.peopleSlugs.length;
    keywords += photo.keywords.length;
  }
  return {
    events: catalog.events.length,
    people: catalog.people.length,
    photos: readyPhotos.length,
    previews,
    joins,
    keywords,
    total:
      catalog.events.length + catalog.people.length + readyPhotos.length + previews + joins + keywords,
  };
}

async function writeReportSection(reportPath, section, payload) {
  let existing = {};
  try {
    existing = JSON.parse(await fs.readFile(reportPath, "utf8"));
  } catch {
    existing = {};
  }
  const report = { ...existing, generatedAt: new Date().toISOString(), [section]: payload };
  await fs.mkdir(dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

/**
 * syncGalleryCatalog(options[, deps]) -> Promise<SyncResult>
 * deps.dbClientFactory(context) injects the database client (tests). Without
 * it, execute mode builds a real supabase-js client from env-file credentials.
 */
export async function syncGalleryCatalog(rawOptions, deps = {}) {
  const options = normalizeOptions(rawOptions);
  const log = deps.log ?? console.log;
  const result = emptySyncResult();

  const catalog = parseSyncCatalog(JSON.parse(await fs.readFile(options.catalogPath, "utf8")));

  let state = await loadSyncState(options.resumeStatePath);
  if (state && state.projectRef !== options.projectRef) {
    if (options.execute) {
      throw new Error(
        `Resume state ${options.resumeStatePath} belongs to project ref ` +
          `"${state.projectRef}" but this run targets "${options.projectRef}". Refusing.`,
      );
    }
    state = null;
  }

  const { ready, gated } = partitionByStorageReadiness(catalog, state);
  for (const { failure } of gated) result.failed.push(failure);
  result.skippedExisting = ready.filter(
    (photo) => state?.catalog?.[photo.imageDataHash],
  ).length;

  const counts = plannedRowCounts(catalog, ready);
  result.planned = counts.total;

  const mode = options.execute ? "execute" : "dry-run";
  const verification = { batches: [], peopleCounts: {}, eventCounts: {} };

  if (!options.execute) {
    log(
      `[dry-run] catalog plan: ${counts.events} events, ${counts.people} people, ` +
        `${counts.photos} photos, ${counts.previews} previews, ${counts.joins} people joins, ` +
        `${counts.keywords} keywords (${counts.total} rows); ` +
        `${gated.length} photo(s) blocked by the storage gate; 0 database writes.`,
    );
  } else {
    const credentials = await readCredentialsFromEnvFile(options.envFilePath ?? "");
    assertExecutionAllowed(options, credentials);
    if (!state) {
      throw new Error(
        "No sync state found; run sync-gallery-storage before the catalog sync.",
      );
    }
    const client = deps.dbClientFactory
      ? await deps.dbClientFactory({ options, credentials })
      : await createRealClient(credentials);

    // 1) Events, then people. Both upsert on their stable slug.
    const { data: eventRows, error: eventError } = await client
      .from("rachandzach_events")
      .upsert(
        catalog.events.map((event) => ({
          slug: event.slug,
          name: event.name,
          sort_order: event.order,
        })),
        { onConflict: "slug" },
      )
      .select("id,slug");
    if (eventError) {
      result.failed.push({
        stage: "catalog-events",
        imageDataHash: null,
        objectPath: null,
        reason: eventError.message ?? "event upsert failed",
      });
      return finish();
    }
    result.catalogRowsUpserted += catalog.events.length;
    const eventIdBySlug = new Map(eventRows.map((row) => [row.slug, row.id]));

    const { data: personRows, error: personError } = await client
      .from("rachandzach_people")
      .upsert(
        catalog.people.map((person) => ({
          slug: person.slug,
          display_name: person.name,
        })),
        { onConflict: "slug" },
      )
      .select("id,slug");
    if (personError) {
      result.failed.push({
        stage: "catalog-people",
        imageDataHash: null,
        objectPath: null,
        reason: personError.message ?? "people upsert failed",
      });
      return finish();
    }
    result.catalogRowsUpserted += catalog.people.length;
    const personIdBySlug = new Map(personRows.map((row) => [row.slug, row.id]));

    // 2) Photos and their children in bounded, verified batches.
    for (const [batchIndex, batch] of chunk(ready, options.catalogBatchSize).entries()) {
      const batchOk = await upsertPhotoBatch({
        client,
        batch,
        batchIndex,
        eventIdBySlug,
        personIdBySlug,
        state,
        result,
        verification,
        catalog,
        totalReadyCount: ready.length,
      });
      await saveSyncState(options.resumeStatePath, state);
      if (!batchOk) {
        log(`catalog batch ${batchIndex} failed; stopping so a rerun can resume safely.`);
        break;
      }
    }
  }

  return finish();

  async function finish() {
    await writeReportSection(options.reportPath, "catalog", {
      mode,
      projectRef: options.projectRef,
      catalogPath: options.catalogPath,
      plannedRows: counts,
      storageGate: {
        readyPhotos: ready.length,
        gatedPhotos: gated.length,
      },
      catalogRowsUpserted: result.catalogRowsUpserted,
      skippedExisting: result.skippedExisting,
      failures: result.failed,
      verification,
    });
    log(
      `${mode}: ${result.planned} planned rows, ${result.catalogRowsUpserted} upserted, ` +
        `${gated.length} gated photos, ${result.failed.length} failures.`,
    );
    return result;
  }
}

async function upsertPhotoBatch({
  client,
  batch,
  batchIndex,
  eventIdBySlug,
  personIdBySlug,
  state,
  result,
  verification,
  catalog,
  totalReadyCount,
}) {
  const fail = (stage, reason, imageDataHash = null, objectPath = null) => {
    result.failed.push({ stage, imageDataHash, objectPath, reason });
    return false;
  };

  const photoRows = batch.map((photo) => ({
    image_data_hash: photo.imageDataHash,
    file_sha256: photo.fileSha256,
    event_id: eventIdBySlug.get(photo.eventSlug) ?? null,
    original_bucket: ORIGINALS_BUCKET,
    original_object: originalObjectPath(photo),
    original_filename: photo.originalFilename,
    original_bytes: photo.originalBytes,
    width: photo.width,
    height: photo.height,
    captured_at: photo.capturedAt,
    source: CATALOG_TO_DB_SOURCE[photo.source],
    status: CATALOG_TO_DB_STATUS[photo.status],
  }));
  const { data: photoData, error: photoError } = await client
    .from("rachandzach_photos")
    .upsert(photoRows, { onConflict: "image_data_hash" })
    .select("id,image_data_hash");
  if (photoError) {
    return fail("catalog-batch", `photo upsert failed: ${photoError.message ?? "unknown"}`);
  }
  result.catalogRowsUpserted += photoRows.length;
  const photoIdByHash = new Map(photoData.map((row) => [row.image_data_hash, row.id]));

  const previewRows = [];
  const joinRows = [];
  const keywordRows = [];
  for (const photo of batch) {
    const photoId = photoIdByHash.get(photo.imageDataHash);
    if (!photoId) {
      return fail(
        "catalog-batch",
        "photo upsert did not return an id",
        photo.imageDataHash,
      );
    }
    for (const preview of photo.previewObjects) {
      const stateRecord = state.objects[objectKey(PREVIEWS_BUCKET, preview.objectPath)];
      previewRows.push({
        photo_id: photoId,
        width: preview.width,
        format: preview.format,
        bucket: PREVIEWS_BUCKET,
        object_path: preview.objectPath,
        bytes: stateRecord?.bytes ?? 0,
      });
    }
    for (const slug of photo.peopleSlugs) {
      joinRows.push({
        photo_id: photoId,
        person_id: personIdBySlug.get(slug),
        source: "embedded",
        confidence: "confirmed",
      });
    }
    for (const keyword of photo.keywords) {
      keywordRows.push({ photo_id: photoId, keyword });
    }
  }

  const children = [
    ["rachandzach_photo_previews", previewRows, "photo_id,width,format"],
    ["rachandzach_photo_people", joinRows, "photo_id,person_id"],
    ["rachandzach_photo_keywords", keywordRows, "photo_id,keyword"],
  ];
  for (const [table, rows, onConflict] of children) {
    if (rows.length === 0) continue;
    const { error } = await client.from(table).upsert(rows, { onConflict });
    if (error) {
      return fail("catalog-batch", `${table} upsert failed: ${error.message ?? "unknown"}`);
    }
    result.catalogRowsUpserted += rows.length;
  }

  // Verify the batch: requery the photo count and sample joins.
  const hashes = batch.map((photo) => photo.imageDataHash);
  const { count: photoCount, error: countError } = await client
    .from("rachandzach_photos")
    .select("*", { count: "exact", head: true })
    .in("image_data_hash", hashes);
  if (countError || photoCount !== batch.length) {
    return fail(
      "verify-batch",
      `batch ${batchIndex}: requeried photo count ${photoCount} != ${batch.length}`,
    );
  }
  const sample = batch.filter((photo) => photo.peopleSlugs.length > 0).slice(0, 3);
  for (const photo of sample) {
    const { data: joined, error: joinError } = await client
      .from("rachandzach_photo_people")
      .select("photo_id,person_id")
      .eq("photo_id", photoIdByHash.get(photo.imageDataHash));
    if (joinError) {
      return fail("verify-batch", `sampled join requery failed`, photo.imageDataHash);
    }
    const expected = new Set(photo.peopleSlugs.map((slug) => personIdBySlug.get(slug)));
    const actual = new Set((joined ?? []).map((row) => row.person_id));
    const matches =
      expected.size === actual.size && [...expected].every((id) => actual.has(id));
    if (!matches) {
      return fail(
        "verify-batch",
        `sampled joins for ${photo.imageDataHash} do not match the catalog`,
        photo.imageDataHash,
      );
    }
  }
  verification.batches.push({ batch: batchIndex, photos: batch.length, verified: true });

  // Recompute denormalized counts from the live rows after every batch.
  for (const [slug, personId] of personIdBySlug) {
    const { count } = await client
      .from("rachandzach_photo_people")
      .select("*", { count: "exact", head: true })
      .eq("person_id", personId);
    const { error: updateError } = await client
      .from("rachandzach_people")
      .update({ photo_count: count ?? 0 })
      .eq("id", personId);
    if (updateError) {
      return fail("recount-people", `photo_count update failed for ${slug}`);
    }
    verification.peopleCounts[slug] = count ?? 0;
  }
  for (const [slug, eventId] of eventIdBySlug) {
    const { count } = await client
      .from("rachandzach_photos")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("source", "master");
    verification.eventCounts[slug] = count ?? 0;
  }
  // Event counts have no column; compare against the catalog only after the
  // final batch (earlier batches legitimately trail the catalog totals), and
  // only when every catalog photo was storage-ready in this run.
  const processed = verification.batches.reduce((sum, entry) => sum + entry.photos, 0);
  if (processed >= totalReadyCount && totalReadyCount === catalog.photos.length) {
    for (const event of catalog.events) {
      const actual = verification.eventCounts[event.slug];
      if (actual !== undefined && actual !== event.photoCount) {
        result.failed.push({
          stage: "verify-counts",
          imageDataHash: null,
          objectPath: null,
          reason:
            `event ${event.slug}: live master photo count ${actual} != ` +
            `catalog photoCount ${event.photoCount}`,
        });
      }
    }
  }

  for (const photo of batch) {
    recordCatalogRow(state, photo.imageDataHash);
  }
  return result.failed.every((failure) => failure.stage !== "verify-counts");
}

async function createRealClient(credentials) {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(credentials.url, credentials.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const args = parseCatalogArgs(process.argv.slice(2));
    if (args.help) {
      console.log(
        "Usage: sync-gallery-catalog.mjs --catalog <file> [--dry-run] " +
          "[--execute --project-ref <ref> --allowlist <ref,...> --env-file <path> [--local]] " +
          "[--resume-state <file>] [--report <file>] [--batch-size <n>]",
      );
      process.exit(0);
    }
    const result = await syncGalleryCatalog(args);
    process.exit(result.failed.length > 0 ? 1 : 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
}
