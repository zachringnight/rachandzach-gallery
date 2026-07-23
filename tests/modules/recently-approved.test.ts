/**
 * Recently Added / getRecentlyApproved tests (packet 11, bonus coverage
 * beyond the packet's required done-check files). Reuses task 06's shared,
 * deterministic gallery fixture (tests/fixtures/gallery/catalog.ts) rather
 * than building a parallel one, per this packet's fixture-ownership rule
 * (treat other packets' fixtures as read-only reuse).
 */
import { describe, expect, it } from "vitest";
import { getGalleryPage } from "@/lib/gallery/query";
import { RECENTLY_APPROVED_RAIL_LIMIT, getRecentlyApproved } from "@/lib/modules/contracts";
import { buildGalleryFixture } from "../fixtures/gallery/catalog";

describe("getRecentlyApproved", () => {
  it("caps the home rail at 12 by contract", () => {
    expect(RECENTLY_APPROVED_RAIL_LIMIT).toBe(12);
  });

  it("returns only approved guest-sourced photos", async () => {
    const { dataSource, approved } = buildGalleryFixture();
    const guestApprovedIds = new Set(
      approved.filter((p) => p.source === "guest").map((p) => p.id),
    );

    const photos = await getRecentlyApproved(RECENTLY_APPROVED_RAIL_LIMIT, dataSource);

    expect(photos.length).toBeGreaterThan(0);
    expect(photos.length).toBeLessThanOrEqual(RECENTLY_APPROVED_RAIL_LIMIT);
    for (const photo of photos) {
      expect(photo.source).toBe("guest");
      expect(guestApprovedIds.has(photo.id)).toBe(true);
    }
  });

  it("never returns the fixture's pending, hidden, or rejected rows, even though they are also source=guest", async () => {
    const { dataSource, pendingId, hiddenId, rejectedId } = buildGalleryFixture();
    const photos = await getRecentlyApproved(100, dataSource);
    const ids = new Set(photos.map((p) => p.id));
    expect(ids.has(pendingId)).toBe(false);
    expect(ids.has(hiddenId)).toBe(false);
    expect(ids.has(rejectedId)).toBe(false);
  });

  it("respects a smaller explicit limit", async () => {
    const { dataSource } = buildGalleryFixture();
    const photos = await getRecentlyApproved(3, dataSource);
    expect(photos).toHaveLength(3);
  });

  it("matches calling getGalleryPage directly with the same source/sort/limit", async () => {
    const { dataSource } = buildGalleryFixture();
    const viaHelper = await getRecentlyApproved(5, dataSource);
    const direct = await getGalleryPage({ source: "guest", sort: "newest", limit: 5 }, dataSource);
    expect(viaHelper.map((p) => p.id)).toEqual(direct.photos.map((p) => p.id));
  });
});
