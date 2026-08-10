import { describe, expect, it } from "vitest";

import { planLiveCatalogSync } from "../../scripts/lib/catalog-sync-plan.mjs";

function inputs({ withOverride = true } = {}) {
  return {
    state: {
      people: [
        { id: "old-id", slug: "old-name", display_name: "Old Name", photo_count: 2 },
        { id: "merge-id", slug: "merge-source", display_name: "Merge Source", photo_count: 1 },
        { id: "target-id", slug: "merge-target", display_name: "Merge Target", photo_count: 3 },
      ],
      overrides: withOverride
        ? [{ person_slug: "old-name", display_name: "Current Name" }]
        : [],
      photos: [{ id: "photo-id", image_data_hash: "photo-hash", status: "published" }],
      joins: [],
    },
    manifests: {
      attendance: {
        attendees: [
          {
            seatingName: "Current Name",
            personSlug: "old-name",
            displayName: "Current Name",
            resolution: "alias",
          },
        ],
      },
      reviewedTags: {
        additions: [{ photoId: "photo-hash", personSlug: "old-name" }],
      },
      personMerges: {
        schemaVersion: 1,
        merges: [{ fromSlug: "merge-source", intoSlug: "merge-target" }],
      },
    },
  };
}

describe("live catalog sync planning", () => {
  it("accepts a matching guest-facing override and exposes pending merges", () => {
    const { state, manifests } = inputs();

    const plan = planLiveCatalogSync(state, manifests);

    expect(plan.effectiveNameOverrides).toEqual([
      {
        slug: "old-name",
        baseDisplayName: "Old Name",
        effectiveDisplayName: "Current Name",
      },
    ]);
    expect(plan.personMergesPending).toEqual([
      {
        fromSlug: "merge-source",
        intoSlug: "merge-target",
        sourcePhotoCount: 1,
        targetPhotoCount: 3,
      },
    ]);
    expect(plan.tagsToAdd).toHaveLength(1);
  });

  it("still fails closed when neither the base row nor override has the approved name", () => {
    const { state, manifests } = inputs({ withOverride: false });

    expect(() => planLiveCatalogSync(state, manifests)).toThrow(
      /Live effective name mismatch for old-name/,
    );
  });

  it("reports an already-applied merge when only the target remains", () => {
    const { state, manifests } = inputs();
    state.people = state.people.filter((person) => person.slug !== "merge-source");

    const plan = planLiveCatalogSync(state, manifests);

    expect(plan.personMergesPending).toEqual([]);
    expect(plan.personMergesAlreadyApplied).toEqual([
      { fromSlug: "merge-source", intoSlug: "merge-target" },
    ]);
  });

  it("validates a hidden duplicate by its base identity, not its admin label", () => {
    const { state, manifests } = inputs();
    state.overrides[0] = {
      person_slug: "old-name",
      display_name: "Visible Record Name",
      hidden: true,
    };
    manifests.attendance.attendees[0].displayName = "Old Name";

    const plan = planLiveCatalogSync(state, manifests);

    expect(plan.effectiveNameOverrides).toEqual([]);
    expect(plan.hiddenNameOverrides).toEqual([
      {
        slug: "old-name",
        baseDisplayName: "Old Name",
        hiddenOverrideDisplayName: "Visible Record Name",
      },
    ]);
  });
});
