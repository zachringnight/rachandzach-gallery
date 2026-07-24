/**
 * Approved-photo processing (packet 10).
 *
 * Turns one guest upload_item into a staged catalog photo:
 * download the private original, decode it (HEIC via the wasm libheif path
 * per docs/plans/.../spikes/heic-decode.md, everything else via sharp
 * directly), generate stripped display derivatives, copy the original and
 * upload the derivatives into rachandzach-guest-approved under new
 * content-hashed names, and ONLY THEN insert a non-visible, caption-free
 * rachandzach_photos row. Its preview/people/keyword relations are replayed
 * idempotently before processing_complete is allowed to become true.
 *
 * Publication is deliberately separate. The approve route first stages the
 * photo, then applies transitionUploadItem's compare-and-swap decision, then
 * calls reconcileProcessedPhoto. That final step re-reads the persisted item
 * and is the only place that may publish the photo or copy an approved note.
 *
 * Retry-safe by construction: the catalog identity (image_data_hash /
 * file_sha256) is the SERVER-COMPUTED SHA-256 of the downloaded original
 * bytes. A retry returns an already-complete photo without another write; an
 * incomplete same-batch row replays its content-hashed uploads and relation
 * inserts, tolerating only the unique conflicts created by concurrent repair.
 *
 * HEIC decode failure throws HeicDecodeError and creates nothing: the caller
 * (the approve route) must not mark the item "approved" when this rejects,
 * so a decode failure never gets silently treated as done.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { STORAGE_BUCKETS, type PhotoRow } from "@/lib/supabase/schema";
import { GUEST_PENDING_BUCKET } from "@/lib/uploads/contracts";
import { sniffImage } from "@/lib/uploads/validate-upload";
import { ModerationPersistenceError } from "./audit";

type Db = SupabaseClient<Database>;

// --- Errors ------------------------------------------------------------

/** The item is not in a state this function is allowed to process. */
export class UnprocessableItemStateError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "UnprocessableItemStateError";
  }
}

/**
 * HEIC decode failed. Per the packet: "never approve without a derivative" --
 * this is a moderation error the admin sees, not a silent skip.
 */
export class HeicDecodeError extends Error {
  readonly status = 422;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HeicDecodeError";
  }
}

/** The downloaded bytes do not sniff to any format this pipeline handles. */
export class UnsupportedImageFormatError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedImageFormatError";
  }
}

export { ModerationPersistenceError } from "./audit";

// --- Types ---------------------------------------------------------------

export interface ProcessApprovedPhotoMetadata {
  eventSlug: string | null;
  peopleSlugs: string[];
  keywords: string[];
  expectedBatchId?: string;
}

export interface ReconcileProcessedPhotoOptions {
  expectedBatchId?: string;
  /**
   * Failure paths set this false: they may quarantine a rejected/removed
   * staged row, but may not publish one whose decision did not resolve in
   * this request.
   */
  publishApproved?: boolean;
}

interface ApprovedCaption {
  text: string;
}

interface DerivativeSpec {
  width: number;
  format: "jpeg" | "webp";
}

/** Two sizes: a full display size and a grid/thumbnail size. */
const DERIVATIVE_SPECS: readonly DerivativeSpec[] = [
  { width: 2048, format: "jpeg" },
  { width: 480, format: "webp" },
];

const DERIVATIVE_CONTENT_TYPES: Record<DerivativeSpec["format"], string> = {
  jpeg: "image/jpeg",
  webp: "image/webp",
};

interface BuiltDerivative extends DerivativeSpec {
  bytes: Buffer;
}

// --- Helpers ---------------------------------------------------------------

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Mirrors sanitizeOriginalFilename's intent (packet 13) without importing
 * that module: keep [A-Za-z0-9._-], collapse separators, cap length.
 */
function sanitizeFilename(filename: string): string {
  const sanitized = filename
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "");
  return (sanitized || "photo").slice(0, 200);
}

async function fetchUploadItem(client: Db, itemId: string) {
  const { data, error } = await client
    .from("rachandzach_upload_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();
  if (error) {
    throw new ModerationPersistenceError("Could not read the upload item.");
  }
  return data;
}

async function downloadObject(
  client: Db,
  bucket: string,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await client.storage.from(bucket).download(path);
  if (error || !data) {
    throw new ModerationPersistenceError(
      `Could not download ${bucket}/${path}.`,
    );
  }
  return new Uint8Array(await data.arrayBuffer());
}

function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /already exists|duplicate/i.test(message);
}

/**
 * Uploads without ever overwriting -- and without ever getting stuck on a
 * retry. Every path here is content-hashed (embeds the source sha256), so if
 * the object is already there, it can only be this exact content from an
 * earlier attempt at processing this same item. That is the "compensating
 * cleanup" for a retry that died after uploading but before the photos row
 * committed: there is nothing to roll back, because re-observing the
 * already-uploaded object IS the recovery, not an error.
 */
async function uploadObject(
  client: Db,
  bucket: string,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await client.storage.from(bucket).upload(path, bytes, {
    contentType,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) {
    if (isAlreadyExistsError(error)) return;
    throw new ModerationPersistenceError(`Could not upload ${bucket}/${path}.`);
  }
}

export async function findExistingGuestPhoto(
  client: Db,
  fileSha256: string,
): Promise<PhotoRow | null> {
  const { data, error } = await client
    .from("rachandzach_photos")
    .select("*")
    .eq("file_sha256", fileSha256)
    .eq("source", "guest")
    .maybeSingle();
  if (error) {
    throw new ModerationPersistenceError("Could not look up the catalog photo.");
  }
  return (data as PhotoRow | null) ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function insertRelationIdempotently(
  operation: PromiseLike<{ error: unknown }>,
  failureMessage: string,
): Promise<void> {
  const { error } = await operation;
  if (!error || isUniqueViolation(error)) return;
  throw new ModerationPersistenceError(failureMessage);
}

export async function resolveEventId(
  client: Db,
  slug: string,
): Promise<string | null> {
  const { data } = await client
    .from("rachandzach_events")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function resolvePersonIds(
  client: Db,
  slugs: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const slug of slugs) {
    const { data } = await client
      .from("rachandzach_people")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    const id = (data as { id: string } | null)?.id;
    if (id) ids.push(id);
  }
  return ids;
}

async function resolveApprovedCaption(
  client: Db,
  batchId: string,
  noteApproved: boolean,
): Promise<ApprovedCaption | null> {
  if (!noteApproved) return null;
  const { data, error } = await client
    .from("rachandzach_upload_batches")
    .select("note")
    .eq("id", batchId)
    .maybeSingle();
  if (error) {
    throw new ModerationPersistenceError("Could not read the uploader note.");
  }
  const note = data?.note?.trim();
  if (!note) return null;
  return {
    text: note,
  };
}

async function fetchPhoto(
  client: Db,
  photoId: string,
): Promise<PhotoRow | null> {
  const { data, error } = await client
    .from("rachandzach_photos")
    .select("*")
    .eq("id", photoId)
    .maybeSingle();
  if (error) {
    throw new ModerationPersistenceError("Could not read the catalog photo.");
  }
  return (data as PhotoRow | null) ?? null;
}

function assertReusableCrossBatchPhoto(photo: PhotoRow): void {
  if (
    !photo.processing_complete ||
    (photo.status !== "published" && photo.status !== "hidden")
  ) {
    throw new UnprocessableItemStateError(
      "The matching catalog photo is not yet reusable from another batch.",
    );
  }
}

/**
 * Decodes the original (HEIC via heic-decode -> raw RGBA -> sharp; everything
 * else via sharp directly with EXIF-orientation applied) and produces the
 * fixed derivative set. Dynamic-imports both heic-decode and sharp so this
 * module has no top-level dependency on native/wasm binaries for callers that
 * never touch a HEIC branch.
 */
async function buildDerivatives(
  original: Uint8Array,
): Promise<{ width: number; height: number; derivatives: BuiltDerivative[] }> {
  const sharpModule = await import("sharp");
  const sharp = sharpModule.default;

  const head = original.subarray(0, Math.min(original.length, 64));
  const kind = sniffImage(head);

  let base: import("sharp").Sharp;
  let width: number;
  let height: number;

  if (kind === "heic") {
    const heicDecodeModule = await import("heic-decode");
    const decode = heicDecodeModule.default;
    let decoded: { width: number; height: number; data: Uint8ClampedArray };
    try {
      decoded = await decode({ buffer: Buffer.from(original) });
    } catch (cause) {
      throw new HeicDecodeError(
        "Could not decode this HEIC photo. Ask the guest to re-upload as JPEG.",
        { cause },
      );
    }
    width = decoded.width;
    height = decoded.height;
    base = sharp(
      Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
      { raw: { width, height, channels: 4 } },
    );
  } else if (kind === "jpeg" || kind === "png" || kind === "webp" || kind === "avif") {
    const sharpBase = sharp(Buffer.from(original), {
      limitInputPixels: 100_000_000,
    }).rotate(); // applies EXIF orientation, then strips it from the output
    const meta = await sharpBase.metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
    base = sharpBase;
  } else {
    throw new UnsupportedImageFormatError(
      "This file's bytes do not match a supported image format.",
    );
  }

  const derivatives: BuiltDerivative[] = [];
  for (const spec of DERIVATIVE_SPECS) {
    const pipeline = base
      .clone()
      .resize({ width: spec.width, withoutEnlargement: true });
    // Record the ACTUAL encoded width/height, not the nominal spec width:
    // withoutEnlargement means a source narrower than spec.width (e.g. a
    // guest photo smaller than the "2048" tier) renders at its own width,
    // and photo_previews.width must reflect what was really written so
    // srcset/responsive consumers never request a size that doesn't exist.
    const encoded =
      spec.format === "jpeg"
        ? await pipeline
            .jpeg({ quality: 82, mozjpeg: true })
            .toBuffer({ resolveWithObject: true })
        : await pipeline
            .webp({ quality: 75 })
            .toBuffer({ resolveWithObject: true });
    derivatives.push({
      format: spec.format,
      width: encoded.info.width,
      bytes: encoded.data,
    });
  }

  return { width, height, derivatives };
}

// --- Main entry point --------------------------------------------------

/**
 * Produced interface: processApprovedPhoto(itemId) -> { photoId, created }.
 *
 * `metadata` carries the event/people/keyword assignments from the admin's
 * ModerationDecision (upload_items has no columns for them, so they cannot
 * be read back from the item row alone).
 */
export async function processApprovedPhoto(
  itemId: string,
  metadata: ProcessApprovedPhotoMetadata,
  client: Db,
): Promise<{ photoId: string; created: boolean }> {
  const item = await fetchUploadItem(client, itemId);
  if (!item) {
    throw new UnprocessableItemStateError(`Upload item ${itemId} was not found.`);
  }
  if (
    metadata.expectedBatchId &&
    item.batch_id !== metadata.expectedBatchId
  ) {
    throw new UnprocessableItemStateError(
      `Upload item ${itemId} does not belong to this batch.`,
    );
  }
  // Called just before the item flips to "approved" (normal flow) or again
  // afterward (retry): both are legal states to stage from. Anything else
  // (rejected/removed) must remain non-visible and is not processable.
  if (item.status !== "pending" && item.status !== "approved") {
    throw new UnprocessableItemStateError(
      `Upload item ${itemId} is "${item.status}" and cannot be processed into a photo.`,
    );
  }

  const original = await downloadObject(
    client,
    GUEST_PENDING_BUCKET,
    item.object_path,
  );
  const fileSha256 = sha256Hex(original);

  // Record the SERVER-VERIFIED hash on the item row, upgrading it from the
  // client-supplied "advisory" value (packet 08) to a value of record. Cheap
  // and idempotent (a retry writes the same value); also lets
  // findPhotoForApprovedItem look up the resulting photo without a second
  // download+hash of the original.
  if (item.sha256 !== fileSha256) {
    await client
      .from("rachandzach_upload_items")
      .update({ sha256: fileSha256 })
      .eq("id", itemId);
  }

  let photoRow = await findExistingGuestPhoto(client, fileSha256);
  if (photoRow && photoRow.submitted_batch_id !== item.batch_id) {
    assertReusableCrossBatchPhoto(photoRow);
    return { photoId: photoRow.id, created: false };
  }
  if (photoRow?.processing_complete) {
    return { photoId: photoRow.id, created: false };
  }

  const { width, height, derivatives } = await buildDerivatives(original);

  const shaPrefix = fileSha256.slice(0, 16);
  const safeName = sanitizeFilename(item.original_name);
  const originalObjectPath =
    photoRow?.original_object ?? `guest-approved/${shaPrefix}-${safeName}`;
  const originalBucket =
    photoRow?.original_bucket ?? STORAGE_BUCKETS.guestApproved;

  // Original first, then every derivative. The photos row is inserted only
  // after every one of these uploads has succeeded.
  await uploadObject(
    client,
    originalBucket,
    originalObjectPath,
    original,
    item.media_type,
  );

  const previewInserts: Array<{
    width: number;
    format: "jpeg" | "webp";
    bucket: string;
    object_path: string;
    bytes: number;
  }> = [];
  for (const derivative of derivatives) {
    const objectPath = `guest-approved/previews/${shaPrefix}/${derivative.width}.${derivative.format}`;
    await uploadObject(
      client,
      STORAGE_BUCKETS.guestApproved,
      objectPath,
      derivative.bytes,
      DERIVATIVE_CONTENT_TYPES[derivative.format],
    );
    previewInserts.push({
      width: derivative.width,
      format: derivative.format,
      bucket: STORAGE_BUCKETS.guestApproved,
      object_path: objectPath,
      bytes: derivative.bytes.byteLength,
    });
  }

  let created = false;
  if (!photoRow) {
    const eventId = metadata.eventSlug
      ? await resolveEventId(client, metadata.eventSlug)
      : null;

    // This row is intentionally incomplete even though every object upload
    // has landed. Relation rows are written below and form the final staging
    // barrier before processing_complete flips to true.
    const { data: photo, error: photoError } = await client
      .from("rachandzach_photos")
      .insert({
        image_data_hash: fileSha256,
        file_sha256: fileSha256,
        event_id: eventId,
        original_bucket: STORAGE_BUCKETS.guestApproved,
        original_object: originalObjectPath,
        original_filename: item.original_name,
        original_bytes: original.byteLength,
        width,
        height,
        source: "guest",
        status: "pending",
        submitted_batch_id: item.batch_id,
        processing_complete: false,
        uploader_caption: null,
        uploader_caption_byline: null,
        approved_at: null,
      })
      .select("*")
      .single();

    if (photoError || !photo) {
      if (isUniqueViolation(photoError)) {
        // A concurrent processor owns the content row. Same-batch incomplete
        // rows are repairable below; cross-batch rows remain blocked until
        // they are complete and have a reusable visibility status.
        const raced = await findExistingGuestPhoto(client, fileSha256);
        if (raced) {
          if (raced.submitted_batch_id !== item.batch_id) {
            assertReusableCrossBatchPhoto(raced);
            return { photoId: raced.id, created: false };
          }
          if (raced.processing_complete) {
            return { photoId: raced.id, created: false };
          }
          photoRow = raced;
        }
      }
      if (!photoRow) {
        throw new ModerationPersistenceError(
          "Could not create the catalog photo row.",
        );
      }
    } else {
      photoRow = photo as PhotoRow;
      created = true;
    }
  }

  for (const preview of previewInserts) {
    await insertRelationIdempotently(
      client.from("rachandzach_photo_previews").insert({
        photo_id: photoRow.id,
        ...preview,
      }),
      "Could not record a photo preview.",
    );
  }

  if (metadata.peopleSlugs.length > 0) {
    const personIds = await resolvePersonIds(client, metadata.peopleSlugs);
    for (const personId of personIds) {
      await insertRelationIdempotently(
        client.from("rachandzach_photo_people").insert({
          photo_id: photoRow.id,
          person_id: personId,
          source: "confirmed",
          confidence: "confirmed",
        }),
        "Could not record a photo person.",
      );
    }
  }

  for (const keyword of metadata.keywords) {
    await insertRelationIdempotently(
      client.from("rachandzach_photo_keywords").insert({
        photo_id: photoRow.id,
        keyword,
      }),
      "Could not record a photo keyword.",
    );
  }

  const { data: completed, error: completionError } = await client
    .from("rachandzach_photos")
    .update({ processing_complete: true })
    .eq("id", photoRow.id)
    .eq("submitted_batch_id", item.batch_id)
    .eq("processing_complete", false)
    .select("*")
    .maybeSingle();
  if (completionError) {
    throw new ModerationPersistenceError(
      "Could not complete catalog photo processing.",
    );
  }
  if (!completed) {
    const fresh = await fetchPhoto(client, photoRow.id);
    if (
      !fresh ||
      fresh.submitted_batch_id !== item.batch_id ||
      !fresh.processing_complete
    ) {
      throw new ModerationPersistenceError(
        "Could not verify catalog photo processing.",
      );
    }
  }

  return { photoId: photoRow.id, created };
}

/**
 * Reconciles one staged photo against the upload item's persisted moderation
 * winner. Request payload flags are intentionally absent: concurrent approve
 * requests must converge on upload_items.note_approved, not whichever request
 * happens to finish processing last.
 *
 * A content duplicate may resolve to a photo first submitted by another
 * batch. That is a valid idempotent result, but this function never changes
 * that photo's provenance, visibility, caption, or approval timestamp.
 */
export async function reconcileProcessedPhoto(
  itemId: string,
  photoId: string,
  options: ReconcileProcessedPhotoOptions,
  client: Db,
): Promise<{
  photoId: string;
  owned: boolean;
  status: string;
  itemStatus: string;
}> {
  const item = await fetchUploadItem(client, itemId);
  if (!item) {
    throw new UnprocessableItemStateError(`Upload item ${itemId} was not found.`);
  }
  if (options.expectedBatchId && item.batch_id !== options.expectedBatchId) {
    throw new UnprocessableItemStateError(
      `Upload item ${itemId} does not belong to this batch.`,
    );
  }

  const photo = await fetchPhoto(client, photoId);
  if (!photo) {
    throw new UnprocessableItemStateError(
      `Catalog photo ${photoId} was not found.`,
    );
  }

  // Duplicate content from a different batch belongs to the first catalog
  // row. Approval of this item must not rewrite that row's provenance/caption.
  if (photo.submitted_batch_id !== item.batch_id) {
    assertReusableCrossBatchPhoto(photo);
    return {
      photoId: photo.id,
      owned: false,
      status: photo.status,
      itemStatus: item.status,
    };
  }

  let patch: Database["public"]["Tables"]["rachandzach_photos"]["Update"];
  if (item.status === "approved") {
    if (options.publishApproved === false) {
      return {
        photoId: photo.id,
        owned: true,
        status: photo.status,
        itemStatus: item.status,
      };
    }
    if (!photo.processing_complete) {
      throw new UnprocessableItemStateError(
        `Catalog photo ${photo.id} has not finished processing.`,
      );
    }
    // A later catalog hide is authoritative. An approval retry must not make
    // manually hidden content visible again.
    if (photo.status === "hidden") {
      return {
        photoId: photo.id,
        owned: true,
        status: photo.status,
        itemStatus: item.status,
      };
    }
    const caption = await resolveApprovedCaption(
      client,
      item.batch_id,
      item.note_approved,
    );
    patch = {
      status: "published",
      uploader_caption: caption?.text ?? null,
      uploader_caption_byline: null,
      approved_at: photo.approved_at ?? new Date().toISOString(),
    };
  } else if (
    item.status === "pending" ||
    item.status === "rejected" ||
    item.status === "removed"
  ) {
    patch = {
      status: item.status === "pending" ? "pending" : "rejected",
      uploader_caption: null,
      uploader_caption_byline: null,
      approved_at: null,
    };
  } else {
    throw new UnprocessableItemStateError(
      `Upload item ${itemId} has unsupported status "${item.status}".`,
    );
  }

  const { data: updated, error } = await client
    .from("rachandzach_photos")
    .update(patch)
    .eq("id", photo.id)
    .eq("submitted_batch_id", item.batch_id)
    .eq("status", photo.status)
    .select("*")
    .maybeSingle();
  if (error) {
    throw new ModerationPersistenceError(
      "Could not reconcile the catalog photo.",
    );
  }
  if (!updated) {
    // Visibility or ownership changed after the read. Re-observe and leave
    // the newer state authoritative instead of broadening the update.
    const current = await fetchPhoto(client, photo.id);
    return {
      photoId: photo.id,
      owned: current?.submitted_batch_id === item.batch_id,
      status: current?.status ?? photo.status,
      itemStatus: item.status,
    };
  }

  const row = updated as PhotoRow;
  return {
    photoId: row.id,
    owned: true,
    status: row.status,
    itemStatus: item.status,
  };
}

/**
 * Locates the catalog photo an already-approved upload item produced, by
 * re-deriving the same content hash processApprovedPhoto uses as identity.
 * Used by the metadata-edit route: upload_items carries no photo_id column,
 * so "which photo did this item become" is answered by recomputing the
 * identity, not by a stored foreign key. Returns null for an item that has
 * not been approved (or approval never produced a photo).
 */
export async function findPhotoForApprovedItem(
  itemId: string,
  client: Db,
): Promise<PhotoRow | null> {
  const item = await fetchUploadItem(client, itemId);
  if (!item || item.status !== "approved") return null;

  // processApprovedPhoto persists the server-verified hash onto the item row
  // (see above); prefer it so this lookup is a single indexed query. Fall
  // back to re-deriving from the original only for a pre-upgrade row that
  // was approved before that write existed.
  const fileSha256 =
    item.sha256 ?? sha256Hex(await downloadObject(client, GUEST_PENDING_BUCKET, item.object_path));

  return findExistingGuestPhoto(client, fileSha256);
}
