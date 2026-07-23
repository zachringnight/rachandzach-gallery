/**
 * Packet 13: resumable checkpoint state for the storage and catalog sync.
 *
 * The state file contains hashes, object paths, byte counts, and timestamps
 * ONLY. It must never contain credentials: saveSyncState() rebuilds the
 * serialized document field-by-field from an explicit allowlist, so unknown
 * keys (including anything that looks like a secret) cannot be persisted even
 * if a caller pollutes the in-memory object.
 *
 * Runtime-self-contained on purpose: the plain-node CLI scripts import this
 * file via Node's native type stripping, which does not rewrite import
 * specifiers, so local value imports are forbidden (type-only imports are
 * erased and safe).
 */
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export type SyncStateObject = {
  bucket: string;
  objectPath: string;
  fileSha256: string;
  bytes: number;
  verifiedAt: string;
};

export type SyncStateCatalogEntry = {
  imageDataHash: string;
  upsertedAt: string;
};

export type SyncState = {
  version: 1;
  projectRef: string | null;
  createdAt: string;
  updatedAt: string;
  /** Keyed by `${bucket}/${objectPath}`. */
  objects: Record<string, SyncStateObject>;
  /** Keyed by image_data_hash. */
  catalog: Record<string, SyncStateCatalogEntry>;
};

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_32_64 = /^[0-9a-f]{32,64}$/;

export function objectKey(bucket: string, objectPath: string): string {
  return `${bucket}/${objectPath}`;
}

export function createSyncState(projectRef: string | null): SyncState {
  const now = new Date().toISOString();
  return {
    version: 1,
    projectRef,
    createdAt: now,
    updatedAt: now,
    objects: {},
    catalog: {},
  };
}

function sanitizeObjectRecord(value: unknown): SyncStateObject | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const bucket = record.bucket;
  const objectPath = record.objectPath;
  const fileSha256 = record.fileSha256;
  const bytes = record.bytes;
  const verifiedAt = record.verifiedAt;
  if (
    typeof bucket !== "string" ||
    typeof objectPath !== "string" ||
    typeof fileSha256 !== "string" ||
    !HEX_64.test(fileSha256) ||
    typeof bytes !== "number" ||
    !Number.isInteger(bytes) ||
    bytes < 0 ||
    typeof verifiedAt !== "string"
  ) {
    return null;
  }
  return { bucket, objectPath, fileSha256, bytes, verifiedAt };
}

function sanitizeCatalogEntry(value: unknown): SyncStateCatalogEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const imageDataHash = record.imageDataHash;
  const upsertedAt = record.upsertedAt;
  if (
    typeof imageDataHash !== "string" ||
    !HEX_32_64.test(imageDataHash) ||
    typeof upsertedAt !== "string"
  ) {
    return null;
  }
  return { imageDataHash, upsertedAt };
}

/**
 * Rebuilds a SyncState from unknown input, dropping every field that is not
 * on the allowlist. Used by both load (corrupt/foreign data cannot enter) and
 * save (secrets cannot leave).
 */
export function sanitizeSyncState(value: unknown): SyncState | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  const projectRef = typeof record.projectRef === "string" ? record.projectRef : null;
  const createdAt =
    typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();
  const updatedAt =
    typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString();

  const objects: Record<string, SyncStateObject> = {};
  if (typeof record.objects === "object" && record.objects !== null) {
    for (const [key, raw] of Object.entries(record.objects as Record<string, unknown>)) {
      const sanitized = sanitizeObjectRecord(raw);
      if (sanitized && key === objectKey(sanitized.bucket, sanitized.objectPath)) {
        objects[key] = sanitized;
      }
    }
  }
  const catalog: Record<string, SyncStateCatalogEntry> = {};
  if (typeof record.catalog === "object" && record.catalog !== null) {
    for (const [key, raw] of Object.entries(record.catalog as Record<string, unknown>)) {
      const sanitized = sanitizeCatalogEntry(raw);
      if (sanitized && key === sanitized.imageDataHash) {
        catalog[key] = sanitized;
      }
    }
  }
  return { version: 1, projectRef, createdAt, updatedAt, objects, catalog };
}

/** Returns null when the file does not exist. Throws on unreadable content. */
export async function loadSyncState(path: string): Promise<SyncState | null> {
  let text: string;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Sync state file ${path} is not valid JSON; refusing to guess.`);
  }
  const state = sanitizeSyncState(parsed);
  if (!state) {
    throw new Error(`Sync state file ${path} has an unrecognized shape; refusing to guess.`);
  }
  return state;
}

/** Atomic write (temp file + rename) of the sanitized state only. */
export async function saveSyncState(path: string, state: SyncState): Promise<void> {
  const sanitized = sanitizeSyncState(state);
  if (!sanitized) {
    throw new Error("Refusing to save an invalid sync state.");
  }
  sanitized.updatedAt = new Date().toISOString();
  await fs.mkdir(dirname(path), { recursive: true });
  const tempPath = join(
    dirname(path),
    `.sync-state-${randomBytes(6).toString("hex")}.tmp`,
  );
  await fs.writeFile(tempPath, `${JSON.stringify(sanitized, null, 2)}\n`);
  await fs.rename(tempPath, path);
}

export function recordObject(
  state: SyncState,
  object: Omit<SyncStateObject, "verifiedAt"> & { verifiedAt?: string },
): void {
  const record: SyncStateObject = {
    bucket: object.bucket,
    objectPath: object.objectPath,
    fileSha256: object.fileSha256,
    bytes: object.bytes,
    verifiedAt: object.verifiedAt ?? new Date().toISOString(),
  };
  state.objects[objectKey(record.bucket, record.objectPath)] = record;
}

/** True when the checkpoint already holds this object with the same sha256. */
export function hasVerifiedObject(
  state: SyncState | null,
  bucket: string,
  objectPath: string,
  fileSha256: string,
): boolean {
  if (!state) return false;
  const record = state.objects[objectKey(bucket, objectPath)];
  return Boolean(record && record.fileSha256 === fileSha256);
}

export function recordCatalogRow(state: SyncState, imageDataHash: string): void {
  state.catalog[imageDataHash] = {
    imageDataHash,
    upsertedAt: new Date().toISOString(),
  };
}
