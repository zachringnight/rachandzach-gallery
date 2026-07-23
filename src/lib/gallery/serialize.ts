import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { signPreviewUrls, type SignablePreview } from "@/lib/gallery/signed-previews";
import type {
  GalleryPage,
  GalleryPhotoDetail,
  GalleryPhotoView,
} from "@/lib/gallery/query";
import type {
  ClientGalleryPage,
  ClientPhoto,
  ClientPhotoDetail,
} from "@/lib/gallery/client-types";

/**
 * Turn internal gallery views into client DTOs, batch-signing preview objects
 * and DROPPING every object path on the way out. This is the only boundary
 * where preview objects become URLs; nothing downstream sees a storage path.
 */

function collectPreviews(views: GalleryPhotoView[]): SignablePreview[] {
  const previews: SignablePreview[] = [];
  for (const view of views) {
    for (const preview of view.previews) {
      previews.push({ bucket: preview.bucket, objectPath: preview.objectPath });
    }
  }
  return previews;
}

function toClientPhoto(
  view: GalleryPhotoView,
  urls: Map<string, string>,
): ClientPhoto {
  const previews = view.previews
    .map((preview) => {
      const url = urls.get(preview.objectPath);
      if (!url) return null;
      return {
        url,
        width: preview.width,
        height: preview.height,
        format: preview.format,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => a.width - b.width);
  return {
    id: view.id,
    eventSlug: view.eventSlug,
    eventName: view.eventName,
    source: view.source,
    orientation: view.orientation,
    width: view.width,
    height: view.height,
    aspectRatio: view.aspectRatio,
    capturedAt: view.capturedAt,
    people: view.people,
    keywords: view.keywords,
    previews,
  };
}

export async function serializeGalleryPage(
  page: GalleryPage,
  client: SupabaseClient<Database>,
): Promise<ClientGalleryPage> {
  const { urls, expiresAt } = await signPreviewUrls(
    client,
    collectPreviews(page.photos),
  );
  return {
    photos: page.photos.map((view) => toClientPhoto(view, urls)),
    nextCursor: page.nextCursor,
    total: page.total,
    signedUrlExpiresAt: expiresAt,
  };
}

export async function serializePhotoDetail(
  detail: GalleryPhotoDetail,
  client: SupabaseClient<Database>,
): Promise<ClientPhotoDetail> {
  const allViews = [detail.photo, ...detail.related];
  const { urls, expiresAt } = await signPreviewUrls(
    client,
    collectPreviews(allViews),
  );
  return {
    photo: toClientPhoto(detail.photo, urls),
    related: detail.related.map((view) => toClientPhoto(view, urls)),
    signedUrlExpiresAt: expiresAt,
  };
}
