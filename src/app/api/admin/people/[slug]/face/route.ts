/**
 * PUT    /api/admin/people/[slug]/face -- hand-pick a face: a published
 *         photo id plus a normalized square crop (x, y as fractions of the
 *         image's width/height, size as a fraction of its shorter axis).
 * DELETE /api/admin/people/[slug]/face -- revert to the automatic crop.
 */
import { NextResponse, type NextRequest } from "next/server";

import { AdminAccessError, requireAdmin } from "@/lib/auth/admin-session";
import { parseFacePutBody } from "@/lib/admin/people";
import {
  PersonAdminError,
  clearPersonFace,
  savePersonFace,
} from "@/lib/admin/people-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

function adminDenied(error: unknown): NextResponse | null {
  if (!(error instanceof AdminAccessError)) return null;
  return NextResponse.json({ error: error.message }, { status: error.status });
}

export async function PUT(request: NextRequest, context: Context) {
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
  const body = parseFacePutBody(raw);
  if (!body) {
    return NextResponse.json(
      { error: "A face needs a photoId and a crop { x, y, size }." },
      { status: 422 },
    );
  }

  const { slug } = await context.params;
  try {
    await savePersonFace(slug, body.photoId, body.crop, actor.email);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PersonAdminError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Could not save that face." },
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
    await clearPersonFace(slug, actor.email);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PersonAdminError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Could not revert that face." },
      { status: 500 },
    );
  }
}
