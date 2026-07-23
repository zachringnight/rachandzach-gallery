/**
 * Packet 13: shared contracts for the catalog and private-media sync.
 *
 * Consumed two ways:
 *  - by TypeScript app code through the normal "@/" alias, and
 *  - by the plain-node CLI scripts (scripts/sync-gallery-*.mjs) via Node's
 *    native type stripping, using explicit ".ts" import specifiers.
 *
 * Because Node strips types but does NOT rewrite import specifiers, this file
 * must stay runtime-self-contained: value imports are limited to node builtins
 * and packages ("zod"); anything local is imported as `import type` only
 * (erased at runtime). That is also why the bucket names are re-declared here
 * with a compile-time `satisfies` cross-check against src/lib/supabase/schema
 * instead of a runtime import.
 */
import { promises as fs } from "node:fs";
import { z } from "zod";
import type {
  DerivativePlan,
  GalleryCatalog,
  GalleryPhotoRecord,
} from "../../types/gallery";
import type { StorageBucket } from "../supabase/schema";

// ---------------------------------------------------------------------------
// Buckets, cache policy, and catalog->database value maps
// ---------------------------------------------------------------------------

/** Must equal STORAGE_BUCKETS.originals (compile-time checked below). */
export const ORIGINALS_BUCKET = "rachandzach-originals" satisfies StorageBucket;
/** Must equal STORAGE_BUCKETS.previews (compile-time checked below). */
export const PREVIEWS_BUCKET = "rachandzach-previews" satisfies StorageBucket;

/**
 * Supabase Storage FileOptions.cacheControl is the max-age in seconds (the
 * server stores `max-age=<value>`). Originals are private media: no shared
 * caching. Previews are content-hashed and immutable: one year. The full
 * `public,max-age=31536000,immutable` intent string travels in the catalog
 * record and the photo_previews rows; storage can only express the max-age.
 */
export const ORIGINALS_CACHE_CONTROL_SECONDS = "0";
export const PREVIEWS_CACHE_CONTROL_SECONDS = "31536000";
export const PREVIEW_CACHE_CONTROL_HEADER = "public,max-age=31536000,immutable";

export const ORIGINAL_CONTENT_TYPE = "image/jpeg";
export const PREVIEW_CONTENT_TYPES = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
} as const;

/**
 * The importer catalog (packet 02) and the database schema (packet 03) landed
 * with different vocabularies. The catalog is the input contract; the check
 * constraints in 202607220001_gallery_core.sql are the output contract.
 */
export const CATALOG_TO_DB_SOURCE = {
  photographer: "master",
  guest: "guest",
} as const;

export const CATALOG_TO_DB_STATUS = {
  approved: "published",
} as const;

export const SYNC_DEFAULTS = {
  concurrency: 3,
  maxConcurrency: 8,
  catalogBatchSize: 100,
  resumeStatePath: "metadata/import/gallery-sync-state.json",
  reportPath: "metadata/import/gallery-sync-report.json",
  derivativeRoot: "metadata/import/derivatives",
} as const;

// ---------------------------------------------------------------------------
// Packet interface: SyncOptions / SyncFailure / SyncResult
// ---------------------------------------------------------------------------

export type SyncOptions = {
  /** Real writes. Default false: dry-run plans everything, touches nothing remote. */
  execute: boolean;
  catalogPath: string;
  sourceRoot: string;
  derivativeRoot: string;
  /** Parallel object operations. Default 3, hard maximum 8. */
  concurrency: number;
  resumeStatePath: string;
  projectRef: string | null;
  /**
   * Runtime-supplied allowlist of project refs eligible for --execute. There
   * is NO default; an empty or missing allowlist refuses execution.
   */
  allowedProjectRefs?: string[];
  /**
   * Credentials come only from this explicitly named env file (e.g.
   * .env.cloud), never from ambient process.env. Required for --execute.
   */
  envFilePath?: string | null;
  /** Local Supabase stack mode: the env-file URL must be a loopback address. */
  localMode?: boolean;
  reportPath?: string;
  catalogBatchSize?: number;
};

export type SyncFailure = {
  stage: string;
  imageDataHash: string | null;
  objectPath: string | null;
  reason: string;
};

export type SyncResult = {
  planned: number;
  uploadedOriginals: number;
  uploadedPreviews: number;
  skippedExisting: number;
  catalogRowsUpserted: number;
  failed: SyncFailure[];
  sourceHashMismatches: number;
};

export function emptySyncResult(): SyncResult {
  return {
    planned: 0,
    uploadedOriginals: 0,
    uploadedPreviews: 0,
    skippedExisting: 0,
    catalogRowsUpserted: 0,
    failed: [],
    sourceHashMismatches: 0,
  };
}

// ---------------------------------------------------------------------------
// Catalog validation (zod v4)
// ---------------------------------------------------------------------------

const hex32to64 = /^[0-9a-f]{32,64}$/;
const hex64 = /^[0-9a-f]{64}$/;
const slugPattern = /^[a-z0-9][a-z0-9-]*$/;

const previewObjectSchema = z.object({
  objectPath: z
    .string()
    .regex(/^previews\/[0-9a-f]{32,64}\/\d+\.(avif|webp|jpeg)$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  format: z.enum(["avif", "webp", "jpeg"]),
  cacheControl: z.literal(PREVIEW_CACHE_CONTROL_HEADER),
});

const photoRecordSchema = z.object({
  id: z.string().min(1),
  imageDataHash: z.string().regex(hex32to64),
  fileSha256: z.string().regex(hex64),
  originalRelativePath: z
    .string()
    .min(1)
    .refine((p) => !p.includes("..") && !p.startsWith("/"), {
      message: "originalRelativePath must be relative and traversal-free",
    }),
  originalFilename: z.string().min(1).max(255),
  originalBytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  orientation: z.enum(["portrait", "landscape", "square"]),
  eventSlug: z.string().regex(slugPattern),
  capturedAt: z.string().nullable(),
  peopleSlugs: z.array(z.string().regex(slugPattern)),
  keywords: z.array(z.string().min(1).max(80)),
  previewObjects: z.array(previewObjectSchema),
  source: z.enum(["photographer", "guest"]),
  status: z.literal("approved"),
});

const importIssueSchema = z.object({
  type: z.string(),
  path: z.string().nullable(),
  imageDataHash: z.string().nullable(),
  message: z.string(),
});

const gallerySyncCatalogSchema = z.object({
  generatedAt: z.string(),
  sourceRoot: z.string(),
  photos: z.array(photoRecordSchema),
  people: z.array(
    z.object({
      slug: z.string().regex(slugPattern),
      name: z.string().min(1),
      photoCount: z.number().int().nonnegative(),
    }),
  ),
  events: z.array(
    z.object({
      slug: z.string().regex(slugPattern),
      name: z.string().min(1),
      order: z.number().int().nonnegative(),
      photoCount: z.number().int().nonnegative(),
    }),
  ),
  stats: z.object({
    manifestRows: z.number().int().nonnegative(),
    importedPhotos: z.number().int().nonnegative(),
    rejectedRows: z.number().int().nonnegative(),
    people: z.number().int().nonnegative(),
    events: z.number().int().nonnegative(),
    totalOriginalBytes: z.number().int().nonnegative(),
    issues: z.array(importIssueSchema),
  }),
});

/**
 * Parses and cross-validates a GalleryCatalog. Throws on schema violations,
 * duplicate photo IDs / image_data_hash values (a retry must never be able to
 * create a second photo), duplicate slugs, or dangling slug references.
 */
export function parseSyncCatalog(value: unknown): GalleryCatalog {
  const result = gallerySyncCatalogSchema.safeParse(value);
  if (!result.success) {
    const summary = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Catalog failed validation: ${summary}`);
  }
  const catalog = result.data;

  const problems: string[] = [];
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();
  for (const photo of catalog.photos) {
    if (seenIds.has(photo.id)) {
      problems.push(`duplicate photo id ${photo.id}`);
    }
    if (seenHashes.has(photo.imageDataHash)) {
      problems.push(`duplicate image_data_hash ${photo.imageDataHash}`);
    }
    seenIds.add(photo.id);
    seenHashes.add(photo.imageDataHash);
  }
  const eventSlugs = new Set<string>();
  for (const event of catalog.events) {
    if (eventSlugs.has(event.slug)) problems.push(`duplicate event slug ${event.slug}`);
    eventSlugs.add(event.slug);
  }
  const personSlugs = new Set<string>();
  for (const person of catalog.people) {
    if (personSlugs.has(person.slug)) problems.push(`duplicate person slug ${person.slug}`);
    personSlugs.add(person.slug);
  }
  for (const photo of catalog.photos) {
    if (!eventSlugs.has(photo.eventSlug)) {
      problems.push(`photo ${photo.imageDataHash} references unknown event ${photo.eventSlug}`);
    }
    for (const slug of photo.peopleSlugs) {
      if (!personSlugs.has(slug)) {
        problems.push(`photo ${photo.imageDataHash} references unknown person ${slug}`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`Catalog failed integrity checks: ${problems.join("; ")}`);
  }
  return catalog;
}

// ---------------------------------------------------------------------------
// Object naming
// ---------------------------------------------------------------------------

/**
 * Keeps [A-Za-z0-9._-], replaces everything else with "-", collapses runs,
 * and trims separators, preserving the final extension's leading dot.
 */
export function sanitizeOriginalFilename(filename: string): string {
  const sanitized = filename
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/-+\./g, ".")
    .replace(/\.-+/g, ".")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "");
  return (sanitized || "file").slice(0, 200);
}

/**
 * Deterministic private object path for a source original.
 *
 * The packet's rule is originals/{imageDataHash}/{sanitizedOriginalFilename};
 * the landed migration additionally enforces (constraint
 * rachandzach_photos_original_object_content_hash) that original_object embeds
 * the first 16 hex chars of file_sha256, so a different file can never legally
 * claim the same object path. The filename segment is therefore prefixed with
 * that sha256 fragment.
 */
export function originalObjectPath(
  photo: Pick<GalleryPhotoRecord, "imageDataHash" | "fileSha256" | "originalFilename">,
): string {
  const shaPrefix = photo.fileSha256.slice(0, 16);
  return `originals/${photo.imageDataHash}/${shaPrefix}-${sanitizeOriginalFilename(photo.originalFilename)}`;
}

export function previewContentType(format: DerivativePlan["format"]): string {
  return PREVIEW_CONTENT_TYPES[format];
}

// ---------------------------------------------------------------------------
// Execution gating: --execute + --project-ref + runtime allowlist + env file
// ---------------------------------------------------------------------------

export type SyncCredentials = {
  url: string;
  serviceRoleKey: string;
  /** Optional SUPABASE_PROJECT_REF from the env file, for cross-checking. */
  projectRef: string | null;
};

/**
 * Parses KEY=VALUE lines from an explicitly named env file. This is the ONLY
 * credential path for execution; ambient process.env is never consulted.
 * Values are returned to the caller and must never be logged or persisted.
 */
export async function readCredentialsFromEnvFile(
  envFilePath: string,
): Promise<SyncCredentials> {
  const text = await fs.readFile(envFilePath, "utf8");
  const entries = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries.set(key, value);
  }
  const url = entries.get("SUPABASE_URL") ?? entries.get("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey =
    entries.get("SUPABASE_SERVICE_ROLE_KEY") ?? entries.get("SUPABASE_SECRET_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error(
      `Env file ${envFilePath} must define SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) ` +
        "and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).",
    );
  }
  return { url, serviceRoleKey, projectRef: entries.get("SUPABASE_PROJECT_REF") ?? null };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Fail-closed execution gate. Called before any client is constructed.
 * Dry-run never calls this. Throws with a specific reason on any violation:
 *  - --execute without --project-ref
 *  - missing or empty runtime allowlist (there is deliberately no default)
 *  - project ref not in the allowlist
 *  - missing --env-file
 *  - env-file URL host that does not match the project ref
 *    (`<ref>.supabase.co`), or a non-loopback host in --local mode
 *  - env-file SUPABASE_PROJECT_REF that contradicts --project-ref
 */
export function assertExecutionAllowed(
  options: Pick<
    SyncOptions,
    "execute" | "projectRef" | "allowedProjectRefs" | "envFilePath" | "localMode"
  >,
  credentials: SyncCredentials,
): void {
  if (!options.execute) {
    throw new Error("assertExecutionAllowed called without execute mode");
  }
  const ref = options.projectRef;
  if (!ref) {
    throw new Error("--execute requires an explicit --project-ref. Refusing.");
  }
  const allowlist = options.allowedProjectRefs ?? [];
  if (allowlist.length === 0) {
    throw new Error(
      "--execute requires a runtime --allowlist of project refs; none was supplied. Refusing.",
    );
  }
  if (!allowlist.includes(ref)) {
    throw new Error(
      `Project ref "${ref}" is not in the runtime allowlist. Refusing.`,
    );
  }
  if (!options.envFilePath) {
    throw new Error("--execute requires --env-file; ambient env is never used. Refusing.");
  }
  if (credentials.projectRef && credentials.projectRef !== ref) {
    throw new Error(
      `Env file SUPABASE_PROJECT_REF (${credentials.projectRef}) does not match --project-ref (${ref}). Refusing.`,
    );
  }
  const host = hostOf(credentials.url);
  if (options.localMode) {
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new Error(
        `--local requires a loopback SUPABASE_URL; env file points at "${host}". Refusing.`,
      );
    }
    return;
  }
  if (host !== `${ref}.supabase.co`) {
    throw new Error(
      `Env file SUPABASE_URL host "${host}" does not match project ref "${ref}" ` +
        `(expected ${ref}.supabase.co). Refusing.`,
    );
  }
}
