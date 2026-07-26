/**
 * GET  /api/admin/people -- the guest roster the /admin/faces manager shows.
 * POST /api/admin/people -- add a person who is not in the catalog.
 *
 * Writes touch only rachandzach_person_overrides; the catalog is never
 * mutated from this surface.
 */
import { NextResponse, type NextRequest } from "next/server";

import { AdminAccessError, requireAdmin } from "@/lib/auth/admin-session";
import { parseAddPersonBody } from "@/lib/admin/people";
import {
  PersonAdminError,
  addPerson,
  loadGuestRoster,
} from "@/lib/admin/people-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function adminDenied(error: unknown): NextResponse | null {
  if (!(error instanceof AdminAccessError)) return null;
  return NextResponse.json({ error: error.message }, { status: error.status });
}

export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    const denied = adminDenied(error);
    if (denied) return denied;
    throw error;
  }

  try {
    const roster = await loadGuestRoster();
    return NextResponse.json(roster);
  } catch {
    return NextResponse.json(
      { error: "Could not load the guest roster right now." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
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
  const body = parseAddPersonBody(raw);
  if (!body) {
    return NextResponse.json(
      { error: "A person needs a display name (and an optional valid slug)." },
      { status: 422 },
    );
  }

  try {
    await addPerson(body.slug, body.displayName, actor.email);
    return NextResponse.json({ slug: body.slug }, { status: 201 });
  } catch (error) {
    if (error instanceof PersonAdminError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Could not add that person." },
      { status: 500 },
    );
  }
}
