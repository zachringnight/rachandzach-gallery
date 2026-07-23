import { NextResponse, type NextRequest } from "next/server";
import {
  GalleryAccessError,
  requireGalleryAccess,
} from "@/lib/auth/guest-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import {
  GalleryQueryError,
  getGalleryFacets,
  getGalleryPage,
  parseGalleryQuery,
} from "@/lib/gallery/query";
import { serializeGalleryPage } from "@/lib/gallery/serialize";

// Reads cookies + private storage; never static, never cached at the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireGalleryAccess();
  } catch (error) {
    if (error instanceof GalleryAccessError) {
      return NextResponse.json(
        { error: "Sign in to view the gallery." },
        { status: 401 },
      );
    }
    // Missing configuration (GalleryAccessConfigError) fails closed as a 500.
    return NextResponse.json(
      { error: "The gallery is unavailable right now." },
      { status: 500 },
    );
  }

  const input = parseGalleryQuery(request.nextUrl.searchParams);
  const wantFacets = request.nextUrl.searchParams.get("facets") === "1";

  const client = createAdminClient();
  const source = createSupabaseGalleryDataSource(client);

  try {
    const page = await getGalleryPage(input, source);
    const body = await serializeGalleryPage(page, client);
    if (wantFacets) {
      const facets = await getGalleryFacets(source);
      return NextResponse.json({ ...body, facets });
    }
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof GalleryQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "The gallery is unavailable right now." },
      { status: 500 },
    );
  }
}
