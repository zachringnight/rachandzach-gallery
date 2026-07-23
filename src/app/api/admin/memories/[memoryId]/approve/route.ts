/**
 * POST /api/admin/memories/[memoryId]/approve (Memories wall, Round Two).
 * Marks one guest photo note approved, which is the single act that makes
 * it visible on its photo's memories wall. Re-runnable, and allowed to
 * reverse an earlier reject (Zach changing his mind is a feature).
 */
import { NextResponse, type NextRequest } from "next/server";
import { AdminAccessError, requireAdmin } from "@/lib/auth/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MemoryValidationError,
  normalizeMemoryId,
  reviewMemory,
  type MemoriesDbClient,
} from "@/lib/memories/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ memoryId: string }> },
) {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const { memoryId } = await context.params;
  try {
    const id = normalizeMemoryId(memoryId);
    // Cast bridge until database.types.ts regenerates; see
    // src/lib/memories/server.ts's header.
    const db = createAdminClient() as unknown as MemoriesDbClient;
    const result = await reviewMemory(db, id, "approved");
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MemoryValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Could not approve the memory." },
      { status: 500 },
    );
  }
}
