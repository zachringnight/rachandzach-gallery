/**
 * Single source of truth for schema-level constants shared between the
 * migrations, the application layer, and the schema tests. Values here MUST
 * stay in lockstep with supabase/migrations/202607220001_gallery_core.sql and
 * 202607220002_storage_policies.sql; tests/database/schema.test.ts
 * cross-checks them against the SQL text.
 */
import type { Database } from "./database.types";

/** All storage buckets. Every one of them is private. */
export const STORAGE_BUCKETS = {
  originals: "rachandzach-originals",
  previews: "rachandzach-previews",
  guestPending: "rachandzach-guest-pending",
  guestApproved: "rachandzach-guest-approved",
  downloadExports: "rachandzach-download-exports",
} as const;

export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

/** Guest uploads: bucket-level MIME allowlist (also enforced in Postgres). */
export const GUEST_UPLOAD_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

/** Guest uploads: 50 MB per file, enforced at the bucket and table level. */
export const GUEST_UPLOAD_MAX_BYTES = 52_428_800;

/** Guest uploads: max files per submitted batch (application-level cap). */
export const GUEST_UPLOAD_MAX_FILES_PER_BATCH = 50;

export const PHOTO_SOURCES = ["master", "guest"] as const;
export const PHOTO_STATUSES = ["published", "hidden", "pending", "rejected"] as const;

export const PHOTO_PERSON_SOURCES = ["embedded", "confirmed", "manual"] as const;
export const PHOTO_PERSON_CONFIDENCES = ["confirmed", "uncertain", "background"] as const;

export const PREVIEW_FORMATS = ["avif", "webp", "jpeg"] as const;

export const UPLOAD_BATCH_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "partially_approved",
  "rejected",
] as const;

export const UPLOAD_ITEM_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "removed",
] as const;

export const MODERATION_ACTIONS = [
  "approve_item",
  "reject_item",
  "restore_item",
  "approve_batch",
  "reject_batch",
  "edit_metadata",
  "move_object",
  "delete_object",
] as const;

export const NOTIFICATION_KINDS = [
  "guest_receipt",
  "admin_new_batch",
  "guest_approved",
  "guest_rejected",
] as const;

export const NOTIFICATION_STATUSES = ["queued", "sent", "failed", "skipped"] as const;

/**
 * rachandzach_guest_favorites.owner_kind values
 * (202607220005_guest_favorites.sql): 'session' keys rows by the anonymous
 * guest session id; 'person' keys them by a self-claimed My Weekend person
 * slug. Enforced by a Postgres check constraint.
 */
export const FAVORITE_OWNER_KINDS = ["session", "person"] as const;
export type FavoriteOwnerKind = (typeof FAVORITE_OWNER_KINDS)[number];

/** Analytics event names. Deliberately coarse and non-identifying. */
export const GALLERY_EVENT_NAMES = [
  "page_view",
  "gallery_open",
  "photo_view",
  "photo_download",
  "favorite_add",
  "favorite_remove",
  "slideshow_start",
  "slideshow_stop",
  "search_run",
  "upload_start",
  "upload_submit",
  "my_weekend_view",
] as const;

/**
 * Allowlisted rachandzach_gallery_events.metadata keys, enforced by a Postgres check
 * constraint (rachandzach_gallery_event_metadata_is_allowed). Values must be scalars;
 * strings are capped at 64 chars and may not contain "@" or "://", so person
 * names, emails, raw URLs, and search text have no field to live in.
 */
export const GALLERY_EVENT_METADATA_KEYS = [
  "surface",
  "event_slug",
  "width_bucket",
  "duration_ms",
  "result_count",
  "page",
  "batch_size",
  "item_count",
  "status",
  "source",
] as const;

export type GalleryEventName = (typeof GALLERY_EVENT_NAMES)[number];
export type GalleryEventMetadataKey = (typeof GALLERY_EVENT_METADATA_KEYS)[number];

// Row aliases required by the packet interface -----------------------------

type PublicTables = Database["public"]["Tables"];

export type EventRow = PublicTables["rachandzach_events"]["Row"];
export type PersonRow = PublicTables["rachandzach_people"]["Row"];
export type PhotoRow = PublicTables["rachandzach_photos"]["Row"];
export type PhotoPersonRow = PublicTables["rachandzach_photo_people"]["Row"];
export type PhotoPreviewRow = PublicTables["rachandzach_photo_previews"]["Row"];
export type UploadBatchRow = PublicTables["rachandzach_upload_batches"]["Row"];
export type UploadItemRow = PublicTables["rachandzach_upload_items"]["Row"];
export type ModerationActionRow = PublicTables["rachandzach_moderation_actions"]["Row"];
export type NotificationLogRow = PublicTables["rachandzach_notification_log"]["Row"];
export type GalleryEventRow = PublicTables["rachandzach_gallery_events"]["Row"];
export type GuestFavoriteRow = PublicTables["rachandzach_guest_favorites"]["Row"];

export type { Database } from "./database.types";
