import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { formatRank } from "@/lib/gallery/preview-format";
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
 * Format preference, mirroring pickTarget and pickFallback in
 * src/components/gallery/PhotoImage.tsx. These MUST agree: this decides
 * what gets signed, those decide what gets rendered, and a mismatch means the
 * client asks for a URL that was never minted.
 */
const rank = formatRank;

/**
 * Per WIDTH: the cheapest format stored at that width, PLUS one
 * universally-decodable fallback for it when that cheapest format is AVIF.
 *
 * The best-per-width half is unchanged: pickTarget chooses a width, then the
 * cheapest format at it, so at most one format per width is ever the primary
 * render. All four WIDTHS are kept because the server cannot know whether a
 * guest will stay on the grid or open the lightbox, and the lightbox reads
 * from the photo object already in memory rather than re-fetching.
 *
 * The fallback half exists because AVIF is not universal: older Safari
 * (macOS Catalina and earlier, iOS < 16) and some TV browsers cannot decode
 * it, and an AVIF-only payload gave those guests broken images. For each
 * width whose best format is AVIF, the nearest WebP/JPEG derivative is also
 * signed so PhotoImage can render a <picture> with an AVIF <source> and a
 * universally-decodable <img>, letting the browser negotiate natively.
 * Widths whose best format is already WebP or JPEG need no companion, and a
 * photo with no non-AVIF rows at all just keeps its AVIF-only set (degraded
 * exactly as before, never worse).
 *
 * Cost, stated precisely: this adds at most one signed URL per width -- one
 * per rendered-size decision, not the whole WebP ladder -- so a full-ladder
 * photo goes from 4 signed URLs back up to ~8, and a 60-photo page from ~240
 * to ~480 paths (still 3 chunks under signed-previews' 200-path ceiling).
 * That is response-payload and signing cost only: the browser downloads
 * exactly ONE image per rendered slot, chosen by <picture>, so media egress
 * does not double. AVIF-capable browsers (the overwhelming majority) fetch
 * the same AVIF bytes as before, including the 2400 tier's -73% saving over
 * JPEG; only non-AVIF browsers fetch the larger fallback, which is the
 * point.
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
  const chosen = [...bestByWidth.values()];

  const universal = previews.filter((preview) => preview.format !== "avif");
  const out = new Set<T>(chosen);
  for (const best of chosen) {
    if (best.format !== "avif") continue;
    const fallback = nearestUniversal(universal, best.width);
    if (fallback) out.add(fallback);
  }
  return [...out];
}

/**
 * The non-AVIF derivative closest in width to `width`; ties prefer the wider
 * candidate (never trade down resolution for nothing), then the cheaper
 * format. Mirrors pickFallback in PhotoImage.tsx.
 */
function nearestUniversal<T extends { width: number; format: string }>(
  candidates: readonly T[],
  width: number,
): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (!best) {
      best = candidate;
      continue;
    }
    const delta = Math.abs(candidate.width - width) - Math.abs(best.width - width);
    if (
      delta < 0 ||
      (delta === 0 &&
        (candidate.width > best.width ||
          (candidate.width === best.width &&
            rank(candidate.format) < rank(best.format))))
    ) {
      best = candidate;
    }
  }
  return best;
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
    // Small -> large; within a width, most-compatible format FIRST (jpeg,
    // webp, then avif). Deliberate: naive consumers that grab previews[0]
    // for a bare <img> (filmstrip, capsule module) get a URL every browser
    // can decode, while previews[length - 1] stays the best large format.
    // PhotoImage itself never relies on this order -- it picks explicitly.
    .sort((a, b) => a.width - b.width || rank(b.format) - rank(a.format));
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
