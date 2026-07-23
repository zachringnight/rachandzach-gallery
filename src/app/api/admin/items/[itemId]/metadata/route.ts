/**
 * PATCH /api/admin/items/[itemId]/metadata (packet 10).
 *
 * upload_items carries no event/people/keyword columns -- that metadata
 * lives on the catalog photo an item's approval produced (rachandzach_photos
 * / rachandzach_photo_people / rachandzach_photo_keywords). This route is
 * therefore a POST-approval correction: it edits the metadata on the photo
 * behind an already-approved item (the photo is located by re-deriving its
 * content hash, since no photo_id is stored on the item row) and records an
 * edit_metadata audit entry with before/after JSON. Editing metadata BEFORE
 * a decision is a client-side concern of BatchReviewer/MetadataEditor: the
 * chosen event/people/keywords travel with the approve request itself
 * (POST /api/admin/batches/[batchId]/approve), not through this route.
 */
import { NextResponse, type NextRequest } from "next/server";
import { AdminAccessError, requireAdmin } from "@/lib/auth/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/uploads/contracts";
import { recordModerationAction, ModerationPersistenceError } from "@/lib/moderation/audit";
import {
  findPhotoForApprovedItem,
  resolveEventId,
  resolvePersonIds,
} from "@/lib/moderation/process-approved-photo";

export const runtime = "nodejs";

interface MetadataBody {
  eventSlug?: string | null;
  peopleSlugs?: string[];
  keywords?: string[];
}

function parseBody(raw: unknown): MetadataBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const result: MetadataBody = {};
  if ("eventSlug" in body) {
    if (body.eventSlug !== null && typeof body.eventSlug !== "string") return null;
    result.eventSlug = body.eventSlug as string | null;
  }
  if ("peopleSlugs" in body) {
    if (
      !Array.isArray(body.peopleSlugs) ||
      body.peopleSlugs.some((slug) => typeof slug !== "string")
    ) {
      return null;
    }
    result.peopleSlugs = body.peopleSlugs as string[];
  }
  if ("keywords" in body) {
    if (!Array.isArray(body.keywords) || body.keywords.some((kw) => typeof kw !== "string")) {
      return null;
    }
    result.keywords = (body.keywords as string[])
      .map((kw) => kw.trim())
      .filter((kw) => kw.length > 0 && kw.length <= 80);
  }
  return result;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> },
) {
  let actor: { userId: string; email: string };
  try {
    actor = await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const { itemId } = await context.params;
  if (!isUuid(itemId)) {
    return NextResponse.json({ error: "Invalid item id." }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json({ error: "Invalid metadata payload." }, { status: 422 });
  }

  const db = createAdminClient();

  let photo;
  try {
    photo = await findPhotoForApprovedItem(itemId, db);
  } catch {
    return NextResponse.json(
      { error: "Could not look up the catalog photo for this item." },
      { status: 500 },
    );
  }
  if (!photo) {
    return NextResponse.json(
      {
        error:
          "No catalog photo exists for this item yet. Approve it before editing its metadata.",
      },
      { status: 409 },
    );
  }

  const before: Record<string, unknown> = { event_id: photo.event_id };
  const after: Record<string, unknown> = {};

  try {
    if (body.eventSlug !== undefined) {
      const eventId = body.eventSlug ? await resolveEventId(db, body.eventSlug) : null;
      const { error } = await db
        .from("rachandzach_photos")
        .update({ event_id: eventId })
        .eq("id", photo.id);
      if (error) {
        throw new ModerationPersistenceError("Could not update the photo's event.");
      }
      after.event_id = eventId;
    }

    if (body.peopleSlugs !== undefined) {
      await db.from("rachandzach_photo_people").delete().eq("photo_id", photo.id);
      const personIds = await resolvePersonIds(db, body.peopleSlugs);
      for (const personId of personIds) {
        await db.from("rachandzach_photo_people").insert({
          photo_id: photo.id,
          person_id: personId,
          source: "manual",
          confidence: "confirmed",
        });
      }
      after.people_slugs = body.peopleSlugs;
    }

    if (body.keywords !== undefined) {
      await db.from("rachandzach_photo_keywords").delete().eq("photo_id", photo.id);
      for (const keyword of body.keywords) {
        await db.from("rachandzach_photo_keywords").insert({
          photo_id: photo.id,
          keyword,
        });
      }
      after.keywords = body.keywords;
    }
  } catch (error) {
    if (error instanceof ModerationPersistenceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Could not save this metadata change." },
      { status: 500 },
    );
  }

  await recordModerationAction(db, {
    batchId: photo.submitted_batch_id,
    itemId,
    actorUserId: actor.userId,
    action: "edit_metadata",
    before,
    after,
  });

  return NextResponse.json({ photoId: photo.id, ok: true });
}
