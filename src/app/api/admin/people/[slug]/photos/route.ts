/**
 * GET /api/admin/people/[slug]/photos -- candidate photos for a face crop.
 *
 * scope=tagged (default): photos the person is tagged in, weekend order.
 * scope=all: the whole approved archive, optionally text-filtered with ?q=,
 * ?ids=<photoId>: resolve specific photographs regardless of scope, so the
 * editor can reopen a saved face whose source is outside the loaded page.
 * for people who have no tags yet (admin-added people especially).
 * Signed preview URLs ride the standard serializer; object paths never
 * reach the client.
 */
import { NextResponse, type NextRequest } from "next/server";

import { AdminAccessError, requireAdmin } from "@/lib/auth/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import { GalleryQueryError, getGalleryPage } from "@/lib/gallery/query";
import { serializeGalleryPage } from "@/lib/gallery/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }

  const { slug } = await context.params;
  const scope =
    request.nextUrl.searchParams.get("scope") === "all" ? "all" : "tagged";
  const q = request.nextUrl.searchParams.get("q");
  const cursor = request.nextUrl.searchParams.get("cursor");
  // ?ids= resolves specific photographs for this admin. The editor uses it to
  // reopen a saved face whose source photo is not on the current candidate
  // page. It must live here, behind requireAdmin(), rather than on
  // /api/gallery: that route is validated against a GUEST session, and an
  // admin authenticating through Supabase may hold no guest cookie, so the
  // lookup would 401 and silently drop them back at the picker.
  const ids = request.nextUrl.searchParams.getAll("ids").filter(Boolean);

  const client = createAdminClient();
  const source = createSupabaseGalleryDataSource(client);
  try {
    const page = await getGalleryPage(
      ids.length > 0
        ? { ids, limit: ids.length }
        : scope === "tagged"
          ? { person: slug, cursor, limit: 100 }
          : { q, cursor, limit: 60 },
      source,
    );
    const body = await serializeGalleryPage(page, client);
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof GalleryQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Could not load candidate photos right now." },
      { status: 500 },
    );
  }
}
