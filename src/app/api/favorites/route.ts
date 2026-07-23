import { NextResponse, type NextRequest } from "next/server";
import {
  GalleryAccessError,
  requireGalleryAccess,
} from "@/lib/auth/guest-session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listFavoritePhotoIds,
  mergeSessionFavoritesIntoPerson,
  replaceFavorites,
  resolveFavoriteOwner,
  sanitizePhotoIds,
} from "@/lib/favorites/server";

/**
 * /api/favorites (Favorites v2). The server half of local-first favorites:
 * the device-local FavoriteStore stays the source of immediate truth, and
 * these routes persist a copy keyed to the caller's owner key so hearts
 * survive a cleared browser and follow a guest who claims their person on
 * My Weekend.
 *
 * GET  -> { ownerKind, photoIds } for the caller's owner key.
 * PUT  -> body { photoIds: string[], person?: string,
 *               migrateFromSession?: boolean }.
 *         Default: replace the owner's row set with photoIds.
 *         With migrateFromSession and a valid person: union the caller's
 *         session rows (plus photoIds) into the person key, then delete the
 *         session rows.
 *
 * Owner-key derivation is strictly server-side: the session id comes from
 * the verified guest-session cookie (requireGalleryAccess; a client-supplied
 * session id is never read), and ?person= / body.person counts only if it
 * matches a real rachandzach_people slug -- anything else falls back to
 * session keying (see resolveFavoriteOwner).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireSession(): Promise<
  { ok: true; sessionId: string } | { ok: false; response: NextResponse }
> {
  try {
    const session = await requireGalleryAccess();
    return { ok: true, sessionId: session.sessionId };
  } catch (error) {
    if (error instanceof GalleryAccessError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Sign in to sync favorites." },
          { status: 401 },
        ),
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Favorites are unavailable right now." },
        { status: 500 },
      ),
    };
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  try {
    const client = createAdminClient();
    const owner = await resolveFavoriteOwner(
      client,
      auth.sessionId,
      request.nextUrl.searchParams.get("person"),
    );
    const photoIds = await listFavoritePhotoIds(client, owner);
    return NextResponse.json({ ownerKind: owner.kind, photoIds });
  } catch {
    return NextResponse.json(
      { error: "Favorites are unavailable right now." },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const rawBody = (body ?? {}) as {
    photoIds?: unknown;
    person?: unknown;
    migrateFromSession?: unknown;
  };
  if (!Array.isArray(rawBody.photoIds)) {
    return NextResponse.json(
      { error: "photoIds must be an array." },
      { status: 400 },
    );
  }
  const photoIds = sanitizePhotoIds(rawBody.photoIds);

  try {
    const client = createAdminClient();
    const owner = await resolveFavoriteOwner(
      client,
      auth.sessionId,
      rawBody.person,
    );
    // The migrate flag only means something once the owner actually resolved
    // to a person; with a session owner it degrades to a plain replace.
    const resultIds =
      rawBody.migrateFromSession === true && owner.kind === "person"
        ? await mergeSessionFavoritesIntoPerson(
            client,
            auth.sessionId,
            owner,
            photoIds,
          )
        : await replaceFavorites(client, owner, photoIds);
    return NextResponse.json({ ownerKind: owner.kind, photoIds: resultIds });
  } catch {
    return NextResponse.json(
      { error: "Favorites are unavailable right now." },
      { status: 500 },
    );
  }
}
