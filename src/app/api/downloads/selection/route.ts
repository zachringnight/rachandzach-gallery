import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DownloadValidationError } from "@/lib/downloads/contracts";
import {
  createSupabaseOriginalsDataSource,
  getSelectionDownloads,
} from "@/lib/downloads/sign-originals";

/**
 * POST /api/downloads/selection (packet 09). Body: { photoIds: string[] }.
 *
 * One batch-signed response covering the whole selection, for anyone who
 * asks -- the site carries no password. Never proxies original bytes
 * through Vercel -- the browser streams the ZIP directly from the signed
 * URLs this returns (see src/lib/downloads/stream-zip.ts). Duplicate,
 * unknown, and non-approved ids are silently dropped from the response
 * rather than erroring; only genuinely invalid input (not an array, empty,
 * or over the 50-item cap) produces a 4xx.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const rawBody = (body ?? {}) as { photoIds?: unknown };
  // A missing/null photoIds field becomes [] (surfaces the friendlier
  // "at least one id required" message); any other wrong type is passed
  // through as-is so getSelectionDownloads's own Array.isArray check can
  // report the precise "photoIds must be an array" error.
  const photoIdsInput: unknown = rawBody.photoIds ?? [];

  const client = createAdminClient();
  const source = createSupabaseOriginalsDataSource(client);

  try {
    const selection = await getSelectionDownloads(
      photoIdsInput as unknown[],
      source,
    );
    return NextResponse.json(selection);
  } catch (error) {
    if (error instanceof DownloadValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Downloads are unavailable right now." },
      { status: 500 },
    );
  }
}
