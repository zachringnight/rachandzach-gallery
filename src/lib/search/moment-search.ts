/**
 * Moment Search core (packet 07). Finds scenes and objects ("sunset kiss",
 * "champagne toast", "people dancing") via cosine similarity over CLIP
 * embeddings -- never faces, never identity. See "Privacy and model rules"
 * in docs/plans/2026-07-22-0719-digital-wedding-home/packets/07-my-weekend-moment-search.md.
 *
 * The data boundary is INJECTABLE, mirroring src/lib/gallery/query.ts's
 * GalleryDataSource seam: searchMomentsWith(input, deps) is exercised
 * directly by tests/search/moment-search.test.ts with a deterministic vector
 * fixture and an in-memory GalleryDataSource, no live model and no live
 * database. searchMoments(input) is the production-wired convenience
 * function the packet's Interfaces section pins and the API route calls.
 *
 * Defense in depth, same posture query.ts documents for its own SQL source:
 * the RPC (202607220003_moment_search.sql) already joins on
 * rachandzach_photos.status = 'published', but this module re-checks every
 * returned photo id against the APPROVED set from task 06's
 * GalleryDataSource before it is ever allowed into a result. A stale
 * embedding row for a since-hidden or since-rejected photo can therefore
 * never surface here either.
 *
 * Never logs the query string. Nothing in this module calls console.* or any
 * logger with `input.query`.
 *
 * Import hygiene: everything above the "Production wiring" section below
 * (types, normalization, the keyword fallback, searchMomentsWith itself) has
 * NO top-level import of anything tagged "server-only" (src/lib/supabase/
 * admin.ts, src/lib/gallery/supabase-source.ts, and
 * src/lib/search/query-embedding.ts all carry that tag). Those three are
 * loaded via dynamic import() inside searchMoments()'s body instead, exactly
 * like src/lib/auth/guest-session.ts's getGuestSession() keeps
 * next/headers out of proxy.ts's module graph. That is what lets
 * tests/search/moment-search.test.ts import searchMomentsWith,
 * normalizeMomentSearchInput, etc. directly under plain Vitest (no Next.js
 * server-component bundling) without the "server-only" package throwing at
 * import time -- the tainted modules are simply never evaluated unless
 * searchMoments() itself is actually called.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  VISIBLE_PHOTO_STATUS,
  type GalleryDataSource,
  type GalleryPersonView,
  type GalleryPhotoSource,
  type GalleryPhotoView,
} from "@/lib/gallery/query";
import {
  signPreviewUrls,
  PREVIEW_URL_TTL_SECONDS,
  type SignablePreview,
} from "@/lib/gallery/signed-previews";
import { formatRank } from "@/lib/gallery/preview-format";
import type { ClientPhoto } from "@/lib/gallery/client-types";
import { featureFlags } from "@/content/features";
import {
  MOMENT_SEARCH_MIN_QUERY_LENGTH,
  MOMENT_SEARCH_MAX_QUERY_LENGTH,
  type MomentMatchType,
} from "./contracts";

// ---------------------------------------------------------------------------
// Public vocabulary
// ---------------------------------------------------------------------------

// MOMENT_SEARCH_MIN_QUERY_LENGTH, MOMENT_SEARCH_MAX_QUERY_LENGTH, and
// MomentMatchType now live in ./contracts (imported above) so that
// src/components/search/MomentSearch.tsx can import them WITHOUT importing
// this module -- see contracts.ts's doc comment for why. Re-exported here so
// every existing import of "@/lib/search/moment-search" (the API route,
// tests/search/moment-search.test.ts) keeps working unchanged.
export { MOMENT_SEARCH_MIN_QUERY_LENGTH, MOMENT_SEARCH_MAX_QUERY_LENGTH, type MomentMatchType };
export const MOMENT_SEARCH_DEFAULT_LIMIT = 24;
export const MOMENT_SEARCH_MAX_LIMIT = 40;
/** Below this cosine similarity, a vector match is noise, not a moment. */
export const MOMENT_SEARCH_MIN_SIMILARITY = 0.2;

/** Recorded on the same rows scripts/build-embeddings.py writes. */
export const MOMENT_SEARCH_MODEL = "openai/clip-vit-base-patch32" as const;
export const MOMENT_SEARCH_MODEL_VERSION =
  "3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268" as const;

const EVENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface MomentSearchInput {
  query: string;
  event: string | null;
  limit: number;
}

export interface MomentSearchResult {
  photo: GalleryPhotoView;
  similarity: number;
  matchType: MomentMatchType;
}

export type MomentSearchFallbackStage =
  | "feature_flag"
  | "embedding"
  | "vector_search"
  | "no_embedding_matches";

export interface MomentSearchFallbackEvent {
  stage: MomentSearchFallbackStage;
  error?: unknown;
}

export type MomentSearchFallbackReporter = (
  event: MomentSearchFallbackEvent,
) => void;

export interface ClientMomentResult {
  photo: ClientPhoto;
  similarity: number;
  matchType: MomentMatchType;
}

/** Invalid caller input. The API route maps this to HTTP 400. */
export class MomentSearchValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "MomentSearchValidationError";
  }
}

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

interface NormalizedMomentSearchInput {
  query: string;
  event: string | null;
  limit: number;
}

function normalizeLimit(raw: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return MOMENT_SEARCH_DEFAULT_LIMIT;
  }
  const truncated = Math.trunc(raw);
  if (truncated < 1) return MOMENT_SEARCH_DEFAULT_LIMIT;
  return Math.min(truncated, MOMENT_SEARCH_MAX_LIMIT);
}

/**
 * Validates and normalizes raw search input. Query length is a hard gate (2
 * to 80 characters after trimming, per the packet); event slug format is a
 * hard gate when an event is given at all; limit clamps rather than throws,
 * mirroring src/lib/gallery/query.ts's normalizeLimit.
 */
export function normalizeMomentSearchInput(
  input: MomentSearchInput,
): NormalizedMomentSearchInput {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (query.length < MOMENT_SEARCH_MIN_QUERY_LENGTH) {
    throw new MomentSearchValidationError(
      `Search text must be at least ${MOMENT_SEARCH_MIN_QUERY_LENGTH} characters.`,
    );
  }
  if (query.length > MOMENT_SEARCH_MAX_QUERY_LENGTH) {
    throw new MomentSearchValidationError(
      `Search text must be at most ${MOMENT_SEARCH_MAX_QUERY_LENGTH} characters.`,
    );
  }

  let event: string | null = null;
  if (input.event !== null && input.event !== undefined && input.event !== "") {
    if (typeof input.event !== "string" || !EVENT_SLUG_PATTERN.test(input.event)) {
      throw new MomentSearchValidationError(`Invalid event slug "${String(input.event)}".`);
    }
    event = input.event;
  }

  return { query, event, limit: normalizeLimit(input.limit) };
}

// ---------------------------------------------------------------------------
// View mapping (mirrors src/lib/gallery/query.ts's private toView/
// confirmedPeople/dedupeKeywordsAgainstPeople; those helpers are not
// exported, so this is a small, deliberate duplication rather than reaching
// into task 06's internals)
// ---------------------------------------------------------------------------

function confirmedPeople(photo: GalleryPhotoSource): GalleryPersonView[] {
  return photo.people
    .filter((person) => person.confidence === "confirmed")
    .map((person) => ({ slug: person.slug, displayName: person.displayName }));
}

function normalizeForCompare(value: string): string {
  return value.toLowerCase().trim();
}

/**
 * Mirrors src/lib/gallery/query.ts's private dedupeKeywordsAgainstPeople,
 * same semantics: many photos in this catalog had their tagged people's
 * names baked into the embedded Keywords field by the tool that prepared
 * the clean master, so the same name would otherwise render twice -- once
 * as a confirmed-person chip (people caption), once as a keyword chip in
 * the Lightbox. Drop any keyword that case-insensitively (and
 * whitespace-trimmed) matches a CONFIRMED person's display name or slug ON
 * THIS PHOTO. `people` here is already confirmed-only (see confirmedPeople
 * above), so an unconfirmed match is never in `people` and is therefore
 * never deduped -- it renders no chip, so there is nothing for it to
 * duplicate.
 */
function dedupeKeywordsAgainstPeople(
  keywords: string[],
  people: GalleryPersonView[],
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

function toMomentPhotoView(photo: GalleryPhotoSource): GalleryPhotoView {
  const aspectRatio = photo.height > 0 ? photo.width / photo.height : 1;
  const people = confirmedPeople(photo);
  return {
    id: photo.id,
    eventSlug: photo.eventSlug,
    eventName: photo.eventName,
    source: photo.source,
    orientation: photo.orientation,
    width: photo.width,
    height: photo.height,
    aspectRatio,
    capturedAt: photo.capturedAt,
    people,
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
// Keyword/event-name fallback -- used when momentSearch is disabled, when
// the embedding service is unavailable, when the vector RPC fails, or when a
// vector search legitimately finds nothing above the similarity floor. Never
// an error page (packet done-check requirement).
// ---------------------------------------------------------------------------

async function keywordFallback(
  input: NormalizedMomentSearchInput,
  dataSource: GalleryDataSource,
): Promise<MomentSearchResult[]> {
  const needle = input.query.toLowerCase();
  const all = await dataSource.listPhotos();
  const candidates = all.filter(
    (photo) =>
      photo.status === VISIBLE_PHOTO_STATUS &&
      (!input.event || photo.eventSlug === input.event) &&
      (photo.keywords.some((keyword) => keyword.toLowerCase().includes(needle)) ||
        photo.eventName.toLowerCase().includes(needle)),
  );
  return candidates
    .slice(0, input.limit)
    .map((photo) => ({ photo: toMomentPhotoView(photo), similarity: 0, matchType: "keyword" as const }));
}

// ---------------------------------------------------------------------------
// Injectable core
// ---------------------------------------------------------------------------

export interface MomentVectorMatch {
  photoId: string;
  similarity: number;
}

export interface MomentSearchDeps {
  /** Wires the momentSearch feature flag. Tests set this directly; the
   * production wrapper reads content/features.ts. */
  enabled: boolean;
  /** Embeds the query text into the shared 512-dim CLIP space. */
  embedText: (query: string) => Promise<number[]>;
  /** Runs the pgvector cosine search (real RPC in production; an in-memory
   * stand-in in tests). Receives the ALREADY L2-normalized query embedding. */
  runVectorSearch: (
    embedding: number[],
    eventSlug: string | null,
    limit: number,
  ) => Promise<MomentVectorMatch[]>;
  /** Approved-photo catalog, reused from task 06's injectable data source. */
  dataSource: GalleryDataSource;
}

/**
 * Core, fully testable search. Never throws for "no results," "flag off," or
 * "embedding service down" -- those all resolve to the keyword fallback (or
 * an empty result set) so the caller can render a normal empty state rather
 * than an error page. Only MomentSearchValidationError (bad input) escapes.
 */
export async function searchMomentsWith(
  rawInput: MomentSearchInput,
  deps: MomentSearchDeps,
  reportFallback?: MomentSearchFallbackReporter,
): Promise<MomentSearchResult[]> {
  const input = normalizeMomentSearchInput(rawInput);

  if (!deps.enabled) {
    reportFallback?.({ stage: "feature_flag" });
    return keywordFallback(input, deps.dataSource);
  }

  let embedding: number[];
  try {
    embedding = await deps.embedText(input.query);
  } catch (error) {
    // Embedding service unavailable: degrade, never error (packet rule).
    reportFallback?.({ stage: "embedding", error });
    return keywordFallback(input, deps.dataSource);
  }

  let matches: MomentVectorMatch[];
  try {
    matches = await deps.runVectorSearch(embedding, input.event, input.limit);
  } catch (error) {
    reportFallback?.({ stage: "vector_search", error });
    return keywordFallback(input, deps.dataSource);
  }

  const all = await deps.dataSource.listPhotos();
  const approvedById = new Map<string, GalleryPhotoSource>();
  for (const photo of all) {
    if (photo.status === VISIBLE_PHOTO_STATUS) approvedById.set(photo.id, photo);
  }

  const results: MomentSearchResult[] = [];
  for (const match of matches) {
    if (match.similarity < MOMENT_SEARCH_MIN_SIMILARITY) continue; // low-similarity rejection
    const photo = approvedById.get(match.photoId);
    if (!photo) continue; // pending/hidden/rejected/unknown: defense in depth
    if (input.event && photo.eventSlug !== input.event) continue; // defense in depth on the RPC's own filter
    results.push({
      photo: toMomentPhotoView(photo),
      similarity: match.similarity,
      matchType: "embedding",
    });
    if (results.length >= input.limit) break;
  }

  if (results.length === 0) {
    reportFallback?.({ stage: "no_embedding_matches" });
    return keywordFallback(input, deps.dataSource);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Production wiring
// ---------------------------------------------------------------------------

/**
 * Narrow structural seam for the one RPC this packet owns, mirroring
 * src/lib/auth/rate-limit.ts's RateLimitClient pattern. Deliberately NOT
 * typed against src/lib/supabase/database.types.ts: that file is
 * hand-written by task 03 against ONLY 202607220001/002_*.sql, and this
 * packet's RPC (in 202607220003_moment_search.sql) is intentionally not
 * added to it, so as not to edit a file this packet does not own. The real
 * SupabaseClient<Database> is cast to this interface at the single call site
 * below; every other use of that client elsewhere in this module stays fully
 * typed against the real schema.
 */
interface MomentSearchRpcClient {
  rpc(
    fn: "rachandzach_search_gallery_moments",
    args: { query_embedding: number[]; event_filter: string | null; result_limit: number },
  ): PromiseLike<{
    data: { photo_id: string; similarity: number }[] | null;
    error: { message: string } | null;
  }>;
}

async function runGalleryMomentsRpc(
  client: SupabaseClient<Database>,
  embedding: number[],
  eventSlug: string | null,
  limit: number,
): Promise<MomentVectorMatch[]> {
  const rpcClient = client as unknown as MomentSearchRpcClient;
  const { data, error } = await rpcClient.rpc("rachandzach_search_gallery_moments", {
    query_embedding: embedding,
    event_filter: eventSlug,
    result_limit: limit,
  });
  if (error) {
    throw new Error(`rachandzach_search_gallery_moments failed: ${error.message}`);
  }
  return (data ?? []).map((row) => ({ photoId: row.photo_id, similarity: row.similarity }));
}

/**
 * Production entry point -- the exact signature the packet's Interfaces
 * section pins. Wires the real feature flag, the real JS text encoder, the
 * real pgvector RPC, and task 06's real Supabase-backed gallery data source.
 *
 * The three server-only-tainted modules are imported dynamically here (see
 * the module docstring's "Import hygiene" note) so this is the ONLY function
 * in the file that ever triggers their evaluation.
 */
export async function searchMoments(
  input: MomentSearchInput,
  reportFallback?: MomentSearchFallbackReporter,
): Promise<MomentSearchResult[]> {
  const [{ createAdminClient }, { createSupabaseGalleryDataSource }, { embedText }] =
    await Promise.all([
      import("@/lib/supabase/admin"),
      import("@/lib/gallery/supabase-source"),
      import("@/lib/search/query-embedding"),
    ]);
  const client = createAdminClient();
  const dataSource = createSupabaseGalleryDataSource(client);
  return searchMomentsWith(
    input,
    {
      enabled: featureFlags.momentSearch,
      embedText,
      runVectorSearch: (embedding, eventSlug, limit) =>
        runGalleryMomentsRpc(client, embedding, eventSlug, limit),
      dataSource,
    },
    reportFallback,
  );
}

// ---------------------------------------------------------------------------
// Client serialization -- signs preview objects and drops object paths, same
// boundary discipline as src/lib/gallery/serialize.ts (that file's
// toClientPhoto is not exported, hence the small local mirror below).
// ---------------------------------------------------------------------------

function toClientMomentPhoto(
  view: GalleryPhotoView,
  urls: Map<string, string>,
): ClientPhoto {
  const previews = view.previews
    .map((preview) => {
      const url = urls.get(preview.objectPath);
      if (!url) return null;
      return { url, width: preview.width, height: preview.height, format: preview.format };
    })
    .filter((preview): preview is NonNullable<typeof preview> => preview !== null)
    // Same order contract as serialize.ts: within a width the most
    // compatible format sorts first, so previews[0] decodes everywhere.
    .sort(
      (a, b) => a.width - b.width || formatRank(b.format) - formatRank(a.format),
    );
  return {
    id: view.id,
    eventSlug: view.eventSlug,
    eventName: view.eventName,
    source: view.source,
    orientation: view.orientation,
    width: view.width,
    height: view.height,
    aspectRatio: view.aspectRatio,
    capturedAt: view.capturedAt,
    people: view.people,
    // keywords became required on ClientPhoto for the keyword-chip UI
    // (src/lib/gallery/client-types.ts). view.keywords already exists on
    // GalleryPhotoView (toMomentPhotoView above sets it); this line only
    // wires it through so this mirror keeps satisfying that type.
    keywords: view.keywords,
    approvedCaption: view.approvedCaption,
    previews,
  };
}

/**
 * Batch-signs every result's preview objects and returns the client-safe
 * shape (never an internal object path). Mirrors serializeGalleryPage.
 */
export async function serializeMomentResults(
  results: MomentSearchResult[],
  client: SupabaseClient<Database>,
): Promise<ClientMomentResult[]> {
  const previews: SignablePreview[] = [];
  for (const result of results) {
    for (const preview of result.photo.previews) {
      previews.push({ bucket: preview.bucket, objectPath: preview.objectPath });
    }
  }
  const { urls } = await signPreviewUrls(client, previews, PREVIEW_URL_TTL_SECONDS);
  return results.map((result) => ({
    photo: toClientMomentPhoto(result.photo, urls),
    similarity: result.similarity,
    matchType: result.matchType,
  }));
}
