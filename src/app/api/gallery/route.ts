import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import {
  GalleryQueryError,
  getGalleryFacets,
  getGalleryPage,
  parseGalleryQuery,
} from "@/lib/gallery/query";
import { serializeGalleryPage } from "@/lib/gallery/serialize";
import {
  loadPersonOverrides,
  surfaceGalleryFacets,
} from "@/lib/people/overrides";

// Signs private-storage URLs per request; never static, never cached at the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const input = parseGalleryQuery(request.nextUrl.searchParams);
  const wantFacets = request.nextUrl.searchParams.get("facets") === "1";

  const client = createAdminClient();
  const source = createSupabaseGalleryDataSource(client);

  try {
    const page = await getGalleryPage(input, source);
    const body = await serializeGalleryPage(page, client);
    if (wantFacets) {
      // Facets feed pickers, so they carry the surfaced roster: hidden
      // people out, renames applied, admin-added people in.
      const [facets, overrides] = await Promise.all([
        getGalleryFacets(source),
        loadPersonOverrides(client),
      ]);
      return NextResponse.json({
        ...body,
        facets: surfaceGalleryFacets(facets, overrides),
      });
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
