import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { AdminAccessError } from "@/lib/auth/admin-session";
import {
  GET as getCatalog,
  PATCH as patchCatalog,
} from "@/app/api/admin/catalog/route";

const {
  requireAdminMock,
  loadAdminCatalogPageMock,
  applyCatalogMetadataPatchMock,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  loadAdminCatalogPageMock: vi.fn(),
  applyCatalogMetadataPatchMock: vi.fn(),
}));

vi.mock("@/lib/auth/admin-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/admin-session")>();
  return { ...actual, requireAdmin: requireAdminMock };
});

vi.mock("@/lib/admin/catalog-server", () => ({
  CatalogMetadataInputError: class CatalogMetadataInputError extends Error {
    readonly status = 422;
  },
  loadAdminCatalogPage: loadAdminCatalogPageMock,
  applyCatalogMetadataPatch: applyCatalogMetadataPatchMock,
}));

const PHOTO = "11111111-1111-4111-8111-111111111111";

function grantAdmin() {
  requireAdminMock.mockResolvedValue({
    userId: "00000000-0000-4000-8000-000000000001",
    email: "wedding@rachandzach.com",
  });
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest("https://gallery.test/api/admin/catalog", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireAdminMock.mockReset();
  loadAdminCatalogPageMock.mockReset();
  applyCatalogMetadataPatchMock.mockReset();
});

describe("/api/admin/catalog", () => {
  it("requires the allowlisted admin before reading or writing", async () => {
    requireAdminMock.mockRejectedValue(new AdminAccessError("denied", 401));

    const getResponse = await getCatalog(
      new NextRequest("https://gallery.test/api/admin/catalog"),
    );
    const patchResponse = await patchCatalog(
      patchRequest({ photoIds: [PHOTO], eventSlug: null }),
    );

    expect(getResponse.status).toBe(401);
    expect(patchResponse.status).toBe(401);
    expect(loadAdminCatalogPageMock).not.toHaveBeenCalled();
    expect(applyCatalogMetadataPatchMock).not.toHaveBeenCalled();
  });

  it("passes normalized filters and cursor to the catalog loader", async () => {
    grantAdmin();
    loadAdminCatalogPageMock.mockResolvedValue({
      photos: [],
      nextCursor: null,
      total: 0,
      signedUrlExpiresAt: "2026-07-24T00:00:00.000Z",
    });

    const response = await getCatalog(
      new NextRequest(
        "https://gallery.test/api/admin/catalog?needs=missing-people&sort=newest&cursor=abc",
      ),
    );

    expect(response.status).toBe(200);
    expect(loadAdminCatalogPageMock).toHaveBeenCalledWith(
      {
        query: "",
        needs: "missing-people",
        event: null,
        person: null,
        source: null,
        sort: "newest",
      },
      "abc",
    );
  });

  it("rejects no-op payloads and applies valid bulk changes", async () => {
    grantAdmin();
    expect(
      (await patchCatalog(patchRequest({ photoIds: [PHOTO] }))).status,
    ).toBe(422);

    applyCatalogMetadataPatchMock.mockResolvedValue([
      { photoId: PHOTO, ok: true },
    ]);
    const response = await patchCatalog(
      patchRequest({
        photoIds: [PHOTO],
        addPeopleSlugs: ["rachel"],
      }),
    );
    expect(response.status).toBe(200);
    expect(applyCatalogMetadataPatchMock).toHaveBeenCalledWith(
      {
        photoIds: [PHOTO],
        addPeopleSlugs: ["rachel"],
        removePeopleSlugs: [],
        addKeywords: [],
        removeKeywords: [],
      },
      "00000000-0000-4000-8000-000000000001",
    );
  });
});
