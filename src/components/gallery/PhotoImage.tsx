"use client";

import { useMemo, useState } from "react";

import type { ClientPhoto, ClientPreview } from "@/lib/gallery/client-types";

export type PhotoImageTier = "thumbnail" | "card" | "lightbox";

export interface PhotoImageProps {
  photo: ClientPhoto;
  alt: string;
  tier: PhotoImageTier;
  /** Desired rendered width for card tiles. The smallest sufficient preview wins. */
  targetWidth?: number;
  className?: string;
  imageClassName?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  onLoad?: () => void;
  onError?: () => void;
}

/**
 * Smaller is better, at equal pixel dimensions. AVIF runs roughly 26-34%
 * under WebP here and far under JPEG, with no visible difference at the
 * qualities this pipeline encodes.
 */
const FORMAT_PREFERENCE: Record<ClientPreview["format"], number> = {
  avif: 0,
  webp: 1,
  jpeg: 2,
};

/**
 * Choose which stored derivative to display: first the pixel width the tier
 * needs, then the cheapest format available AT that width.
 *
 * Width and format are picked in that order deliberately. The previous
 * implementation sorted on width alone and took the first match, so which
 * FORMAT it landed on was decided by whatever order PostgREST happened to
 * return the join in. It did select AVIF, but only because the composite-key
 * order puts avif before webp and Array.sort is stable -- change the join,
 * the key, or the sort and every image in the gallery would have silently
 * fallen back to WebP and gotten a third larger. That is now explicit.
 *
 * Selecting by width first also means the lightbox automatically upgrades the
 * moment a 2400 AVIF exists, with no change here.
 */
export function pickTarget(
  previews: ClientPreview[],
  tier: PhotoImageTier,
  targetWidth: number,
): ClientPreview | null {
  if (previews.length === 0) return null;
  const widths = [...new Set(previews.map((preview) => preview.width))].sort(
    (a, b) => a - b,
  );
  const width =
    tier === "thumbnail"
      ? widths[0]
      : tier === "lightbox"
        ? widths[widths.length - 1]
        : (widths.find((candidate) => candidate >= targetWidth) ??
          widths[widths.length - 1]);
  return (
    previews
      .filter((preview) => preview.width === width)
      .sort(
        (a, b) => FORMAT_PREFERENCE[a.format] - FORMAT_PREFERENCE[b.format],
      )[0] ?? null
  );
}

/**
 * The universally-decodable companion for an AVIF target: the non-AVIF
 * preview closest in width to it (ties prefer the wider candidate, then the
 * cheaper format). Serialize.ts's nearestUniversal signs with the same rule,
 * so whatever this picks always arrived with a URL. Returns null when the
 * target already decodes everywhere (WebP/JPEG) or when the photo has no
 * non-AVIF derivative at all -- in which case the AVIF renders bare, exactly
 * the pre-fallback behavior, never worse.
 */
export function pickFallback(
  previews: ClientPreview[],
  target: ClientPreview | null,
): ClientPreview | null {
  if (!target || target.format !== "avif") return null;
  let best: ClientPreview | null = null;
  for (const candidate of previews) {
    if (candidate.format === "avif") continue;
    if (!best) {
      best = candidate;
      continue;
    }
    const delta =
      Math.abs(candidate.width - target.width) -
      Math.abs(best.width - target.width);
    if (
      delta < 0 ||
      (delta === 0 &&
        (candidate.width > best.width ||
          (candidate.width === best.width &&
            FORMAT_PREFERENCE[candidate.format] <
              FORMAT_PREFERENCE[best.format])))
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Progressive gallery image using the existing signed preview tiers.
 *
 * The smallest signed preview sits underneath the target as a soft placeholder;
 * once the target decodes it crossfades in. No storage paths or new derivative
 * pipeline are introduced, and the wrapper reserves the source aspect ratio so
 * the grid never shifts while either image loads.
 *
 * Both images render inside a <picture>: when the chosen preview is AVIF and
 * a WebP/JPEG companion was signed, the AVIF rides an
 * <source type="image/avif"> and the companion is the <img src>, so the
 * browser negotiates the format natively with zero JS feature detection.
 * AVIF-capable browsers fetch exactly the same AVIF bytes as before; only
 * browsers that cannot decode AVIF (older Safari, some TVs) fetch the
 * fallback, and only one of the two is ever downloaded per slot.
 */
export function PhotoImage({
  photo,
  alt,
  tier,
  targetWidth = 0,
  className,
  imageClassName,
  loading = "lazy",
  fetchPriority = "auto",
  onLoad,
  onError,
}: PhotoImageProps) {
  const ordered = useMemo(
    () => [...photo.previews].sort((a, b) => a.width - b.width),
    [photo.previews],
  );
  // Smallest width, best format at it -- NOT ordered[0], whose format at a
  // shared width depends on serializer ordering. Capable browsers keep the
  // cheapest (AVIF) placeholder; the <picture> below covers the rest.
  const placeholder = pickTarget(ordered, "thumbnail", 0);
  const placeholderFallback = pickFallback(ordered, placeholder);
  const target = pickTarget(ordered, tier, targetWidth);
  const targetFallback = pickFallback(ordered, target);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const targetUrl = target?.url ?? null;
  const loaded = targetUrl !== null && loadedUrl === targetUrl;
  const failed = targetUrl !== null && failedUrl === targetUrl;

  const wrapperClass = ["atlas-photo-image", className].filter(Boolean).join(" ");
  const targetClass = ["atlas-photo-image-target", imageClassName]
    .filter(Boolean)
    .join(" ");
  const showPlaceholder =
    placeholder !== null && target !== null && placeholder.url !== target.url;

  return (
    <span
      className={wrapperClass}
      style={{ aspectRatio: photo.aspectRatio > 0 ? photo.aspectRatio : 1 }}
      data-loaded={loaded ? "true" : "false"}
      data-failed={failed ? "true" : "false"}
    >
      {showPlaceholder ? (
        <picture>
          {placeholderFallback ? (
            <source srcSet={placeholder.url} type="image/avif" />
          ) : null}
          <img
            src={placeholderFallback?.url ?? placeholder.url}
            alt=""
            aria-hidden="true"
            width={placeholder.width}
            height={placeholder.height}
            loading="eager"
            decoding="async"
            className="atlas-photo-image-placeholder"
          />
        </picture>
      ) : null}

      {target && !failed ? (
        <picture>
          {targetFallback ? (
            <source srcSet={target.url} type="image/avif" />
          ) : null}
          <img
            src={targetFallback?.url ?? target.url}
            alt={alt}
            width={photo.width}
            height={photo.height}
            loading={loading}
            decoding="async"
            fetchPriority={fetchPriority}
            className={targetClass}
            onLoad={() => {
              setLoadedUrl(target.url);
              setFailedUrl(null);
              onLoad?.();
            }}
            onError={() => {
              setFailedUrl(target.url);
              setLoadedUrl(null);
              onError?.();
            }}
          />
        </picture>
      ) : (
        <span className="atlas-photo-image-fallback">
          {failed ? "Preview unavailable" : ""}
        </span>
      )}
    </span>
  );
}
