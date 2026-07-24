import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  VISIBLE_PHOTO_STATUS,
  type GalleryDataSource,
  type GalleryEventMeta,
  type GalleryOrientation,
  type GalleryPersonLink,
  type GalleryPersonMeta,
  type GalleryPhotoSource,
  type GalleryPreviewObject,
  type GallerySource,
  type PreviewFormat,
} from "@/lib/gallery/query";

/**
 * Production data source. Reads APPROVED photos with joins via the service-role
 * client (guests never touch tables directly; packet 04's server layer is the
 * only door). The query layer re-applies status isolation, so this pre-filter
 * is an optimization, not the security boundary.
 *
 * Rows are fetched in pages of 1000 (supabase-js default cap) so the full
 * 1,721-photo catalog is returned without silent truncation.
 */

const PAGE_SIZE = 1000;
const SELECT = `
  id,
  status,
  source,
  captured_at,
  original_filename,
  width,
  height,
  uploader_caption,
  uploader_caption_byline,
  event:rachandzach_events ( slug, name, sort_order ),
  people:rachandzach_photo_people (
    confidence,
    person:rachandzach_people ( slug, display_name )
  ),
  keywords:rachandzach_photo_keywords ( keyword ),
  previews:rachandzach_photo_previews ( object_path, bucket, width, format )
` as const;

function orientationOf(width: number, height: number): GalleryOrientation {
  if (width > height) return "landscape";
  if (height > width) return "portrait";
  return "square";
}

function toClientSource(dbSource: string): GallerySource {
  return dbSource === "guest" ? "guest" : "photographer";
}

interface RawEvent {
  slug: string;
  name: string;
  sort_order: number;
}
interface RawPersonLink {
  confidence: string;
  person: { slug: string; display_name: string } | null;
}
interface RawPreview {
  object_path: string;
  bucket: string;
  width: number;
  format: string;
}
interface RawPhotoRow {
  id: string;
  status: string;
  source: string;
  captured_at: string | null;
  original_filename: string;
  width: number | null;
  height: number | null;
  uploader_caption: string | null;
  uploader_caption_byline: string | null;
  event: RawEvent | null;
  people: RawPersonLink[] | null;
  keywords: { keyword: string }[] | null;
  previews: RawPreview[] | null;
}

function mapRow(row: RawPhotoRow): GalleryPhotoSource {
  const width = row.width ?? 0;
  const height = row.height ?? 0;
  const people: GalleryPersonLink[] = (row.people ?? [])
    .filter((link): link is RawPersonLink & { person: NonNullable<RawPersonLink["person"]> } =>
      Boolean(link.person),
    )
    .map((link) => ({
      slug: link.person.slug,
      displayName: link.person.display_name,
      confidence:
        link.confidence === "confirmed" ||
        link.confidence === "uncertain" ||
        link.confidence === "background"
          ? (link.confidence as GalleryPersonLink["confidence"])
          : "uncertain",
    }));
  const previews: GalleryPreviewObject[] = (row.previews ?? [])
    .filter((preview): preview is RawPreview =>
      preview.format === "avif" ||
      preview.format === "webp" ||
      preview.format === "jpeg",
    )
    .map((preview) => ({
      objectPath: preview.object_path,
      bucket: preview.bucket,
      width: preview.width,
      format: preview.format as PreviewFormat,
    }));
  return {
    id: row.id,
    status: row.status,
    source: toClientSource(row.source),
    eventSlug: row.event?.slug ?? "",
    eventName: row.event?.name ?? "",
    eventOrder: row.event?.sort_order ?? Number.MAX_SAFE_INTEGER,
    capturedAt: row.captured_at,
    originalFilename: row.original_filename,
    width,
    height,
    orientation: orientationOf(width, height),
    people,
    keywords: (row.keywords ?? []).map((k) => k.keyword),
    approvedCaption: row.uploader_caption
      ? {
          text: row.uploader_caption,
          byline: row.uploader_caption_byline,
        }
      : null,
    previews,
  };
}

export function createSupabaseGalleryDataSource(
  client: SupabaseClient<Database> = createAdminClient(),
): GalleryDataSource {
  return {
    async listPhotos(): Promise<GalleryPhotoSource[]> {
      const rows: GalleryPhotoSource[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await client
          .from("rachandzach_photos")
          .select(SELECT)
          .eq("status", VISIBLE_PHOTO_STATUS)
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) {
          throw new Error(`Gallery photo query failed: ${error.message}`);
        }
        const page = (data ?? []) as unknown as RawPhotoRow[];
        for (const row of page) rows.push(mapRow(row));
        if (page.length < PAGE_SIZE) break;
      }
      return rows;
    },

    async listEvents(): Promise<GalleryEventMeta[]> {
      const { data, error } = await client
        .from("rachandzach_events")
        .select("slug, name, sort_order");
      if (error) throw new Error(`Gallery event query failed: ${error.message}`);
      return (data ?? []).map((event) => ({
        slug: event.slug,
        name: event.name,
        order: event.sort_order,
      }));
    },

    async listPeople(): Promise<GalleryPersonMeta[]> {
      const { data, error } = await client
        .from("rachandzach_people")
        .select("slug, display_name");
      if (error) throw new Error(`Gallery people query failed: ${error.message}`);
      return (data ?? []).map((person) => ({
        slug: person.slug,
        displayName: person.display_name,
      }));
    },
  };
}
