import { NextResponse, type NextRequest } from "next/server";

import {
  parseAdminCatalogFilters,
  parseCatalogMetadataPatch,
} from "@/lib/admin/catalog";
import {
  applyCatalogMetadataPatch,
  CatalogMetadataInputError,
  loadAdminCatalogPage,
} from "@/lib/admin/catalog-server";
import {
  AdminAccessError,
  requireAdmin,
} from "@/lib/auth/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function adminDenied(error: unknown): NextResponse | null {
  if (!(error instanceof AdminAccessError)) return null;
  return NextResponse.json(
    { error: error.message },
    { status: error.status },
  );
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    const denied = adminDenied(error);
    if (denied) return denied;
    throw error;
  }

  const filters = parseAdminCatalogFilters(request.nextUrl.searchParams);
  const cursor = request.nextUrl.searchParams.get("cursor");
  try {
    const page = await loadAdminCatalogPage(filters, cursor);
    return NextResponse.json(page);
  } catch {
    return NextResponse.json(
      { error: "Could not load the catalog right now." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  let actor: { userId: string; email: string };
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
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }
  const patch = parseCatalogMetadataPatch(raw);
  if (!patch) {
    return NextResponse.json(
      {
        error:
          "Choose photos and at least one valid event, person, or keyword change.",
      },
      { status: 422 },
    );
  }

  try {
    const results = await applyCatalogMetadataPatch(
      patch,
      actor.userId,
    );
    const failed = results.filter((result) => !result.ok).length;
    return NextResponse.json(
      { results, updated: results.length - failed, failed },
      { status: failed > 0 ? 207 : 200 },
    );
  } catch (error) {
    if (error instanceof CatalogMetadataInputError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Could not save those catalog changes." },
      { status: 500 },
    );
  }
}
