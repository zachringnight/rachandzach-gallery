/**
 * /admin/memories (Memories wall, Round Two): the review queue for guest
 * photo notes. Server-fetches the pending list (so it renders with data on
 * first paint) and hands off to the client MemoriesReviewQueue component
 * for refresh and approve / reject.
 */
import { requireAdmin } from "@/lib/auth/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listMemoriesForReview,
  type MemoriesDbClient,
} from "@/lib/memories/server";
import { MemoriesReviewQueue } from "@/components/memories/MemoriesReviewQueue";

export const metadata = {
  title: "Memories review | 0719 + co. Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminMemoriesPage() {
  // The layout already enforces admin access; every data-touching page calls
  // requireAdmin() again on its own (packet 04's rule), independent of what
  // the layout above it did.
  await requireAdmin();

  // Cast bridge until database.types.ts regenerates; see
  // src/lib/memories/server.ts's header.
  const db = createAdminClient() as unknown as MemoriesDbClient;
  const pending = await listMemoriesForReview(db, "pending");

  return <MemoriesReviewQueue initialPending={pending} />;
}
