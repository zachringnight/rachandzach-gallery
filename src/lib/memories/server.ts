/**
 * Memories wall server logic (Round Two). Pure functions over an injected
 * database client, following src/lib/favorites/server.ts: the /api/memories
 * and /api/admin/memories routes construct the service-role client and pass
 * it in, and tests pass a fake. No "server-only" import here so the vitest
 * node project can exercise this module directly; nothing in this file reads
 * env or cookies.
 *
 * The injection seam is a narrow structural interface (MemoriesDbClient)
 * rather than SupabaseClient<Database>, the same trade rate-limit.ts makes
 * with RateLimitClient: rachandzach_photo_memories lands in the generated
 * database.types.ts only when `npm run types:generate` next runs (the
 * Integrate step), and this module must be fully typed before then. The real
 * service-role client satisfies every shape below; the route adapts it with
 * one documented cast.
 *
 * Owner model (see supabase/migrations/202607220006_photo_memories.sql):
 * rows are keyed by (owner_kind, owner_key), derived strictly server-side.
 * The session id always comes from the verified rz_gallery_session cookie
 * (never from the request body), and a client-supplied person slug counts
 * only if it matches a real rachandzach_people row; anything else falls
 * back to session keying.
 *
 * Visibility contract: guests read APPROVED notes only. Pending and
 * rejected rows are reachable solely through the admin surfaces. Every
 * guest-facing serializer here omits owner_kind/owner_key entirely, so a
 * session id can never leak to another guest.
 */
import { isValidPersonSlug } from "@/lib/personalization/my-weekend";
import { VISIBLE_PHOTO_STATUS } from "@/lib/gallery/query";
import {
  MEMORY_BODY_MAX_LENGTH,
  MEMORY_DISPLAY_NAME_MAX_LENGTH,
  isMemoryStatus,
  type AdminMemory,
  type GuestMemory,
  type MemoryOwnerKind,
  type MemoryStatus,
} from "./shared";

export {
  MEMORY_BODY_MAX_LENGTH,
  MEMORY_DISPLAY_NAME_MAX_LENGTH,
  MEMORY_OWNER_KINDS,
  MEMORY_STATUSES,
  isMemoryStatus,
  type AdminMemory,
  type GuestMemory,
  type MemoryOwnerKind,
  type MemoryStatus,
} from "./shared";

/**
 * Per-IP create limit for POST /api/memories (route files may not export
 * arbitrary values, so the constant lives here). A guest writing notes
 * while browsing is a few per minute at most; 10 per 15 minutes is generous
 * for humans and hostile to scripts. Fail-closed like every other bucket:
 * the RPC (and thus the database) being unavailable denies the write.
 */
export const MEMORY_CREATE_RATE_LIMIT = {
  action: "memory_create_ip",
  attemptLimit: 10,
  windowSeconds: 15 * 60,
} as const;

export interface MemoryOwner {
  kind: MemoryOwnerKind;
  key: string;
}

// --- Errors ----------------------------------------------------------------

/** Client-caused problem; the route maps message + status straight through. */
export class MemoryValidationError extends Error {
  readonly status: number;

  constructor(message: string, status = 422) {
    super(message);
    this.name = "MemoryValidationError";
    this.status = status;
  }
}

/** A storage read/write failed. The route maps this to a plain 500 and the
 *  guest sees a generic message; internals never leak. */
export class MemoriesPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoriesPersistenceError";
  }
}

// --- Structural database client -------------------------------------------

type DbResult<T> = PromiseLike<{ data: T; error: unknown }>;

interface PeopleTable {
  select(columns: "slug"): {
    eq(
      column: "slug",
      value: string,
    ): { maybeSingle(): DbResult<{ slug: string } | null> };
  };
}

interface PhotosTable {
  select(columns: "id"): {
    eq(
      column: "id",
      value: string,
    ): {
      eq(
        column: "status",
        value: string,
      ): { maybeSingle(): DbResult<{ id: string } | null> };
    };
  };
}

export interface MemoryRow {
  id: string;
  photo_id: string;
  display_name: string | null;
  body: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}

export interface MemoryInsertRow {
  photo_id: string;
  owner_kind: MemoryOwnerKind;
  owner_key: string;
  display_name: string | null;
  body: string;
  status: "pending";
}

interface MemorySelectBuilder {
  eq(column: "photo_id" | "status", value: string): MemorySelectBuilder;
  order(
    column: "created_at" | "id",
    options: { ascending: boolean },
  ): MemorySelectBuilder;
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: (value: {
      data: MemoryRow[] | null;
      error: unknown;
    }) => TResult1 | PromiseLike<TResult1>,
    onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
  ): PromiseLike<TResult1 | TResult2>;
}

interface MemoriesTable {
  select(columns: string): MemorySelectBuilder;
  insert(row: MemoryInsertRow): {
    select(columns: "id"): { single(): DbResult<{ id: string } | null> };
  };
  update(patch: { status: MemoryStatus; reviewed_at: string }): {
    eq(
      column: "id",
      value: string,
    ): {
      select(
        columns: "id, status",
      ): { maybeSingle(): DbResult<Pick<MemoryRow, "id" | "status"> | null> };
    };
  };
}

/**
 * Exactly the call shapes this module makes, and nothing more. The
 * service-role SupabaseClient satisfies all of them at runtime; tests
 * implement the interface directly with an in-memory fake.
 */
export interface MemoriesDbClient {
  from(table: "rachandzach_people"): PeopleTable;
  from(table: "rachandzach_photos"): PhotosTable;
  from(table: "rachandzach_photo_memories"): MemoriesTable;
}

// --- Validation (mirrored client-side by the composer's maxLength) ---------

/**
 * Normalizes a guest-supplied note body: must be a string, NULs stripped,
 * trimmed, and 1..500 characters afterward. Throws MemoryValidationError
 * (422) otherwise. JS string length counts UTF-16 units, which is never
 * smaller than Postgres char_length, so passing here guarantees the check
 * constraint passes too.
 */
export function normalizeMemoryBody(input: unknown): string {
  if (typeof input !== "string") {
    throw new MemoryValidationError("Write a short memory to share.");
  }
  const body = input.replace(/\u0000/g, "").trim();
  if (body.length === 0) {
    throw new MemoryValidationError("Write a short memory to share.");
  }
  if (body.length > MEMORY_BODY_MAX_LENGTH) {
    throw new MemoryValidationError(
      `Memories can hold up to ${MEMORY_BODY_MAX_LENGTH} characters.`,
    );
  }
  return body;
}

/**
 * Normalizes the optional self-chosen byline. Missing, null, or blank means
 * anonymous (null). A present name must be a string of at most 80 characters
 * after trimming; anything else is a 422.
 */
export function normalizeMemoryDisplayName(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") {
    throw new MemoryValidationError("Names are plain text.");
  }
  const name = input.replace(/\u0000/g, "").trim();
  if (name.length === 0) return null;
  if (name.length > MEMORY_DISPLAY_NAME_MAX_LENGTH) {
    throw new MemoryValidationError(
      `Names can hold up to ${MEMORY_DISPLAY_NAME_MAX_LENGTH} characters.`,
    );
  }
  return name;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates a client-supplied photo id shape (a rachandzach_photos uuid). */
export function normalizePhotoId(input: unknown): string {
  if (typeof input !== "string" || !UUID_PATTERN.test(input)) {
    throw new MemoryValidationError("That photo could not be found.", 400);
  }
  return input;
}

/** Validates a memory id shape (a rachandzach_photo_memories uuid). */
export function normalizeMemoryId(input: unknown): string {
  if (typeof input !== "string" || !UUID_PATTERN.test(input)) {
    throw new MemoryValidationError("That memory could not be found.", 400);
  }
  return input;
}

// --- Owner derivation (same rules as favorites) ----------------------------

/**
 * Derives the caller's owner key. The person slug is accepted from the
 * client but validated against rachandzach_people via the (service-role)
 * client; an unknown or malformed slug falls back to keying by the verified
 * session id. The session id itself is never accepted from the client.
 */
export async function resolveMemoryOwner(
  client: MemoriesDbClient,
  sessionId: string,
  personSlugRaw: unknown,
): Promise<MemoryOwner> {
  if (isValidPersonSlug(personSlugRaw)) {
    const { data, error } = await client
      .from("rachandzach_people")
      .select("slug")
      .eq("slug", personSlugRaw)
      .maybeSingle();
    if (!error && data?.slug === personSlugRaw) {
      return { kind: "person", key: personSlugRaw };
    }
  }
  return { kind: "session", key: sessionId };
}

// --- Guest operations ------------------------------------------------------

/**
 * A photo id qualifies for the memories wall only while the photo is
 * guest-visible (published). Anything else -- unknown id, hidden, pending,
 * rejected -- answers exactly the same way, so probing ids reveals nothing
 * about non-published photos.
 */
async function photoIsGuestVisible(
  client: MemoriesDbClient,
  photoId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("rachandzach_photos")
    .select("id")
    .eq("id", photoId)
    .eq("status", VISIBLE_PHOTO_STATUS)
    .maybeSingle();
  if (error) {
    throw new MemoriesPersistenceError("Could not check the photo.");
  }
  return data?.id === photoId;
}

/**
 * Creates a pending memory on a guest-visible photo. Always pending: nothing
 * a guest writes is ever visible to other guests until Zach approves it.
 * Returns the new row id.
 */
export async function createMemory(
  client: MemoriesDbClient,
  owner: MemoryOwner,
  input: { photoId: string; body: string; displayName: string | null },
): Promise<string> {
  const visible = await photoIsGuestVisible(client, input.photoId);
  if (!visible) {
    throw new MemoryValidationError("That photo could not be found.", 404);
  }
  const { data, error } = await client
    .from("rachandzach_photo_memories")
    .insert({
      photo_id: input.photoId,
      owner_kind: owner.kind,
      owner_key: owner.key,
      display_name: input.displayName,
      body: input.body,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new MemoriesPersistenceError("Could not save the memory.");
  }
  return data.id;
}

/**
 * Lists one photo's APPROVED memories, oldest first (id breaks created_at
 * ties so the order is deterministic). Pending and rejected rows are never
 * selected here, and the owner key never leaves this function. A photo that
 * is not guest-visible answers with an empty wall, indistinguishable from a
 * photo nobody has written on.
 */
export async function listApprovedMemories(
  client: MemoriesDbClient,
  photoId: string,
): Promise<GuestMemory[]> {
  const visible = await photoIsGuestVisible(client, photoId);
  if (!visible) return [];
  const { data, error } = await client
    .from("rachandzach_photo_memories")
    .select("id, display_name, body, created_at")
    .eq("photo_id", photoId)
    .eq("status", "approved")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error || !data) {
    throw new MemoriesPersistenceError("Could not list memories.");
  }
  return data.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    body: row.body,
    createdAt: row.created_at,
  }));
}

// --- Admin operations ------------------------------------------------------

/** Lists memories by status for the review queue, oldest first. */
export async function listMemoriesForReview(
  client: MemoriesDbClient,
  status: MemoryStatus,
): Promise<AdminMemory[]> {
  const { data, error } = await client
    .from("rachandzach_photo_memories")
    .select("id, photo_id, display_name, body, status, created_at, reviewed_at")
    .eq("status", status)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error || !data) {
    throw new MemoriesPersistenceError("Could not list memories for review.");
  }
  return data.map((row) => ({
    id: row.id,
    photoId: row.photo_id,
    displayName: row.display_name,
    body: row.body,
    status: isMemoryStatus(row.status) ? row.status : "pending",
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  }));
}

/**
 * Records Zach's decision. Approve and reject are both re-runnable and can
 * reverse each other (changing his mind is allowed); either way reviewed_at
 * reflects the latest decision. Unknown ids are a 404-shaped validation
 * error.
 */
export async function reviewMemory(
  client: MemoriesDbClient,
  memoryId: string,
  decision: "approved" | "rejected",
  reviewedAt: string = new Date().toISOString(),
): Promise<{ id: string; status: MemoryStatus }> {
  const { data, error } = await client
    .from("rachandzach_photo_memories")
    .update({ status: decision, reviewed_at: reviewedAt })
    .eq("id", memoryId)
    .select("id, status")
    .maybeSingle();
  if (error) {
    throw new MemoriesPersistenceError("Could not update the memory.");
  }
  if (!data) {
    throw new MemoryValidationError("That memory could not be found.", 404);
  }
  return {
    id: data.id,
    status: isMemoryStatus(data.status) ? data.status : decision,
  };
}
