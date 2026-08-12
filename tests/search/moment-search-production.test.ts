import { describe, expect, it, vi } from "vitest";

import type {
  GalleryDataSource,
  GalleryPhotoSource,
} from "@/lib/gallery/query";
import {
  MomentSearchValidationError,
  searchMoments,
} from "@/lib/search/moment-search";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createSupabaseGalleryDataSource: vi.fn(),
  queryEmbeddingEvaluations: 0,
}));

vi.mock("@/content/features", () => ({
  featureFlags: { momentSearch: true },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/gallery/supabase-source", () => ({
  createSupabaseGalleryDataSource: mocks.createSupabaseGalleryDataSource,
}));

vi.mock("@/lib/search/query-embedding", () => {
  mocks.queryEmbeddingEvaluations += 1;
  throw new Error("native encoder import failed");
});

const ceremonyPhoto: GalleryPhotoSource = {
  id: "ceremony-photo",
  status: "published",
  source: "photographer",
  eventSlug: "ceremony",
  eventName: "Ceremony",
  eventOrder: 0,
  capturedAt: "2025-07-19T16:00:00.000Z",
  originalFilename: "ceremony-photo.jpg",
  width: 4000,
  height: 3000,
  orientation: "landscape",
  people: [],
  keywords: ["ceremony"],
  previews: [],
};

const dataSource: GalleryDataSource = {
  async listPhotos() {
    return [ceremonyPhoto];
  },
  async listEvents() {
    return [{ slug: "ceremony", name: "Ceremony", order: 0 }];
  },
  async listPeople() {
    return [];
  },
};

describe("searchMoments production wiring", () => {
  it("validates before loading the native encoder and contains import failure in keyword fallback", async () => {
    mocks.createAdminClient.mockReturnValue({});
    mocks.createSupabaseGalleryDataSource.mockReturnValue(dataSource);
    const reportFallback = vi.fn();

    await expect(
      searchMoments(
        { query: "a", event: null, limit: 24 },
        reportFallback,
      ),
    ).rejects.toBeInstanceOf(MomentSearchValidationError);
    expect(mocks.queryEmbeddingEvaluations).toBe(0);

    const results = await searchMoments(
      { query: "ceremony", event: null, limit: 24 },
      reportFallback,
    );

    expect(mocks.queryEmbeddingEvaluations).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      matchType: "keyword",
      similarity: 0,
      photo: { id: "ceremony-photo" },
    });
    expect(reportFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "embedding",
        error: expect.any(Error),
      }),
    );
  });
});
