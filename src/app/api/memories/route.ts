/**
 * /api/memories (Memories wall, Round Two). Guests attach a short note to a
 * specific photo; the note becomes visible on that photo only after Zach
 * approves it in /admin/memories.
 *
 * GET  ?photoId= -> { memories } -- that photo's APPROVED notes only.
 *        Pending and rejected notes are never returned here, not even to
 *        their author; a non-published or unknown photo answers with an
 *        empty wall.
 * POST body { photoId, body, displayName?, person? } -> 201 { id, status:
 *        "pending" }. Rate-limited per hashed IP (fail closed), owner key
 *        derived strictly server-side: the session id comes from the
 *        verified guest-session cookie (getGuestSession; a
 *        client-supplied session id is never read), and person counts only
 *        if it matches a real rachandzach_people slug (see
 *        resolveMemoryOwner).
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  GalleryAccessConfigError,
  getGuestSession,
} from "@/lib/auth/guest-session";
import { consumeRateLimit, hashRateLimitKey } from "@/lib/auth/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MEMORY_CREATE_RATE_LIMIT,
  MemoriesPersistenceError,
  MemoryValidationError,
  createMemory,
  listApprovedMemories,
  normalizeMemoryBody,
  normalizeMemoryDisplayName,
  normalizePhotoId,
  resolveMemoryOwner,
  type MemoriesDbClient,
} from "@/lib/memories/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The service-role client satisfies every call shape in MemoriesDbClient at
 * runtime; the compile-time bridge exists because rachandzach_photo_memories
 * enters the generated database.types.ts only when `npm run types:generate`
 * next runs (see src/lib/memories/server.ts's header).
 */
function createMemoriesDb(): {
  admin: ReturnType<typeof createAdminClient>;
  db: MemoriesDbClient;
} {
  const admin = createAdminClient();
  return { admin, db: admin as unknown as MemoriesDbClient };
}


function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof MemoryValidationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof GalleryAccessConfigError) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (error instanceof MemoriesPersistenceError) {
    // Do not leak database internals to the guest.
    return NextResponse.json(
      { error: "Memories are unavailable right now." },
      { status: 500 },
    );
  }
  return NextResponse.json(
    { error: "Memories are unavailable right now." },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  try {
    const photoId = normalizePhotoId(request.nextUrl.searchParams.get("photoId"));
    const { db } = createMemoriesDb();
    const memories = await listApprovedMemories(db, photoId);
    return NextResponse.json({ memories });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const { sessionId } = await getGuestSession();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const rawBody = (body ?? {}) as {
    photoId?: unknown;
    body?: unknown;
    displayName?: unknown;
    person?: unknown;
  };

  try {
    const photoId = normalizePhotoId(rawBody.photoId);
    const noteBody = normalizeMemoryBody(rawBody.body);
    const displayName = normalizeMemoryDisplayName(rawBody.displayName);

    const { admin, db } = createMemoriesDb();

    // Fail closed: an unreachable rate-limit RPC denies the write.
    const keyHash = await hashRateLimitKey(
      clientIp(request),
      MEMORY_CREATE_RATE_LIMIT.action,
    );
    const allowed = await consumeRateLimit(admin, {
      keyHash,
      action: MEMORY_CREATE_RATE_LIMIT.action,
      attemptLimit: MEMORY_CREATE_RATE_LIMIT.attemptLimit,
      windowSeconds: MEMORY_CREATE_RATE_LIMIT.windowSeconds,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: "That is a lot of memories at once. Give it a few minutes." },
        { status: 429 },
      );
    }

    const owner = await resolveMemoryOwner(db, sessionId, rawBody.person);
    const id = await createMemory(db, owner, {
      photoId,
      body: noteBody,
      displayName,
    });
    return NextResponse.json({ id, status: "pending" }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
