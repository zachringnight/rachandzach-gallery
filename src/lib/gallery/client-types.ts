/**
 * Client-facing gallery DTOs (packet 06).
 *
 * These are what the browser receives: signed preview URLs only, never an
 * object path, bucket-qualified path, or service-role material. Pure types with
 * no runtime dependencies, so both the route handlers (server) and the gallery
 * components (client) may import them.
 */
export type ClientOrientation = "portrait" | "landscape" | "square";
export type ClientSource = "photographer" | "guest";

export interface ClientPreview {
  /** Short-lived signed URL. */
  url: string;
  width: number;
  height: number;
  format: "avif" | "webp" | "jpeg";
}

export interface ClientPhoto {
  id: string;
  eventSlug: string;
  eventName: string;
  source: ClientSource;
  orientation: ClientOrientation;
  width: number;
  height: number;
  aspectRatio: number;
  capturedAt: string | null;
  people: { slug: string; displayName: string }[];
  /** Free-text tags, already deduped against this photo's confirmed people. */
  keywords: string[];
  /** An uploader note copied into the catalog only after admin approval. */
  approvedCaption?: {
    text: string;
    byline: string | null;
  } | null;
  /** Ordered small -> large; empty if none could be signed. */
  previews: ClientPreview[];
}

export interface ClientGalleryPage {
  photos: ClientPhoto[];
  nextCursor: string | null;
  total: number;
  signedUrlExpiresAt: string;
}

export interface ClientGalleryFacets {
  events: { slug: string; name: string; count: number }[];
  people: { slug: string; displayName: string; count: number }[];
}

export interface ClientPhotoDetail {
  photo: ClientPhoto;
  related: ClientPhoto[];
  signedUrlExpiresAt: string;
}

/** The URL query contract, mirrored on both server and client. */
export interface GalleryFilterState {
  q: string;
  person: string | null;
  event: string | null;
  orientation: ClientOrientation | null;
  source: ClientSource | null;
  sort: "weekend" | "newest";
}

export const GALLERY_SEARCH_URL_PARAM = "gallery_q";

export const EMPTY_FILTER_STATE: GalleryFilterState = {
  q: "",
  person: null,
  event: null,
  orientation: null,
  source: null,
  sort: "weekend",
};
