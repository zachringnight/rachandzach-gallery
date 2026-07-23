#!/usr/bin/env node
// Packet 13: resumable, idempotent sync of byte-identical originals and
// immutable derivatives into the private Supabase Storage buckets.
//
// Default mode is DRY-RUN: it verifies every source file's sha256, plans the
// exact private object operations, writes the report, and performs zero
// network operations. Real execution requires ALL of:
//   --execute --project-ref <ref> --allowlist <refs> --env-file <path>
// where the allowlist is supplied at runtime (no default), and credentials
// come only from the named env file (never ambient process.env).
//
//   node scripts/sync-gallery-storage.mjs --catalog tests/fixtures/catalog.json \
//     --source tests/fixtures/photos --dry-run
//
// Object rules (see docs/plans/.../spikes/platform-apis.md for the verified
// storage API contracts):
//  - originals/{imageDataHash}/{sha256[0:16]}-{sanitizedFilename} in the
//    originals bucket. The sha256 prefix satisfies the landed migration's
//    rachandzach_photos_original_object_content_hash constraint.
//  - previews/{imageDataHash}/{width}.{format} in the previews bucket
//    (immutable, content-hashed by imageDataHash).
//  - upload with upsert:false and metadata.fileSha256; on 409 the remote
//    object is verified via info() (size + fileSha256 metadata, no download)
//    and either skipped as identical or reported as a collision. Nothing is
//    ever deleted or overwritten.
//
// Note on streaming: supabase-js accepts a body it forwards to fetch; Node
// stream bodies require fetch duplex negotiation the SDK does not perform, so
// originals are read as whole Buffers, with memory bounded by --concurrency
// (max 8). sha256 verification always streams from disk.
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import tusPkg from "tus-js-client";
import {
  ORIGINALS_BUCKET,
  PREVIEWS_BUCKET,
  ORIGINALS_CACHE_CONTROL_SECONDS,
  PREVIEWS_CACHE_CONTROL_SECONDS,
  ORIGINAL_CONTENT_TYPE,
  SYNC_DEFAULTS,
  parseSyncCatalog,
  originalObjectPath,
  previewContentType,
  readCredentialsFromEnvFile,
  assertExecutionAllowed,
  emptySyncResult,
} from "../src/lib/import/sync-contracts.ts";
import {
  createSyncState,
  loadSyncState,
  saveSyncState,
  recordObject,
  hasVerifiedObject,
} from "../src/lib/import/sync-state.ts";

export function sha256Stream(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// Node v26.3.0's bundled undici (7.28.0) was found to intermittently corrupt
// large (multi-MB) request bodies sent over a reused/pooled TLS connection,
// surfacing as "fetch failed" caused by an SSL bad_record_mac alert. curl
// (libcurl, a completely separate TLS/HTTP stack) uploads the exact same
// bytes to the exact same endpoint over the exact same network reliably.
// This spawns curl for the object upload PUT only; every surrounding
// concern (planning, hashing, checkpointing, 409 identity verification via
// storage.info()) is untouched and still goes through supabase-js. Wire
// format (headers, body encoding) is reverse-engineered from storage-js's
// own uploadOrUpdate() so the request is byte-identical to what the SDK
// would have sent for a POST with a non-Blob/non-FormData body.
async function uploadOriginalObjectViaCurl(
  credentials,
  bucket,
  objectPath,
  body,
  { contentType, cacheControl, metadata, timeoutSeconds = 180 },
) {
  const url = `${credentials.url.replace(/\/$/, "")}/storage/v1/object/${bucket}/${objectPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const headers = {
    apikey: credentials.serviceRoleKey,
    Authorization: `Bearer ${credentials.serviceRoleKey}`,
    "cache-control": `max-age=${cacheControl}`,
    "content-type": contentType,
    "x-upsert": "false",
  };
  if (metadata) {
    headers["x-metadata"] = Buffer.from(JSON.stringify(metadata)).toString("base64");
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const args = [
      "-sS",
      "--max-time",
      String(timeoutSeconds),
      "-X",
      "POST",
      url,
      "-w",
      "\n__CURL_STATUS__%{http_code}",
    ];
    for (const [key, value] of Object.entries(headers)) {
      args.push("-H", `${key}: ${value}`);
    }
    args.push("--data-binary", "@-");

    const child = spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    // Transport-level failures RESOLVE as {error} rather than rejecting:
    // a rejection here escapes the per-operation `const { error } = await
    // uploadObject(...)` destructure, crashes the whole worker pool, and
    // kills the run. One flaky object must only ever cost one recorded
    // failure. (This exact crash happened live on 2026-07-22.)
    child.on("error", (err) =>
      resolvePromise({ error: { status: 0, message: `curl spawn failed: ${err.message}` } }),
    );
    child.on("close", (code) => {
      if (code !== 0) {
        resolvePromise({
          error: { status: 0, message: `curl exited ${code}: ${stderr.trim() || "no stderr"}` },
        });
        return;
      }
      const marker = "__CURL_STATUS__";
      const markerIndex = stdout.lastIndexOf(marker);
      const status = markerIndex >= 0 ? Number(stdout.slice(markerIndex + marker.length).trim()) : 0;
      const responseText = markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout;
      let parsed = null;
      try {
        parsed = responseText ? JSON.parse(responseText) : null;
      } catch {
        // Non-JSON error bodies are still surfaced via responseText below.
      }
      if (status >= 200 && status < 300) {
        resolvePromise({ error: null, data: parsed });
      } else {
        resolvePromise({
          error: {
            status,
            message: parsed?.message ?? responseText.trim() ?? `upload failed with status ${status}`,
          },
        });
      }
    });
    child.stdin.on("error", () => {
      // A broken pipe here surfaces via the 'close' handler's exit code;
      // swallow so it doesn't also throw an unhandled 'error' on stdin.
    });
    child.stdin.end(body);
  });
}

// This network was measured to corrupt individual HTTPS request bodies above
// roughly 1-4 MB (TLS bad_record_mac; reproduced with both Node fetch and
// curl), while requests at or below ~1 MB are reliable. Supabase's resumable
// TUS endpoint slices an upload into fixed-size chunk requests, so with a
// 1 MB chunk size every request stays under the corruption threshold.
// Live-verified 2026-07-22: 10/10 sustained real originals at 16.7 Mbps with
// zero failures, and the custom metadata (fileSha256) written this way is
// returned by storage info() exactly like a plain PUT's x-metadata, so the
// 409-skip resume logic keeps working unchanged.
const TUS_THRESHOLD_BYTES = 1_000_000;
const TUS_CHUNK_BYTES = 1024 * 1024;

function tusEndpointFor(credentials) {
  return (
    credentials.url.replace(/\/$/, "").replace(".supabase.co", ".storage.supabase.co") +
    "/storage/v1/upload/resumable"
  );
}

async function uploadLargeObjectViaTus(
  credentials,
  bucket,
  objectPath,
  body,
  { contentType, cacheControl, metadata },
) {
  const { Upload } = tusPkg;
  return new Promise((resolvePromise) => {
    // Watchdog: a TLS socket that dies without erroring leaves tus-js
    // awaiting forever (observed live 2026-07-22: the whole run wedged at
    // 0 percent CPU for 25 minutes on one upload). A generous hard timeout
    // converts that into a recorded failure the checkpoint retries later.
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolvePromise(value);
    };
    const watchdog = setTimeout(() => {
      try {
        upload.abort();
      } catch {
        // Abort failures are irrelevant; the operation is already being
        // written off as timed out.
      }
      settle({
        error: { status: 0, message: "tus upload watchdog timeout after 180s" },
      });
    }, 180_000);
    const upload = new Upload(body, {
      endpoint: tusEndpointFor(credentials),
      headers: {
        authorization: `Bearer ${credentials.serviceRoleKey}`,
        "x-upsert": "false",
      },
      chunkSize: TUS_CHUNK_BYTES,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 1000, 3000, 8000],
      metadata: {
        bucketName: bucket,
        objectName: objectPath,
        contentType,
        cacheControl: String(cacheControl),
        metadata: JSON.stringify(metadata ?? {}),
      },
      onError: (err) => {
        const status =
          typeof err?.originalResponse?.getStatus === "function"
            ? err.originalResponse.getStatus()
            : /response code: (\d+)/.exec(err?.message ?? "")?.[1]
              ? Number(/response code: (\d+)/.exec(err.message)[1])
              : 0;
        settle({
          error: {
            status,
            message: err?.message?.slice(0, 300) ?? "tus upload failed",
          },
        });
      },
      onSuccess: () => settle({ error: null }),
    });
    upload.start();
  });
}

async function mapWithConcurrency(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}

export function parseStorageArgs(argv) {
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
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--catalog") args.catalogPath = argv[++index];
    else if (arg === "--source") args.sourceRoot = argv[++index];
    else if (arg === "--derivatives") args.derivativeRoot = argv[++index];
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
    else if (arg === "--concurrency") args.concurrency = Number(argv[++index]);
    else if (arg === "--help" || arg === "-h") return { help: true };
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.execute && args.dryRunFlag) {
    throw new Error("--execute and --dry-run are mutually exclusive.");
  }
  if (!args.catalogPath) throw new Error("--catalog <path> is required.");
  if (!args.sourceRoot) throw new Error("--source <dir> is required.");
  return args;
}

function normalizeOptions(options) {
  const concurrency = options.concurrency ?? SYNC_DEFAULTS.concurrency;
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > SYNC_DEFAULTS.maxConcurrency
  ) {
    throw new Error(
      `concurrency must be an integer between 1 and ${SYNC_DEFAULTS.maxConcurrency}.`,
    );
  }
  const sourceRoot = resolve(options.sourceRoot);
  // Derivatives default: a snapshot staged next to the source fixtures wins;
  // otherwise the packet 02 output root. The wedding master itself is
  // read-only and never contains derivatives.
  const derivativeRoot = options.derivativeRoot
    ? resolve(options.derivativeRoot)
    : existsSync(join(sourceRoot, "derivatives"))
      ? join(sourceRoot, "derivatives")
      : resolve(SYNC_DEFAULTS.derivativeRoot);
  return {
    execute: Boolean(options.execute),
    catalogPath: resolve(options.catalogPath),
    sourceRoot,
    derivativeRoot,
    concurrency,
    resumeStatePath: resolve(options.resumeStatePath ?? SYNC_DEFAULTS.resumeStatePath),
    reportPath: resolve(options.reportPath ?? SYNC_DEFAULTS.reportPath),
    projectRef: options.projectRef ?? null,
    allowedProjectRefs: options.allowedProjectRefs ?? [],
    envFilePath: options.envFilePath ?? null,
    localMode: Boolean(options.localMode),
  };
}

async function loadCatalogFile(catalogPath) {
  const text = await fs.readFile(catalogPath, "utf8");
  return parseSyncCatalog(JSON.parse(text));
}

/**
 * Verifies every source file against the catalog and produces the exact,
 * deterministic list of object operations. No network. Ordering: per photo,
 * the original first, then its previews, in catalog order.
 */
export async function buildStoragePlan(catalog, { sourceRoot, derivativeRoot }) {
  const operations = [];
  const failures = [];
  let sourceHashMismatches = 0;
  let verifiedSources = 0;
  let missingLocalDerivatives = 0;

  for (const photo of catalog.photos) {
    const absoluteSource = join(sourceRoot, photo.originalRelativePath);
    let stat;
    try {
      stat = await fs.stat(absoluteSource);
    } catch {
      failures.push({
        stage: "verify-source",
        imageDataHash: photo.imageDataHash,
        objectPath: null,
        reason: `source file missing: ${photo.originalRelativePath}`,
      });
      continue;
    }
    if (stat.size !== photo.originalBytes) {
      sourceHashMismatches += 1;
      failures.push({
        stage: "verify-source",
        imageDataHash: photo.imageDataHash,
        objectPath: null,
        reason: `source size ${stat.size} != catalog originalBytes ${photo.originalBytes}`,
      });
      continue;
    }
    const actualSha = await sha256Stream(absoluteSource);
    if (actualSha !== photo.fileSha256) {
      sourceHashMismatches += 1;
      failures.push({
        stage: "verify-source",
        imageDataHash: photo.imageDataHash,
        objectPath: null,
        reason: `source sha256 ${actualSha} != catalog fileSha256 ${photo.fileSha256}`,
      });
      continue;
    }
    verifiedSources += 1;

    operations.push({
      kind: "original",
      imageDataHash: photo.imageDataHash,
      bucket: ORIGINALS_BUCKET,
      objectPath: originalObjectPath(photo),
      localPath: absoluteSource,
      bytes: stat.size,
      sha256: photo.fileSha256,
      contentType: ORIGINAL_CONTENT_TYPE,
      cacheControl: ORIGINALS_CACHE_CONTROL_SECONDS,
      available: true,
    });

    for (const preview of photo.previewObjects) {
      const localPath = join(derivativeRoot, preview.objectPath);
      let previewStat = null;
      try {
        previewStat = await fs.stat(localPath);
      } catch {
        missingLocalDerivatives += 1;
      }
      operations.push({
        kind: "preview",
        imageDataHash: photo.imageDataHash,
        bucket: PREVIEWS_BUCKET,
        objectPath: preview.objectPath,
        localPath,
        bytes: previewStat ? previewStat.size : null,
        sha256: previewStat ? await sha256Stream(localPath) : null,
        contentType: previewContentType(preview.format),
        cacheControl: PREVIEWS_CACHE_CONTROL_SECONDS,
        available: Boolean(previewStat),
      });
    }
  }

  return { operations, failures, sourceHashMismatches, verifiedSources, missingLocalDerivatives };
}

async function writeReportSection(reportPath, section, payload) {
  let existing = {};
  try {
    existing = JSON.parse(await fs.readFile(reportPath, "utf8"));
  } catch {
    existing = {};
  }
  const report = {
    ...existing,
    generatedAt: new Date().toISOString(),
    [section]: payload,
  };
  await fs.mkdir(dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function detectRemoteOrphans(storage, expectedHashes) {
  const orphans = [];
  const scans = [
    { bucket: ORIGINALS_BUCKET, prefix: "originals" },
    { bucket: PREVIEWS_BUCKET, prefix: "previews" },
  ];
  for (const scan of scans) {
    let offset = 0;
    const pageSize = 100;
    for (;;) {
      const { data, error } = await storage
        .from(scan.bucket)
        .list(scan.prefix, { limit: pageSize, offset });
      if (error) {
        orphans.push({
          bucket: scan.bucket,
          path: scan.prefix,
          note: `orphan scan failed: ${error.message ?? "unknown error"}`,
        });
        break;
      }
      for (const entry of data ?? []) {
        if (entry.name && !expectedHashes.has(entry.name)) {
          orphans.push({
            bucket: scan.bucket,
            path: `${scan.prefix}/${entry.name}`,
            note: "remote folder not present in catalog (reported only; never deleted)",
          });
        }
      }
      if (!data || data.length < pageSize) break;
      offset += pageSize;
    }
  }
  return orphans;
}

/**
 * syncGalleryStorage(options[, deps]) -> Promise<SyncResult>
 *
 * deps.storageClientFactory(context) may inject a client (tests). Without it,
 * execute mode builds a real @supabase/supabase-js client from the env-file
 * credentials, mirroring createAdminClient()'s options. (createAdminClient
 * itself reads ambient env and uses extensionless internal imports that plain
 * node cannot resolve, so it is intentionally not imported here.)
 */
export async function syncGalleryStorage(rawOptions, deps = {}) {
  const options = normalizeOptions(rawOptions);
  const log = deps.log ?? console.log;
  const result = emptySyncResult();

  const catalog = await loadCatalogFile(options.catalogPath);

  let state = await loadSyncState(options.resumeStatePath);
  if (state && state.projectRef !== options.projectRef) {
    if (options.execute) {
      throw new Error(
        `Resume state ${options.resumeStatePath} belongs to project ref ` +
          `"${state.projectRef}" but this run targets "${options.projectRef}". Refusing.`,
      );
    }
    // Dry-run against a different target: that checkpoint is not applicable.
    state = null;
  }

  const plan = await buildStoragePlan(catalog, options);
  result.planned = plan.operations.length;
  result.failed.push(...plan.failures);
  result.sourceHashMismatches = plan.sourceHashMismatches;

  const objectsReport = [];
  let alreadyVerified = 0;
  let plannedBytes = 0;
  for (const op of plan.operations) {
    const inCheckpoint =
      op.sha256 !== null && hasVerifiedObject(state, op.bucket, op.objectPath, op.sha256);
    if (inCheckpoint) alreadyVerified += 1;
    if (op.bytes !== null) plannedBytes += op.bytes;
    objectsReport.push({
      bucket: op.bucket,
      objectPath: op.objectPath,
      kind: op.kind,
      bytes: op.bytes,
      action: inCheckpoint
        ? "skip-checkpoint"
        : op.available
          ? "upload"
          : "missing-local-derivative",
    });
  }

  const mode = options.execute ? "execute" : "dry-run";
  let uploadedBytes = 0;
  let remoteOrphans = [];

  if (!options.execute) {
    // DRY RUN: deterministic listing, zero network operations, no state writes.
    result.skippedExisting = alreadyVerified;
    for (const entry of objectsReport) {
      log(
        `[dry-run] ${entry.action === "upload" ? "PUT " : "SKIP"} ` +
          `${entry.bucket}/${entry.objectPath}` +
          (entry.bytes !== null ? ` (${entry.bytes} bytes)` : " (local derivative missing)"),
      );
    }
  } else {
    // EXECUTE: fail-closed gating before any client exists.
    const credentials = await readCredentialsFromEnvFile(options.envFilePath ?? "");
    assertExecutionAllowed(options, credentials);
    const client = deps.storageClientFactory
      ? await deps.storageClientFactory({ options, credentials })
      : await createRealClient(credentials);
    const storage = client.storage;
    // Real runs (no injected mock client) upload via curl: Node v26.3.0's
    // bundled undici was found to intermittently corrupt large request
    // bodies over a reused TLS connection (see uploadOriginalObjectViaCurl's
    // comment). Tests inject storageClientFactory and keep exercising the
    // normal storage.upload() path so every existing mock still intercepts
    // uploads exactly as before; only the real production path changes.
    // ALL real uploads go through TUS with 1 MB chunks: it is the only
    // transport that survived sustained testing on this network (curl PUTs
    // failed even on sub-1MB bodies under real mixed traffic, while TUS ran
    // 10/10 clean). tus-js-client also retries transient chunk failures
    // internally before we ever see an error. The curl path above remains
    // only as a fallback utility; the mock path keeps supabase-js so every
    // existing unit test still intercepts uploads unchanged.
    const uploadObject = deps.storageClientFactory
      ? (bucket, objectPath, body, opts) =>
          storage.from(bucket).upload(objectPath, body, { ...opts, upsert: false })
      : (bucket, objectPath, body, opts) =>
          uploadLargeObjectViaTus(credentials, bucket, objectPath, body, opts);

    if (!state) state = createSyncState(options.projectRef);
    const reportByKey = new Map(
      objectsReport.map((entry) => [`${entry.bucket}/${entry.objectPath}`, entry]),
    );
    let completedSinceSave = 0;
    let saveQueue = Promise.resolve();
    const checkpoint = () => {
      const snapshot = state;
      saveQueue = saveQueue.then(() => saveSyncState(options.resumeStatePath, snapshot));
      return saveQueue;
    };

    // Group operations per photo so an original always lands before its
    // previews, while distinct photos run in parallel.
    const photoGroups = new Map();
    for (const op of plan.operations) {
      if (!photoGroups.has(op.imageDataHash)) photoGroups.set(op.imageDataHash, []);
      photoGroups.get(op.imageDataHash).push(op);
    }

    await mapWithConcurrency([...photoGroups.values()], options.concurrency, async (ops) => {
      for (const op of ops) {
        const entry = reportByKey.get(`${op.bucket}/${op.objectPath}`);
        if (op.sha256 !== null && hasVerifiedObject(state, op.bucket, op.objectPath, op.sha256)) {
          result.skippedExisting += 1;
          entry.action = "skip-checkpoint";
          continue;
        }
        if (!op.available) {
          result.failed.push({
            stage: `upload-${op.kind}`,
            imageDataHash: op.imageDataHash,
            objectPath: op.objectPath,
            reason: `local derivative missing: ${op.localPath}`,
          });
          entry.action = "failed-missing-local";
          continue;
        }
        // Re-verify the hash immediately before upload: the uploaded buffer
        // must still match the catalog. (imageDataHash is treated as the
        // opaque stable identity verified upstream by the importer.)
        const body = await fs.readFile(op.localPath);
        const bodySha = sha256Buffer(body);
        if (bodySha !== op.sha256) {
          result.sourceHashMismatches += 1;
          result.failed.push({
            stage: `upload-${op.kind}`,
            imageDataHash: op.imageDataHash,
            objectPath: op.objectPath,
            reason: `sha256 changed between plan and upload (${bodySha})`,
          });
          entry.action = "failed-hash-drift";
          continue;
        }

        const { error } = await uploadObject(op.bucket, op.objectPath, body, {
          contentType: op.contentType,
          cacheControl: op.cacheControl,
          metadata: { fileSha256: op.sha256, sizeBytes: String(op.bytes) },
        });

        if (!error) {
          if (op.kind === "original") result.uploadedOriginals += 1;
          else result.uploadedPreviews += 1;
          uploadedBytes += op.bytes;
          entry.action = "uploaded";
          recordObject(state, {
            bucket: op.bucket,
            objectPath: op.objectPath,
            fileSha256: op.sha256,
            bytes: op.bytes,
          });
        } else if (error.status === 409) {
          // Existing object: prove identity without downloading (size +
          // fileSha256 metadata written by this sync), then skip or report.
          const { data: info, error: infoError } = await storage
            .from(op.bucket)
            .info(op.objectPath);
          if (
            !infoError &&
            info &&
            info.size === op.bytes &&
            info.metadata &&
            info.metadata.fileSha256 === op.sha256
          ) {
            result.skippedExisting += 1;
            entry.action = "skip-remote-verified";
            recordObject(state, {
              bucket: op.bucket,
              objectPath: op.objectPath,
              fileSha256: op.sha256,
              bytes: op.bytes,
            });
          } else {
            result.failed.push({
              stage: "remote-collision",
              imageDataHash: op.imageDataHash,
              objectPath: op.objectPath,
              reason: infoError
                ? `object exists but info() failed: ${infoError.message ?? "unknown"}`
                : `remote object differs (size ${info?.size}, fileSha256 ` +
                  `${info?.metadata?.fileSha256 ?? "absent"}); never overwritten`,
            });
            entry.action = "remote-collision";
          }
        } else {
          result.failed.push({
            stage: `upload-${op.kind}`,
            imageDataHash: op.imageDataHash,
            objectPath: op.objectPath,
            reason: error.message ?? `upload failed with status ${error.status}`,
          });
          entry.action = "failed-upload";
        }

        completedSinceSave += 1;
        if (completedSinceSave >= 10) {
          completedSinceSave = 0;
          await checkpoint();
        }
      }
    });

    await checkpoint();
    remoteOrphans = await detectRemoteOrphans(
      storage,
      new Set(catalog.photos.map((photo) => photo.imageDataHash)),
    );
  }

  const report = {
    mode,
    projectRef: options.projectRef,
    catalogPath: options.catalogPath,
    sourceRoot: options.sourceRoot,
    derivativeRoot: options.derivativeRoot,
    planned: result.planned,
    plannedBytes,
    uploadedOriginals: result.uploadedOriginals,
    uploadedPreviews: result.uploadedPreviews,
    uploadedBytes,
    skippedExisting: result.skippedExisting,
    missingLocalDerivatives: plan.missingLocalDerivatives,
    sourceHashVerification: {
      verified: plan.verifiedSources,
      mismatches: result.sourceHashMismatches,
    },
    resumable: {
      totalOperations: result.planned,
      alreadyVerified,
      remaining: result.planned - alreadyVerified,
    },
    networkWrites: result.uploadedOriginals + result.uploadedPreviews,
    failures: result.failed,
    remoteOrphans,
    objects: objectsReport,
  };
  await writeReportSection(options.reportPath, "storage", report);

  log(
    `${mode}: ${result.planned} planned operations, ` +
      `${report.networkWrites} network writes, ${result.skippedExisting} skipped, ` +
      `${result.sourceHashMismatches} source hash mismatches, ` +
      `${result.failed.length} failures. ` +
      `Resumable: ${report.resumable.alreadyVerified} verified, ` +
      `${report.resumable.remaining} remaining.`,
  );

  return result;
}

async function createRealClient(credentials) {
  const { createClient } = await import("@supabase/supabase-js");
  // This script only ever uses client.storage, so the client is constructed
  // against the DEDICATED storage hostname (<ref>.storage.supabase.co).
  // Measured live 2026-07-22: the main-domain storage route
  // (<ref>.supabase.co/storage/v1) hung indefinitely while the dedicated
  // hostname answered in ~150ms; supabase-js does not rewrite the hostname
  // itself, so info()/list() calls through the main domain wedged the whole
  // run. Do not reuse this client for REST/auth; those stay on the main
  // domain elsewhere (the catalog sync script, which needs PostgREST).
  const storageUrl = credentials.url
    .replace(/\/$/, "")
    .replace(".supabase.co", ".storage.supabase.co");
  return createClient(storageUrl, credentials.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const args = parseStorageArgs(process.argv.slice(2));
    if (args.help) {
      console.log(
        "Usage: sync-gallery-storage.mjs --catalog <file> --source <dir> " +
          "[--derivatives <dir>] [--dry-run] [--execute --project-ref <ref> " +
          "--allowlist <ref,...> --env-file <path> [--local]] " +
          "[--resume-state <file>] [--report <file>] [--concurrency <n>]",
      );
      process.exit(0);
    }
    const result = await syncGalleryStorage(args);
    process.exit(result.failed.length > 0 || result.sourceHashMismatches > 0 ? 1 : 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
}
