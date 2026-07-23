/**
 * GET /api/admin/memories (Memories wall, Round Two): the memories review
 * queue. Lists guest photo notes by status (default pending, oldest first)
 * for MemoriesReviewQueue.tsx. Node runtime; requireAdmin() is re-checked
 * here even though the proxy already gates /api/admin/*. A guest session is
 * never enough: pending and rejected notes exist only behind this door.
 */
import { NextResponse, type NextRequest } from "next/server";
import { AdminAccessError, requireAdmin } from "@/lib/auth/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isMemoryStatus,
  listMemoriesForReview,
  type MemoriesDbClient,
} from "@/lib/memories/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const statusParam = request.nextUrl.searchParams.get("status") ?? "pending";
  if (!isMemoryStatus(statusParam)) {
    return NextResponse.json(
      { error: "status must be pending, approved, or rejected." },
      { status: 400 },
    );
  }

  try {
    // Cast bridge until database.types.ts regenerates; see
    // src/lib/memories/server.ts's header.
    const db = createAdminClient() as unknown as MemoriesDbClient;
    const memories = await listMemoriesForReview(db, statusParam);
    return NextResponse.json({ memories });
  } catch {
    return NextResponse.json(
      { error: "Could not load the memories queue." },
      { status: 500 },
    );
  }
}
