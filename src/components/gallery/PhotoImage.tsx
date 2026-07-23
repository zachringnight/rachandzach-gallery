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

function pickTarget(
  previews: ClientPreview[],
  tier: PhotoImageTier,
  targetWidth: number,
): ClientPreview | null {
  if (previews.length === 0) return null;
  const ordered = [...previews].sort((a, b) => a.width - b.width);
  if (tier === "thumbnail") return ordered[0];
  if (tier === "lightbox") return ordered[ordered.length - 1];
  return ordered.find((preview) => preview.width >= targetWidth) ?? ordered[ordered.length - 1];
}

/**
 * Progressive gallery image using the existing signed preview tiers.
 *
 * The smallest signed preview sits underneath the target as a soft placeholder;
 * once the target decodes it crossfades in. No storage paths or new derivative
 * pipeline are introduced, and the wrapper reserves the source aspect ratio so
 * the grid never shifts while either image loads.
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
  const placeholder = ordered[0] ?? null;
  const target = pickTarget(ordered, tier, targetWidth);
  const [status, setStatus] = useState({
    url: target?.url ?? null,
    loaded: false,
    failed: false,
  });
  if (status.url !== (target?.url ?? null)) {
    setStatus({
      url: target?.url ?? null,
      loaded: false,
      failed: false,
    });
  }

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
      data-loaded={status.loaded ? "true" : "false"}
      data-failed={status.failed ? "true" : "false"}
    >
      {showPlaceholder ? (
        <img
          src={placeholder.url}
          alt=""
          aria-hidden="true"
          width={placeholder.width}
          height={placeholder.height}
          loading="eager"
          decoding="async"
          className="atlas-photo-image-placeholder"
        />
      ) : null}

      {target && !status.failed ? (
        <img
          src={target.url}
          alt={alt}
          width={photo.width}
          height={photo.height}
          loading={loading}
          decoding="async"
          fetchPriority={fetchPriority}
          className={targetClass}
          onLoad={() => {
            setStatus((current) => ({ ...current, loaded: true }));
            onLoad?.();
          }}
          onError={() => {
            setStatus((current) => ({ ...current, failed: true }));
            onError?.();
          }}
        />
      ) : (
        <span className="atlas-photo-image-fallback">
          {status.failed ? "Preview unavailable" : ""}
        </span>
      )}
    </span>
  );
}
