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

/**
 * Format preference, mirroring pickTarget in
 * src/components/gallery/PhotoImage.tsx. These two MUST agree: this decides
 * what gets signed, that decides what gets rendered, and a mismatch means the
 * client asks for a URL that was never minted.
 */
const FORMAT_RANK: Record<string, number> = { avif: 0, webp: 1, jpeg: 2 };

function rank(format: string): number {
  return FORMAT_RANK[format] ?? 99;
}

/**
 * One preview per WIDTH: the cheapest format stored at that width.
 *
 * Each photo has up to 8 derivatives (4 widths x avif/webp, plus a 2400
 * JPEG), and every one of them used to be signed and shipped. The client can
 * only ever render one format per width -- pickTarget chooses a width, then
 * takes the cheapest format available at it -- so the duplicates were pure
 * payload: on a 60-photo page that meant ~480 signed URLs, roughly 144 KB of
 * the JSON response being URL strings the browser would never request, plus
 * the extra signing round trips to mint them.
 *
 * All four WIDTHS are kept. The server cannot know whether a guest will stay
 * on the grid or open the lightbox, and the lightbox reads from the photo
 * object already in memory rather than re-fetching, so every width has to be
 * present up front.
 *
 * NOTE: this codifies an AVIF-only client, which is what already shipped --
 * pickTarget takes AVIF whenever it exists with no feature detection, so the
 * WebP rows were never a working fallback, just unused weight. If a real
 * fallback is ever wanted, it needs a <picture> element on the client AND a
 * change here, together.
 */
function renderablePreviews<T extends { width: number; format: string }>(
  previews: readonly T[],
): T[] {
  const bestByWidth = new Map<number, T>();
  for (const preview of previews) {
    const current = bestByWidth.get(preview.width);
    if (!current || rank(preview.format) < rank(current.format)) {
      bestByWidth.set(preview.width, preview);
    }
  }
  return [...bestByWidth.values()];
}

function collectPreviews(views: GalleryPhotoView[]): SignablePreview[] {
  const previews: SignablePreview[] = [];
  for (const view of views) {
    for (const preview of renderablePreviews(view.previews)) {
      previews.push({ bucket: preview.bucket, objectPath: preview.objectPath });
    }
  }
  return previews;
}

function toClientPhoto(
  view: GalleryPhotoView,
  urls: Map<string, string>,
): ClientPhoto {
  const previews = renderablePreviews(view.previews)
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
    approvedCaption: view.approvedCaption,
    previews,
    light: view.light ?? null,
    burst: view.burst ?? null,
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
    timeline: page.timeline ?? null,
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
