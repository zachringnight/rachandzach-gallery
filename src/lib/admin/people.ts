import type { FaceCrop } from "@/lib/people/face-types";

/**
 * Admin guest manager (/admin/faces) shared vocabulary: DTOs the roster API
 * returns and the request parsers the route handlers apply. Pure data and
 * validation -- no Supabase imports -- so the client screen and unit tests
 * can import it directly. This surface is admin-only; per-person photo
 * counts are fine here (the guest-facing "no comparative counts at rest"
 * rule applies to guest surfaces, not this workbench).
 */

export type AdminFaceKind = "override" | "committed" | "none";

export interface AdminRosterPerson {
  slug: string;
  /** Effective guest-facing name (override rename, else catalog name). */
  displayName: string;
  /** Raw catalog name; null for people added outside the catalog. */
  catalogName: string | null;
  /** Confirmed-photo count (admin-only; 0 for added people). */
  count: number;
  hidden: boolean;
  added: boolean;
  faceKind: AdminFaceKind;
  /**
   * Whether a committed crop actually exists at /faces/{slug}.webp.
   *
   * Distinct from faceKind, which reports what is being shown right now: a
   * person with an override has faceKind "override" and may or may not also
   * have a committed crop underneath. The client needs the underlying fact to
   * know what reverting will fall back to, and must not infer it from the
   * photo count -- the documented unresolved guests have photos and no crop.
   */
  hasCommittedFace: boolean;
  /** Present when faceKind is "override": how to draw the current crop. */
  /**
   * Present when faceKind is "override". `photoId` is the stable identifier;
   * `url` is a signed preview that is re-minted on every load, so it must
   * never be used to decide which photo this is.
   */
  face?: { photoId: string; url: string; aspectRatio: number; crop: FaceCrop };
  /** Last override write, if any. */
  updatedAt: string | null;
}

export interface AdminRoster {
  people: AdminRosterPerson[];
  /** People offered to guests (not hidden). */
  surfacedCount: number;
  /** Surfaced people currently rendering a real face (either kind). */
  withFaceCount: number;
}

export const PERSON_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const MAX_PERSON_SLUG_LENGTH = 80;
export const MAX_DISPLAY_NAME_LENGTH = 120;

export function slugifyPersonName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PERSON_SLUG_LENGTH);
}

export function isValidPersonSlug(slug: string): boolean {
  return (
    typeof slug === "string" &&
    slug.length <= MAX_PERSON_SLUG_LENGTH &&
    PERSON_SLUG_PATTERN.test(slug)
  );
}

function cleanDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0 || trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return null;
  }
  return trimmed;
}

export interface AddPersonRequest {
  displayName: string;
  slug: string;
}

/** POST /api/admin/people body. Returns null when structurally invalid. */
export function parseAddPersonBody(raw: unknown): AddPersonRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as { displayName?: unknown; slug?: unknown };
  const displayName = cleanDisplayName(body.displayName);
  if (!displayName) return null;
  const slug =
    typeof body.slug === "string" && body.slug.length > 0
      ? body.slug
      : slugifyPersonName(displayName);
  if (!isValidPersonSlug(slug)) return null;
  return { displayName, slug };
}

export interface PersonPatchRequest {
  /** undefined = untouched; null = clear the rename; string = set it. */
  displayName?: string | null;
  hidden?: boolean;
}

/** PATCH /api/admin/people/[slug] body. Null when nothing valid to do. */
export function parsePersonPatchBody(raw: unknown): PersonPatchRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as { displayName?: unknown; hidden?: unknown };
  const patch: PersonPatchRequest = {};
  if ("displayName" in body) {
    if (body.displayName === null) {
      patch.displayName = null;
    } else {
      const name = cleanDisplayName(body.displayName);
      if (!name) return null;
      patch.displayName = name;
    }
  }
  if ("hidden" in body) {
    if (typeof body.hidden !== "boolean") return null;
    patch.hidden = body.hidden;
  }
  if (patch.displayName === undefined && patch.hidden === undefined) {
    return null;
  }
  return patch;
}

export interface FacePutRequest {
  photoId: string;
  crop: FaceCrop;
}

/** PUT /api/admin/people/[slug]/face body. Range checks live server-side
 * against the photo's real aspect ratio; this only vets structure. */
export function parseFacePutBody(raw: unknown): FacePutRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as { photoId?: unknown; crop?: unknown };
  if (typeof body.photoId !== "string" || body.photoId.length === 0) {
    return null;
  }
  if (typeof body.crop !== "object" || body.crop === null) return null;
  const crop = body.crop as { x?: unknown; y?: unknown; size?: unknown };
  const numbers = [crop.x, crop.y, crop.size];
  if (!numbers.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return null;
  }
  return {
    photoId: body.photoId,
    crop: {
      x: crop.x as number,
      y: crop.y as number,
      size: crop.size as number,
    },
  };
}
