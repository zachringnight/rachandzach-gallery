export type GalleryEvent = {
  name: string;
  slug: string;
  count: number;
};

export type GalleryPerson = {
  name: string;
  aliases: string[];
  count: number;
};

export type GalleryPhoto = {
  id: string;
  event: string;
  eventSlug: string;
  filename: string;
  number: number | null;
  sourcePath?: string;
  thumbSrc: string;
  fullSrc: string;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
  duplicateOf?: string | null;
  correctionAction?: string | null;
  correctionNotes?: string | null;
  people: string[];
  keywords: string[];
};

export type GalleryData = {
  generatedAt: string;
  source: string;
  stats: {
    photos: number;
    people: number;
    events: number;
    exactDuplicateFiles?: number;
    correctionsApplied?: number;
    excludedEvents?: string[];
  };
  events: GalleryEvent[];
  people: GalleryPerson[];
  photos: GalleryPhoto[];
};

// ---------------------------------------------------------------------------
// v2 catalog (read-only clean-master import pipeline, scripts/build-gallery-v2.mjs)
// Emitted as src/generated/gallery-v2.json. The legacy types above described
// the old static build (src/generated/gallery.json), deleted at the packet 12
// cutover; they remain only for historical type references.
// ---------------------------------------------------------------------------

export type PhotoOrientation = "portrait" | "landscape" | "square";

export type PreviewFormat = "avif" | "webp" | "jpeg";

/** A planned or generated immutable display derivative in private storage. */
export type PreviewObject = {
  /** previews/{imageDataHash}/{width}.{format} */
  objectPath: string;
  width: number;
  height: number;
  format: PreviewFormat;
  /** Always "public,max-age=31536000,immutable". */
  cacheControl: string;
};

export type GalleryPhotoRecord = {
  id: string;
  /** Stable visual identity from the clean-master manifest (exiftool ImageDataHash, MD5). */
  imageDataHash: string;
  /** SHA-256 of the complete current source JPEG bytes. Downloads must match byte for byte. */
  fileSha256: string;
  originalRelativePath: string;
  originalFilename: string;
  originalBytes: number;
  width: number;
  height: number;
  orientation: PhotoOrientation;
  eventSlug: string;
  /** EXIF DateTimeOriginal (+offset when present). Null when not embedded; never inferred. */
  capturedAt: string | null;
  peopleSlugs: string[];
  keywords: string[];
  previewObjects: PreviewObject[];
  source: "photographer" | "guest";
  status: "approved";
};

export type GalleryPersonRecord = {
  slug: string;
  /** Authoritative display label from the manifest's final_people column. */
  name: string;
  photoCount: number;
};

export type GalleryEventRecord = {
  slug: string;
  name: string;
  /** Position in the canonical weekend event order. */
  order: number;
  photoCount: number;
};

export type ImportIssue = {
  type: string;
  path: string | null;
  imageDataHash: string | null;
  message: string;
};

export type ImportStats = {
  manifestRows: number;
  importedPhotos: number;
  rejectedRows: number;
  people: number;
  events: number;
  totalOriginalBytes: number;
  issues: ImportIssue[];
};

export type GalleryCatalog = {
  generatedAt: string;
  sourceRoot: string;
  photos: GalleryPhotoRecord[];
  people: GalleryPersonRecord[];
  events: GalleryEventRecord[];
  stats: ImportStats;
};

export type DerivativePlan = {
  imageDataHash: string;
  width: number;
  height: number;
  format: PreviewFormat;
  objectPath: string;
  cacheControl: string;
  quality: number;
};
