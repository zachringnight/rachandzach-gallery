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
  /**
   * Ordered small -> large; empty if none could be signed. A width may carry
   * two formats (an AVIF primary plus its signed WebP/JPEG fallback for the
   * <picture> negotiation in PhotoImage); within a shared width the
   * most-compatible format sorts first, so previews[0] favors a URL any
   * browser can decode whenever one was stored at the smallest width.
   */
  previews: ClientPreview[];
  /**
   * Dominant light sampled from the photograph itself at import/build time
   * (design upgrade P3). Null when no sample exists (e.g. a recently
   * approved guest upload).
   */
  light?: ClientPhotoLight | null;
  /**
   * Contact-sheet burst membership (design upgrade P4): assigned by the
   * server over the full sorted result set, so pagination windows always
   * agree. Absent/null for photos that are not part of a multi-frame burst.
   */
  burst?: ClientBurst | null;
}

export interface ClientPhotoLight {
  /** '#rrggbb', sampled from the photograph. */
  tint: string;
  /** Mean relative luminance, 0-1. */
  lum: number;
}

export interface ClientBurst {
  /** Stable burst id: the id of the burst's first frame in sort order. */
  id: string;
  /** This frame's position within the burst, 0-based. */
  index: number;
  /** Total frames in the burst within the current result set. */
  size: number;
}

/** One Light Bar gradient stop, averaged from real photo light. */
export interface ClientTimelineStop {
  /** Position within the segment, 0-1. */
  at: number;
  tint: string;
  lum: number;
}

export interface ClientTimelineSegment {
  slug: string;
  name: string;
  /** Index of the segment's first photo in the full sorted result set. */
  start: number;
  count: number;
  stops: ClientTimelineStop[];
}

/** The whole filtered archive mapped onto the arc of the day (P3). */
export interface ClientTimeline {
  total: number;
  segments: ClientTimelineSegment[];
}

export interface ClientGalleryPage {
  photos: ClientPhoto[];
  nextCursor: string | null;
  total: number;
  signedUrlExpiresAt: string;
  /** Null for exact-id lookups, which have no archive order to map. */
  timeline?: ClientTimeline | null;
}

export interface ClientGalleryFacets {
  events: { slug: string; name: string; count: number }[];
  people: {
    slug: string;
    displayName: string;
    count: number;
  }[];
  /**
   * Name resolution for people the pickers no longer offer (hiding is
   * picker-only: a hidden person's filter and tags keep working, so labels
   * must still resolve). Names only, never counts.
   */
  identities?: { slug: string; displayName: string }[];
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
