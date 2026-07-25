/**
 * Gallery discovery query layer (packet 06).
 *
 * The data boundary is INJECTABLE: every public function takes a
 * `GalleryDataSource`. Production wires a Supabase service-role source
 * (createSupabaseGalleryDataSource, lazily imported so unit tests never pull
 * in the Supabase client). Tests inject an in-memory fixture source, so the
 * paging, filtering, status-isolation, cursor, ids-lookup, and facet logic in
 * this file is exercised directly with no live database.
 *
 * Invariants enforced here (defense in depth; the SQL source also filters):
 *  - Guests only ever see approved photos. Pending/hidden/rejected are never
 *    returned, from any entry point, including the ids exact-order lookup.
 *  - The sort is a STRICT TOTAL ORDER (a final id tiebreak), so opaque
 *    value-cursors page the full catalog with no duplicates and no gaps.
 *  - Person discovery uses CONFIRMED metadata only. Uncertain and background
 *    tags never drive chips, filters, or facet counts.
 *  - Object paths are internal. Callers must sign preview objects (see
 *    signed-previews.ts) and strip paths before serializing to the client.
 */
import {
  PREVIEW_URL_TTL_SECONDS,
  previewExpiresAt,
} from "@/lib/gallery/signed-previews";

// ---------------------------------------------------------------------------
// Public vocabulary
// ---------------------------------------------------------------------------

export type GallerySort = "weekend" | "newest";
export type GalleryOrientation = "portrait" | "landscape" | "square";
/** Client vocabulary. The database stores 'master'; we present 'photographer'. */
export type GallerySource = "photographer" | "guest";

export const GALLERY_SORTS: readonly GallerySort[] = ["weekend", "newest"];
export const GALLERY_ORIENTATIONS: readonly GalleryOrientation[] = [
  "portrait",
  "landscape",
  "square",
];
export const GALLERY_SOURCES: readonly GallerySource[] = [
  "photographer",
  "guest",
];

export const DEFAULT_GALLERY_LIMIT = 60;
export const MAX_GALLERY_LIMIT = 100;
export const MAX_IDS_LOOKUP = 100;
export const MAX_GALLERY_SEARCH_LENGTH = 120;
export const DEFAULT_GALLERY_SORT: GallerySort = "weekend";

/** The only photo status a guest may ever see. */
export const VISIBLE_PHOTO_STATUS = "published";

export interface GalleryQueryInput {
  cursor?: string | null;
  limit?: number | null;
  /**
   * Exact-order id lookup, max 100. When set, return exactly these approved
   * photos in this order and ignore person/event/orientation/source/sort.
   * Status isolation still applies; unknown and non-approved ids are dropped.
   */
  ids?: string[] | null;
  q?: string | null;
  person?: string | null;
  event?: string | null;
  orientation?: GalleryOrientation | null;
  source?: GallerySource | null;
  sort?: GallerySort | null;
}

/** Invalid caller input. Route handlers map this to HTTP 400. */
export class GalleryQueryError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "GalleryQueryError";
  }
}

// ---------------------------------------------------------------------------
// Data-source boundary (the injectable seam)
// ---------------------------------------------------------------------------

export type PreviewFormat = "avif" | "webp" | "jpeg";

export interface GalleryPreviewObject {
  /** Internal private-storage path. Never serialized to the client. */
  objectPath: string;
  bucket: string;
  width: number;
  format: PreviewFormat;
}

export interface GalleryPersonLink {
  slug: string;
  displayName: string;
  /** Only 'confirmed' links are shown or filterable; the rest are ignored. */
  confidence: "confirmed" | "uncertain" | "background";
}

/**
 * One catalog row with its joins already resolved. The source may pre-filter
 * to approved photos (the SQL source does); this layer re-applies status
 * isolation regardless, so a leaky source can never surface a hidden photo.
 */
export interface GalleryPhotoSource {
  id: string;
  status: string;
  source: GallerySource;
  eventSlug: string;
  eventName: string;
  eventOrder: number;
  capturedAt: string | null;
  originalFilename: string;
  width: number;
  height: number;
  orientation: GalleryOrientation;
  people: GalleryPersonLink[];
  keywords: string[];
  approvedCaption?: {
    text: string;
    byline: string | null;
  } | null;
  previews: GalleryPreviewObject[];
}

export interface GalleryEventMeta {
  slug: string;
  name: string;
  order: number;
}

export interface GalleryPersonMeta {
  slug: string;
  displayName: string;
}

export interface GalleryDataSource {
  /** Every catalog photo with joins resolved. */
  listPhotos(): Promise<GalleryPhotoSource[]>;
  /** Canonical event metadata (name + weekend order). */
  listEvents(): Promise<GalleryEventMeta[]>;
  /** Canonical person metadata (display name). */
  listPeople(): Promise<GalleryPersonMeta[]>;
}

// ---------------------------------------------------------------------------
// Output views
// ---------------------------------------------------------------------------

export interface GalleryPreviewView {
  objectPath: string;
  bucket: string;
  width: number;
  height: number;
  format: PreviewFormat;
}

export interface GalleryPersonView {
  slug: string;
  displayName: string;
}

export interface GalleryPhotoView {
  id: string;
  eventSlug: string;
  eventName: string;
  source: GallerySource;
  orientation: GalleryOrientation;
  width: number;
  height: number;
  aspectRatio: number;
  capturedAt: string | null;
  /** Confirmed people only. */
  people: GalleryPersonView[];
  keywords: string[];
  approvedCaption: {
    text: string;
    byline: string | null;
  } | null;
  /** Preview descriptors incl. object paths; sign + strip before client I/O. */
  previews: GalleryPreviewView[];
}

export interface GalleryPage {
  photos: GalleryPhotoView[];
  nextCursor: string | null;
  /** Count of photos matching the filters (independent of cursor/limit). */
  total: number;
  signedUrlExpiresAt: string;
}

export interface GalleryPhotoDetail {
  photo: GalleryPhotoView;
  related: GalleryPhotoView[];
  signedUrlExpiresAt: string;
}

export interface GalleryFacets {
  events: { slug: string; name: string; count: number }[];
  people: { slug: string; displayName: string; count: number }[];
}

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

interface NormalizedQuery {
  cursor: string | null;
  limit: number;
  ids: string[] | null;
  q: string;
  person: string | null;
  event: string | null;
  orientation: GalleryOrientation | null;
  source: GallerySource | null;
  sort: GallerySort;
}

function normalizeLimit(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return DEFAULT_GALLERY_LIMIT;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_GALLERY_LIMIT;
  }
  const truncated = Math.trunc(raw);
  if (truncated < 1) return DEFAULT_GALLERY_LIMIT;
  return Math.min(truncated, MAX_GALLERY_LIMIT);
}

function normalizeEnum<T extends string>(
  raw: string | null | undefined,
  allowed: readonly T[],
  field: string,
): T | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new GalleryQueryError(
      `Invalid ${field} "${raw}". Allowed: ${allowed.join(", ")}.`,
    );
  }
  return raw as T;
}

function normalizeSlug(
  raw: string | null | undefined,
  field: string,
): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(raw)) {
    throw new GalleryQueryError(`Invalid ${field} slug "${raw}".`);
  }
  return raw;
}

function normalizeIds(raw: string[] | null | undefined): string[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) {
    throw new GalleryQueryError("ids must be an array of photo ids.");
  }
  if (raw.length > MAX_IDS_LOOKUP) {
    throw new GalleryQueryError(
      `ids lookup accepts at most ${MAX_IDS_LOOKUP} ids (received ${raw.length}).`,
    );
  }
  for (const id of raw) {
    if (typeof id !== "string" || id.length === 0) {
      throw new GalleryQueryError("Every id must be a non-empty string.");
    }
  }
  return raw;
}

function normalizeSearch(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") {
    throw new GalleryQueryError("q must be a string.");
  }
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (normalized.length > MAX_GALLERY_SEARCH_LENGTH) {
    throw new GalleryQueryError(
      `q accepts at most ${MAX_GALLERY_SEARCH_LENGTH} characters.`,
    );
  }
  return normalized;
}

export function normalizeGalleryQuery(input: GalleryQueryInput): NormalizedQuery {
  return {
    cursor: input.cursor ?? null,
    limit: normalizeLimit(input.limit),
    ids: normalizeIds(input.ids),
    q: normalizeSearch(input.q),
    person: normalizeSlug(input.person, "person"),
    event: normalizeSlug(input.event, "event"),
    orientation: normalizeEnum(
      input.orientation,
      GALLERY_ORIENTATIONS,
      "orientation",
    ),
    source: normalizeEnum(input.source, GALLERY_SOURCES, "source"),
    sort: normalizeEnum(input.sort, GALLERY_SORTS, "sort") ?? DEFAULT_GALLERY_SORT,
  };
}

/** Parse a URLSearchParams (or plain record) into a GalleryQueryInput. */
export function parseGalleryQuery(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): GalleryQueryInput {
  const get = (key: string): string | undefined => {
    if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const rawLimit = get("limit");
  const rawIds = params instanceof URLSearchParams
    ? params.getAll("ids")
    : toArray((params as Record<string, string | string[] | undefined>).ids);
  const idsCsv = get("ids");
  const ids =
    rawIds.length > 1
      ? rawIds
      : idsCsv && idsCsv.includes(",")
        ? idsCsv.split(",").map((s) => s.trim()).filter(Boolean)
        : rawIds.length === 1
          ? rawIds
          : null;
  return {
    cursor: get("cursor") ?? null,
    limit: rawLimit === undefined ? null : Number.parseInt(rawLimit, 10),
    ids: ids && ids.length > 0 ? ids : null,
    q: get("q") ?? null,
    person: get("person") ?? null,
    event: get("event") ?? null,
    orientation: (get("orientation") as GalleryOrientation | undefined) ?? null,
    source: (get("source") as GallerySource | undefined) ?? null,
    sort: (get("sort") as GallerySort | undefined) ?? null,
  };
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// ---------------------------------------------------------------------------
// Status isolation, filtering, confirmed-people
// ---------------------------------------------------------------------------

function isVisible(photo: GalleryPhotoSource): boolean {
  return photo.status === VISIBLE_PHOTO_STATUS;
}

function confirmedPeople(photo: GalleryPhotoSource): GalleryPersonLink[] {
  return photo.people.filter((p) => p.confidence === "confirmed");
}

function searchableText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US");
}

function matchesSearch(photo: GalleryPhotoSource, rawQuery: string): boolean {
  if (!rawQuery) return true;
  const haystack = searchableText(
    [
      photo.eventName,
      photo.eventSlug,
      photo.originalFilename,
      ...confirmedPeople(photo).flatMap((person) => [
        person.displayName,
        person.slug,
      ]),
      ...photo.keywords,
      photo.approvedCaption?.text ?? "",
      photo.approvedCaption?.byline ?? "",
    ].join(" "),
  );
  return searchableText(rawQuery)
    .split(" ")
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function matchesFilters(
  photo: GalleryPhotoSource,
  query: NormalizedQuery,
): boolean {
  if (!matchesSearch(photo, query.q)) return false;
  if (query.event && photo.eventSlug !== query.event) return false;
  if (query.orientation && photo.orientation !== query.orientation) return false;
  if (query.source && photo.source !== query.source) return false;
  if (query.person) {
    const hit = confirmedPeople(photo).some((p) => p.slug === query.person);
    if (!hit) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Strict total order + opaque cursor
// ---------------------------------------------------------------------------

interface SortKey {
  eventOrder: number;
  capturedAt: string | null;
  originalFilename: string;
  id: string;
}

function sortKeyOf(photo: GalleryPhotoSource): SortKey {
  return {
    eventOrder: photo.eventOrder,
    capturedAt: photo.capturedAt,
    originalFilename: photo.originalFilename,
    id: photo.id,
  };
}

function cmpString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Ascending compare with nulls sorted LAST regardless of direction. */
function cmpNullableAsc(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return cmpString(a, b);
}

/**
 * Strict total order. `weekend` walks the day forward; `newest` is the reverse
 * of the same order EXCEPT null capture times still sort last (they are the
 * "unknown when" bucket, never surfaced as the newest). The final id tiebreak
 * guarantees a unique position for every photo, which is what makes the
 * value-cursor gap- and duplicate-free.
 */
export function compareBySortKey(a: SortKey, b: SortKey, sort: GallerySort): number {
  if (sort === "weekend") {
    return (
      a.eventOrder - b.eventOrder ||
      cmpNullableAsc(a.capturedAt, b.capturedAt) ||
      cmpString(a.originalFilename, b.originalFilename) ||
      cmpString(a.id, b.id)
    );
  }
  // newest: most recent capture first; unknown capture times last.
  const capturedDesc =
    a.capturedAt === null && b.capturedAt === null
      ? 0
      : a.capturedAt === null
        ? 1
        : b.capturedAt === null
          ? -1
          : cmpString(b.capturedAt, a.capturedAt);
  return (
    capturedDesc ||
    b.eventOrder - a.eventOrder ||
    cmpString(b.originalFilename, a.originalFilename) ||
    cmpString(b.id, a.id)
  );
}

interface CursorPayload {
  v: 1;
  sort: GallerySort;
  key: SortKey;
}

export function encodeCursor(photo: GalleryPhotoSource, sort: GallerySort): string {
  const payload: CursorPayload = { v: 1, sort, key: sortKeyOf(photo) };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string, expectedSort: GallerySort): SortKey {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new GalleryQueryError("Malformed cursor.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new GalleryQueryError("Malformed cursor.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { v?: unknown }).v !== 1
  ) {
    throw new GalleryQueryError("Unsupported cursor version.");
  }
  const payload = parsed as Partial<CursorPayload>;
  if (payload.sort !== expectedSort) {
    throw new GalleryQueryError(
      "Cursor does not match the current sort; restart paging.",
    );
  }
  const key = payload.key;
  if (
    !key ||
    typeof key.eventOrder !== "number" ||
    typeof key.originalFilename !== "string" ||
    typeof key.id !== "string" ||
    !(key.capturedAt === null || typeof key.capturedAt === "string")
  ) {
    throw new GalleryQueryError("Malformed cursor payload.");
  }
  return {
    eventOrder: key.eventOrder,
    capturedAt: key.capturedAt,
    originalFilename: key.originalFilename,
    id: key.id,
  };
}

// ---------------------------------------------------------------------------
// View mapping
// ---------------------------------------------------------------------------

function normalizeForCompare(value: string): string {
  return value.toLowerCase().trim();
}

/**
 * Many photos in this catalog had their tagged people's names baked into the
 * embedded Keywords field by the tool that prepared the clean master, so the
 * same name would otherwise render twice: once as a confirmed-person chip,
 * once as plain keyword text. Drop any keyword that case-insensitively
 * matches a confirmed person's display name or slug ON THIS PHOTO. A name
 * that merely exists elsewhere in the catalog but isn't tagged here is left
 * alone -- this is a per-photo dedupe, not a global name blocklist.
 */
function dedupeKeywordsAgainstPeople(
  keywords: string[],
  people: GalleryPersonLink[],
): string[] {
  if (people.length === 0) return [...keywords];
  const personTokens = new Set<string>();
  for (const person of people) {
    personTokens.add(normalizeForCompare(person.displayName));
    personTokens.add(normalizeForCompare(person.slug));
  }
  return keywords.filter(
    (keyword) => !personTokens.has(normalizeForCompare(keyword)),
  );
}

/**
 * Presentation-only event names. The source folder named "Film" contains
 * still photographs made on a film camera; spell that out so the gallery
 * never reads like a video or movie experience.
 */
export function displayEventName(slug: string, sourceName: string): string {
  return slug === "film" ? "Film Camera" : sourceName;
}

function toView(photo: GalleryPhotoSource): GalleryPhotoView {
  const aspectRatio = photo.height > 0 ? photo.width / photo.height : 1;
  const people = confirmedPeople(photo);
  return {
    id: photo.id,
    eventSlug: photo.eventSlug,
    eventName: displayEventName(photo.eventSlug, photo.eventName),
    source: photo.source,
    orientation: photo.orientation,
    width: photo.width,
    height: photo.height,
    aspectRatio,
    capturedAt: photo.capturedAt,
    people: people.map((p) => ({
      slug: p.slug,
      displayName: p.displayName,
    })),
    keywords: dedupeKeywordsAgainstPeople(photo.keywords, people),
    approvedCaption: photo.approvedCaption?.text.trim()
      ? {
          text: photo.approvedCaption.text.trim(),
          byline: photo.approvedCaption.byline?.trim() || null,
        }
      : null,
    previews: photo.previews.map((preview) => ({
      objectPath: preview.objectPath,
      bucket: preview.bucket,
      width: preview.width,
      height:
        photo.width > 0
          ? Math.round((preview.width * photo.height) / photo.width)
          : preview.width,
      format: preview.format,
    })),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Page the gallery. `total` is the count matching the filters; `nextCursor` is
 * null once the last page is returned. Approved-only, at every entry point.
 */
export async function getGalleryPage(
  input: GalleryQueryInput,
  dataSource: GalleryDataSource,
): Promise<GalleryPage> {
  const query = normalizeGalleryQuery(input);
  const all = await dataSource.listPhotos();
  const approved = all.filter(isVisible);
  const expiresAt = previewExpiresAt(PREVIEW_URL_TTL_SECONDS);

  // Exact-order id lookup: ignore other filters, keep first occurrence,
  // drop unknown and non-approved ids.
  if (query.ids !== null) {
    const byId = new Map(approved.map((p) => [p.id, p]));
    const emitted = new Set<string>();
    const photos: GalleryPhotoView[] = [];
    for (const id of query.ids) {
      if (emitted.has(id)) continue;
      const found = byId.get(id);
      if (!found) continue;
      emitted.add(id);
      photos.push(toView(found));
    }
    return {
      photos,
      nextCursor: null,
      total: photos.length,
      signedUrlExpiresAt: expiresAt,
    };
  }

  const matched = approved.filter((p) => matchesFilters(p, query));
  matched.sort((a, b) =>
    compareBySortKey(sortKeyOf(a), sortKeyOf(b), query.sort),
  );

  let start = 0;
  if (query.cursor) {
    const cursorKey = decodeCursor(query.cursor, query.sort);
    start = matched.findIndex(
      (p) => compareBySortKey(sortKeyOf(p), cursorKey, query.sort) > 0,
    );
    if (start === -1) start = matched.length;
  }

  const window = matched.slice(start, start + query.limit);
  const hasMore = start + query.limit < matched.length;
  const last = window[window.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last, query.sort) : null;

  return {
    photos: window.map(toView),
    nextCursor,
    total: matched.length,
    signedUrlExpiresAt: expiresAt,
  };
}

/**
 * Facet counts by live group-by over APPROVED photos only. Event counts come
 * from event membership; person counts from CONFIRMED links only. Deliberately
 * does not read any denormalized people.photo_count (that column is for admin
 * reporting; task 13 maintains it).
 */
export async function getGalleryFacets(
  dataSource: GalleryDataSource,
): Promise<GalleryFacets> {
  const [all, events, people] = await Promise.all([
    dataSource.listPhotos(),
    dataSource.listEvents(),
    dataSource.listPeople(),
  ]);
  const approved = all.filter(isVisible);

  const eventName = new Map(events.map((e) => [e.slug, e.name]));
  const eventOrder = new Map(events.map((e) => [e.slug, e.order]));
  const personName = new Map(people.map((p) => [p.slug, p.displayName]));

  const eventCounts = new Map<string, number>();
  const peopleCounts = new Map<string, number>();
  for (const photo of approved) {
    eventCounts.set(photo.eventSlug, (eventCounts.get(photo.eventSlug) ?? 0) + 1);
    for (const person of confirmedPeople(photo)) {
      peopleCounts.set(person.slug, (peopleCounts.get(person.slug) ?? 0) + 1);
    }
  }

  const eventFacets = [...eventCounts.entries()]
    .map(([slug, count]) => ({
      slug,
      name: displayEventName(slug, eventName.get(slug) ?? slug),
      count,
      order: eventOrder.get(slug) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.order - b.order || cmpString(a.slug, b.slug))
    .map(({ slug, name, count }) => ({ slug, name, count }));

  const peopleFacets = [...peopleCounts.entries()]
    .map(([slug, count]) => ({
      slug,
      displayName: personName.get(slug) ?? slug,
      count,
    }))
    .sort(
      (a, b) => b.count - a.count || cmpString(a.displayName, b.displayName),
    );

  return { events: eventFacets, people: peopleFacets };
}

/**
 * A single approved photo plus related photos: same confirmed people first,
 * then same event and adjacent capture time. Returns null for unknown or
 * non-approved photos (guests must not learn a pending photo exists).
 */
export async function getPhotoDetail(
  photoId: string,
  dataSource: GalleryDataSource,
  relatedLimit = 12,
): Promise<GalleryPhotoDetail | null> {
  const all = await dataSource.listPhotos();
  const approved = all.filter(isVisible);
  const photo = approved.find((p) => p.id === photoId);
  if (!photo) return null;

  const selfPeople = new Set(confirmedPeople(photo).map((p) => p.slug));
  const capturedMs = photo.capturedAt ? Date.parse(photo.capturedAt) : null;

  const scored = approved
    .filter((candidate) => candidate.id !== photo.id)
    .map((candidate) => {
      const shared = confirmedPeople(candidate).filter((p) =>
        selfPeople.has(p.slug),
      ).length;
      const sameEvent = candidate.eventSlug === photo.eventSlug ? 1 : 0;
      const candidateMs = candidate.capturedAt
        ? Date.parse(candidate.capturedAt)
        : null;
      const timeDelta =
        capturedMs !== null && candidateMs !== null
          ? Math.abs(candidateMs - capturedMs)
          : Number.MAX_SAFE_INTEGER;
      return { candidate, shared, sameEvent, timeDelta };
    })
    .sort(
      (a, b) =>
        b.shared - a.shared ||
        b.sameEvent - a.sameEvent ||
        a.timeDelta - b.timeDelta ||
        cmpString(a.candidate.id, b.candidate.id),
    );

  return {
    photo: toView(photo),
    related: scored.slice(0, relatedLimit).map((s) => toView(s.candidate)),
    signedUrlExpiresAt: previewExpiresAt(PREVIEW_URL_TTL_SECONDS),
  };
}
