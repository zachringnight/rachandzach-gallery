import type { ClientGalleryPage, ClientPhoto } from "@/lib/gallery/client-types";
import type { GalleryPhotoSource, GallerySort } from "@/lib/gallery/query";

export const ADMIN_CATALOG_PAGE_SIZE = 36;
export const ADMIN_CATALOG_MAX_SELECTION = 60;

export const ADMIN_CATALOG_NEEDS = [
  "all",
  "missing-people",
  "missing-keywords",
  "missing-event",
  "complete",
] as const;

export type AdminCatalogNeeds = (typeof ADMIN_CATALOG_NEEDS)[number];

export interface AdminCatalogFilters {
  query: string;
  needs: AdminCatalogNeeds;
  event: string | null;
  person: string | null;
  source: "photographer" | "guest" | null;
  sort: GallerySort;
}

export const DEFAULT_ADMIN_CATALOG_FILTERS: AdminCatalogFilters = {
  query: "",
  needs: "all",
  event: null,
  person: null,
  source: null,
  sort: "weekend",
};

export type AdminCatalogCompleteness =
  | "complete"
  | "missing-people"
  | "missing-keywords"
  | "missing-event"
  | "needs-attention";

export interface AdminCatalogPhoto extends ClientPhoto {
  originalFilename: string;
  completeness: AdminCatalogCompleteness;
}

export interface AdminCatalogPage
  extends Omit<ClientGalleryPage, "photos"> {
  photos: AdminCatalogPhoto[];
}

export interface CatalogMetadataPatch {
  photoIds: string[];
  eventSlug?: string | null;
  addPeopleSlugs: string[];
  removePeopleSlugs: string[];
  addKeywords: string[];
  removeKeywords: string[];
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function firstParam(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function optionalSlug(raw: string | undefined): string | null {
  if (!raw || !SLUG_PATTERN.test(raw)) return null;
  return raw;
}

export function parseAdminCatalogFilters(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): AdminCatalogFilters {
  const rawNeeds = firstParam(params, "needs");
  const rawSource = firstParam(params, "source");
  const rawSort = firstParam(params, "sort");
  return {
    query: (firstParam(params, "q") ?? "").trim().slice(0, 120),
    needs: ADMIN_CATALOG_NEEDS.includes(rawNeeds as AdminCatalogNeeds)
      ? (rawNeeds as AdminCatalogNeeds)
      : "all",
    event: optionalSlug(firstParam(params, "event")),
    person: optionalSlug(firstParam(params, "person")),
    source:
      rawSource === "photographer" || rawSource === "guest"
        ? rawSource
        : null,
    sort: rawSort === "newest" ? "newest" : "weekend",
  };
}

function confirmedPeople(photo: GalleryPhotoSource) {
  return photo.people.filter((person) => person.confidence === "confirmed");
}

function meaningfulKeywords(
  photo: Pick<GalleryPhotoSource, "people" | "keywords">,
): string[] {
  const personTokens = new Set<string>();
  for (const person of photo.people) {
    if (person.confidence !== "confirmed") continue;
    personTokens.add(person.slug.toLocaleLowerCase().trim());
    personTokens.add(person.displayName.toLocaleLowerCase().trim());
  }
  return photo.keywords.filter(
    (keyword) => !personTokens.has(keyword.toLocaleLowerCase().trim()),
  );
}

export function catalogCompleteness(
  photo: Pick<GalleryPhotoSource, "eventSlug" | "people" | "keywords">,
): AdminCatalogCompleteness {
  const missingEvent = photo.eventSlug.length === 0;
  const missingPeople = !photo.people.some(
    (person) => person.confidence === "confirmed",
  );
  const missingKeywords = meaningfulKeywords(photo).length === 0;
  const missingCount = Number(missingEvent) + Number(missingPeople) + Number(missingKeywords);
  if (missingCount === 0) return "complete";
  if (missingCount > 1) return "needs-attention";
  if (missingEvent) return "missing-event";
  if (missingPeople) return "missing-people";
  return "missing-keywords";
}

export function filterAdminCatalogPhotos(
  photos: GalleryPhotoSource[],
  filters: AdminCatalogFilters,
): GalleryPhotoSource[] {
  const needle = filters.query.toLocaleLowerCase();
  return photos.filter((photo) => {
    const people = confirmedPeople(photo);
    if (filters.event && photo.eventSlug !== filters.event) return false;
    if (filters.person && !people.some((person) => person.slug === filters.person)) {
      return false;
    }
    if (filters.source && photo.source !== filters.source) return false;

    const completeness = catalogCompleteness(photo);
    if (filters.needs === "complete" && completeness !== "complete") return false;
    if (
      filters.needs === "missing-event" &&
      photo.eventSlug.length > 0
    ) {
      return false;
    }
    if (
      filters.needs === "missing-people" &&
      people.length > 0
    ) {
      return false;
    }
    if (
      filters.needs === "missing-keywords" &&
      meaningfulKeywords(photo).length > 0
    ) {
      return false;
    }

    if (needle.length > 0) {
      const searchable = [
        photo.originalFilename,
        photo.eventName,
        photo.eventSlug,
        ...photo.keywords,
        photo.approvedCaption?.text ?? "",
        photo.approvedCaption?.byline ?? "",
        ...people.flatMap((person) => [person.displayName, person.slug]),
      ]
        .join("\n")
        .toLocaleLowerCase();
      if (!searchable.includes(needle)) return false;
    }
    return true;
  });
}

function normalizedStringArray(
  value: unknown,
  options: { slug?: boolean; maxItems?: number; maxLength?: number } = {},
): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }
  const maxItems = options.maxItems ?? 40;
  const maxLength = options.maxLength ?? 80;
  if (value.length > maxItems) return null;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value as string[]) {
    const trimmed = item.trim();
    if (
      trimmed.length === 0 ||
      trimmed.length > maxLength ||
      (options.slug && !SLUG_PATTERN.test(trimmed))
    ) {
      return null;
    }
    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function overlaps(left: string[], right: string[]): boolean {
  const keys = new Set(left.map((value) => value.toLocaleLowerCase()));
  return right.some((value) => keys.has(value.toLocaleLowerCase()));
}

export function parseCatalogMetadataPatch(
  raw: unknown,
): CatalogMetadataPatch | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const photoIds = normalizedStringArray(body.photoIds, {
    maxItems: ADMIN_CATALOG_MAX_SELECTION,
    maxLength: 36,
  });
  const addPeopleSlugs = normalizedStringArray(body.addPeopleSlugs, {
    slug: true,
  });
  const removePeopleSlugs = normalizedStringArray(body.removePeopleSlugs, {
    slug: true,
  });
  const addKeywords = normalizedStringArray(body.addKeywords);
  const removeKeywords = normalizedStringArray(body.removeKeywords);
  if (
    !photoIds ||
    photoIds.length === 0 ||
    photoIds.some((id) => !UUID_PATTERN.test(id)) ||
    !addPeopleSlugs ||
    !removePeopleSlugs ||
    !addKeywords ||
    !removeKeywords ||
    overlaps(addPeopleSlugs, removePeopleSlugs) ||
    overlaps(addKeywords, removeKeywords)
  ) {
    return null;
  }

  let eventSlug: string | null | undefined;
  if ("eventSlug" in body) {
    if (body.eventSlug === null) {
      eventSlug = null;
    } else if (
      typeof body.eventSlug === "string" &&
      SLUG_PATTERN.test(body.eventSlug)
    ) {
      eventSlug = body.eventSlug;
    } else {
      return null;
    }
  }

  const hasOperation =
    eventSlug !== undefined ||
    addPeopleSlugs.length > 0 ||
    removePeopleSlugs.length > 0 ||
    addKeywords.length > 0 ||
    removeKeywords.length > 0;
  if (!hasOperation) return null;

  return {
    photoIds,
    ...(eventSlug !== undefined ? { eventSlug } : {}),
    addPeopleSlugs,
    removePeopleSlugs,
    addKeywords,
    removeKeywords,
  };
}
