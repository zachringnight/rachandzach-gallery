/**
 * PATCH  /api/admin/people/[slug] -- rename, clear a rename, hide/unhide.
 * DELETE /api/admin/people/[slug] -- remove from guest pickers. An added
 *         person is deleted outright only while nothing durable references
 *         them (no photo tags AND no person-keyed guest favorites, decided
 *         atomically in the rachandzach_remove_added_person RPC); any
 *         reference degrades to a soft hide (tags, favorites, and their
 *         personalized route keep working). Photos and tags are never
 *         deleted here; see removePerson for the exact semantics.
 */
import { NextResponse, type NextRequest } from "next/server";

import { AdminAccessError, requireAdmin } from "@/lib/auth/admin-session";
import { parsePersonPatchBody } from "@/lib/admin/people";
import {
  PersonAdminError,
  patchPerson,
  removePerson,
} from "@/lib/admin/people-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

function adminDenied(error: unknown): NextResponse | null {
  if (!(error instanceof AdminAccessError)) return null;
  return NextResponse.json({ error: error.message }, { status: error.status });
}

function personError(error: unknown): NextResponse | null {
  if (!(error instanceof PersonAdminError)) return null;
  return NextResponse.json({ error: error.message }, { status: error.status });
}

export async function PATCH(request: NextRequest, context: Context) {
  let actor: { email: string };
  try {
    actor = await requireAdmin();
  } catch (error) {
    const denied = adminDenied(error);
    if (denied) return denied;
    throw error;
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const patch = parsePersonPatchBody(raw);
  if (!patch) {
    return NextResponse.json(
      { error: "Send a display name and/or a hidden flag." },
      { status: 422 },
    );
  }

  const { slug } = await context.params;
  try {
    await patchPerson(slug, patch, actor.email);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const known = personError(error);
    if (known) return known;
    return NextResponse.json(
      { error: "Could not save that change." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  let actor: { email: string };
  try {
    actor = await requireAdmin();
  } catch (error) {
    const denied = adminDenied(error);
    if (denied) return denied;
    throw error;
  }

  const { slug } = await context.params;
  try {
    const outcome = await removePerson(slug, actor.email);
    return NextResponse.json({ outcome });
  } catch (error) {
    const known = personError(error);
    if (known) return known;
    return NextResponse.json(
      { error: "Could not remove that person." },
      { status: 500 },
    );
  }
}
