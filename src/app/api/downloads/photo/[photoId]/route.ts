import { NextResponse, type NextRequest } from "next/server";
import {
  GalleryAccessError,
  requireGalleryAccess,
} from "@/lib/auth/guest-session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DownloadNotFoundError,
  DownloadValidationError,
} from "@/lib/downloads/contracts";
import {
  createSupabaseOriginalsDataSource,
  getOriginalDownload,
} from "@/lib/downloads/sign-originals";

/**
 * GET /api/downloads/photo/[photoId] (packet 09).
 *
 * Redirects to a 10-minute signed URL for the photo's ORIGINAL (never a
 * preview) -- the bytes stream from Supabase Storage straight to the guest's
 * browser, never through Vercel. Pending, hidden, rejected, and unknown ids
 * all resolve to a plain 404: the guest must never learn a non-approved
 * photo exists.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ photoId: string }> },
) {
  try {
    await requireGalleryAccess();
  } catch (error) {
    if (error instanceof GalleryAccessError) {
      return NextResponse.json(
        { error: "Sign in to download this photo." },
        { status: 401 },
      );
    }
    // Missing configuration (GalleryAccessConfigError) fails closed as a 500.
    return NextResponse.json(
      { error: "Downloads are unavailable right now." },
      { status: 500 },
    );
  }

  const { photoId } = await params;
  const client = createAdminClient();
  const source = createSupabaseOriginalsDataSource(client);

  try {
    const download = await getOriginalDownload(photoId, source);
    return NextResponse.redirect(download.signedUrl, 307);
  } catch (error) {
    if (error instanceof DownloadNotFoundError) {
      return NextResponse.json({ error: "Photo not found." }, { status: 404 });
    }
    if (error instanceof DownloadValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Downloads are unavailable right now." },
      { status: 500 },
    );
  }
}
