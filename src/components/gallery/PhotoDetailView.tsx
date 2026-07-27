"use client";

import { useRouter } from "next/navigation";
import type { ClientPhotoDetail } from "@/lib/gallery/client-types";
import { Lightbox } from "@/components/gallery/Lightbox";
import { RelatedPhotos } from "@/components/gallery/RelatedPhotos";

/**
 * Standalone, deep-linked lightbox for /photos/[photoId]. Closing returns to
 * the gallery; a related thumbnail navigates to that photo's own permalink, so
 * every view is shareable and the browser back button behaves.
 */
export function PhotoDetailView({ detail }: { detail: ClientPhotoDetail }) {
  const router = useRouter();
  return (
    <Lightbox
      photo={detail.photo}
      onClose={() => router.push("/photos")}
      filmstrip={
        detail.related.length > 0
          ? {
              photos: [detail.photo, ...detail.related],
              onSelect: (photoId) => router.push(`/photos/${photoId}`),
            }
          : undefined
      }
      footer={
        // The memories wall renders inside Lightbox itself (Round Two), so
        // this footer slot carries only the related strip.
        <RelatedPhotos
          photos={detail.related}
          onOpen={(photoId) => router.push(`/photos/${photoId}`)}
        />
      }
    />
  );
}
