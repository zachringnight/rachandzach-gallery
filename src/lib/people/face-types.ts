/**
 * Client-safe face types for the Find me picker and the admin face manager.
 *
 * CROP SCHEME (the single documented contract, mirrored by the
 * rachandzach_person_overrides migration and scripts/build-face-thumbnails.mjs):
 *   x    = crop left edge  / image width          (0..1)
 *   y    = crop top  edge  / image height         (0..1)
 *   size = crop square side / min(width, height)  (0..1]
 * All three are fractions of the ORIGINAL photo pixel grid, so one rect
 * applies to every derivative without knowing absolute pixels. The crop is
 * always square in pixel space: side = size * min(W, H).
 *
 * Pure types plus arithmetic only -- no data, no imports -- so both server
 * code and client components may use this module. Guest data (which slugs
 * exist, whose face is which) must always arrive as authenticated,
 * server-rendered props, never from a static import reachable at
 * /_next/static without a session.
 */

export interface FaceCrop {
  x: number;
  y: number;
  size: number;
}

export type ClientPersonFace =
  /** A committed automatic crop exists at /faces/{slug}.webp (session-gated). */
  | { kind: "committed" }
  /** A hand-picked override: CSS-crop this signed preview URL. */
  | {
      kind: "crop";
      /**
       * Stable photo identifier. The signed `url` below is re-minted on every
       * load, so anything deciding WHICH photo this is must compare this.
       */
      photoId: string;
      url: string;
      /** Photo width / height, needed to place a normalized rect with CSS. */
      aspectRatio: number;
      crop: FaceCrop;
    };

/** slug -> how to draw that person's face. Absent slug = initials fallback. */
export type ClientFaceDirectory = Record<string, ClientPersonFace>;

/**
 * Positions a full photo inside a square, overflow-hidden container so that
 * exactly the normalized crop square fills the container. Percentages only,
 * so the same style works at any rendered tile size.
 *
 * Derivation: let A = W/H. The crop side in source pixels is
 * size * min(W, H), so the image must render (W / side) containers wide and
 * (H / side) containers tall, shifted left by x*W and up by y*H (again in
 * container units).
 */
export function faceCropCss(
  crop: FaceCrop,
  aspectRatio: number,
): { width: string; height: string; left: string; top: string } {
  const a = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const size = clampCropSize(crop.size);
  // W and H in units of min(W, H).
  const w = a >= 1 ? a : 1;
  const h = a >= 1 ? 1 : 1 / a;
  const scale = 1 / size;
  // For use with position:absolute inside a position:relative square
  // container: left resolves against container width, top against height.
  return {
    width: `${w * scale * 100}%`,
    height: `${h * scale * 100}%`,
    left: `${-crop.x * w * scale * 100}%`,
    top: `${-crop.y * h * scale * 100}%`,
  };
}

function clampCropSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 1;
  return Math.min(size, 1);
}

/**
 * Validates and clamps a crop so it stays inside the image. Returns null for
 * structurally unusable values (NaN, non-positive size).
 */
export function normalizeFaceCrop(
  raw: { x: number; y: number; size: number },
  aspectRatio: number,
): FaceCrop | null {
  const { x, y, size } = raw;
  if (![x, y, size].every((v) => typeof v === "number" && Number.isFinite(v))) {
    return null;
  }
  if (size <= 0) return null;
  const a = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const clampedSize = Math.min(size, 1);
  // The crop side expressed as a fraction of each axis.
  const sideOfWidth = a >= 1 ? clampedSize / a : clampedSize;
  const sideOfHeight = a >= 1 ? clampedSize : clampedSize * a;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  return {
    x: clamp(x, Math.max(0, 1 - sideOfWidth)),
    y: clamp(y, Math.max(0, 1 - sideOfHeight)),
    size: clampedSize,
  };
}
