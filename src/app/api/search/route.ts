/**
 * GET /api/search (packet 07). Moment Search: protected, rate-limited,
 * validated. Runs the JS text encoder (src/lib/search/query-embedding.ts) in
 * this Vercel Node route per the platform spike -- never a Supabase Edge
 * Function. Never logs the query string.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  GalleryAccessConfigError,
  GalleryAccessError,
  requireGalleryAccess,
} from "@/lib/auth/guest-session";
import { consumeRateLimit, hashRateLimitKey } from "@/lib/auth/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MOMENT_SEARCH_DEFAULT_LIMIT,
  MomentSearchValidationError,
  searchMoments,
  serializeMomentResults,
} from "@/lib/search/moment-search";

// Runs the CLIP text encoder: needs the Node runtime (onnxruntime-node), not
// Edge, and a generous duration budget for a cold-start model fetch (see
// spikes/clip-model.md's cold-start budget of ~5-10s worst case fp32).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** IP-based; wedding-guest searches are rare, this is generous for humans and hostile to scripts. */
const SEARCH_RATE_LIMIT = {
  action: "moment_search_ip",
  attemptLimit: 30,
  windowSeconds: 60,
} as const;

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function GET(request: NextRequest) {
  try {
    await requireGalleryAccess();
  } catch (error) {
    if (error instanceof GalleryAccessError) {
      return NextResponse.json({ error: "Sign in to search photos." }, { status: 401 });
    }
    // Missing configuration (GalleryAccessConfigError) fails closed as a 500.
    return NextResponse.json({ error: "Search is unavailable right now." }, { status: 500 });
  }

  try {
    const admin = createAdminClient();
    const keyHash = await hashRateLimitKey(clientIp(request), SEARCH_RATE_LIMIT.action);
    const allowed = await consumeRateLimit(admin, {
      keyHash,
      action: SEARCH_RATE_LIMIT.action,
      attemptLimit: SEARCH_RATE_LIMIT.attemptLimit,
      windowSeconds: SEARCH_RATE_LIMIT.windowSeconds,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many searches. Please wait a moment and try again." },
        { status: 429 },
      );
    }
  } catch (error) {
    if (error instanceof GalleryAccessConfigError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: "Search rate limiting is unavailable." },
      { status: 500 },
    );
  }

  const params = request.nextUrl.searchParams;
  const query = params.get("q") ?? "";
  const event = params.get("event");
  const limitParam = params.get("limit");
  const limit = limitParam ? Number(limitParam) : MOMENT_SEARCH_DEFAULT_LIMIT;

  try {
    const results = await searchMoments({ query, event, limit });
    const client = createAdminClient();
    const body = await serializeMomentResults(results, client);
    return NextResponse.json({ results: body });
  } catch (error) {
    if (error instanceof MomentSearchValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Search is unavailable right now." }, { status: 500 });
  }
}
