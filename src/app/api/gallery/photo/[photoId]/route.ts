import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import { getPhotoDetail } from "@/lib/gallery/query";
import { serializePhotoDetail } from "@/lib/gallery/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ photoId: string }> },
) {
  const { photoId } = await params;
  const client = createAdminClient();
  const source = createSupabaseGalleryDataSource(client);

  try {
    const detail = await getPhotoDetail(photoId, source);
    if (!detail) {
      return NextResponse.json({ error: "Photo not found." }, { status: 404 });
    }
    const body = await serializePhotoDetail(detail, client);
    return NextResponse.json(body);
  } catch {
    return NextResponse.json(
      { error: "The gallery is unavailable right now." },
      { status: 500 },
    );
  }
}
