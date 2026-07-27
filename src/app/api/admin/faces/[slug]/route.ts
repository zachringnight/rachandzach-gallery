import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { AdminAccessError, requireAdmin } from "@/lib/auth/admin-session";

/**
 * Serves a committed face crop to an authenticated admin.
 *
 * The crops live in public/faces/, which src/proxy.ts gates behind a valid
 * GUEST session -- correct for the Find me picker, but wrong for the guest
 * manager: an admin authenticates through Supabase and may hold no guest
 * cookie at all, so every committed thumbnail redirected to /enter and the
 * manager fell back to initials for all 108 resolved guests, hiding exactly
 * the faces it exists to review.
 *
 * The tempting fix -- letting the proxy accept an admin cookie for /faces --
 * is worse than the bug. Those are static files with no server-side check
 * behind them, so the proxy's cheap structural gate would become the only
 * gate, and anyone able to set a cookie whose NAME matches the Supabase
 * pattern could read every guest's face. Admin paths get away with that gate
 * only because requireAdmin() runs again on the server. So this route does
 * exactly that, then streams the bytes itself.
 *
 * Guest faces are private: this must never lose its requireAdmin() call, and
 * /faces must never be added to PUBLIC_ROUTES.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const { slug } = await context.params;
  // Anchored slug pattern: the value indexes a filesystem path, so anything
  // carrying a separator or traversal segment is rejected outright rather
  // than normalised.
  if (!SLUG.test(slug)) {
    return NextResponse.json({ error: "Unknown face." }, { status: 400 });
  }

  try {
    const bytes = await readFile(join(process.cwd(), "public", "faces", `${slug}.webp`));
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "image/webp",
        // Private: an admin's browser may cache it, shared caches may not.
        "cache-control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "No committed face." }, { status: 404 });
  }
}
