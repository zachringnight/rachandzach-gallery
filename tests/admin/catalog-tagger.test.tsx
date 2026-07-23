import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CatalogTagger } from "@/components/admin/CatalogTagger";
import type {
  AdminCatalogPage,
  AdminCatalogPhoto,
} from "@/lib/admin/catalog";
import { ADMIN_CATALOG_MAX_SELECTION } from "@/lib/admin/catalog";

const PHOTO_A = "11111111-1111-4111-8111-111111111111";
const PHOTO_B = "22222222-2222-4222-8222-222222222222";

function photo(
  id: string,
  filename: string,
  people: AdminCatalogPhoto["people"] = [],
): AdminCatalogPhoto {
  return {
    id,
    eventSlug: "ceremony",
    eventName: "Ceremony",
    source: "photographer",
    orientation: "landscape",
    width: 1600,
    height: 1067,
    aspectRatio: 1.5,
    capturedAt: "2025-07-19T20:00:00.000Z",
    people,
    keywords: ["flowers"],
    previews: [
      {
        url: `https://example.test/${id}.jpg`,
        width: 480,
        height: 320,
        format: "jpeg",
      },
    ],
    originalFilename: filename,
    completeness: people.length > 0 ? "complete" : "missing-people",
  };
}

function page(
  photos: AdminCatalogPhoto[] = [
    photo(PHOTO_A, "RZ-001.jpg"),
    photo(PHOTO_B, "RZ-002.jpg", [
      { slug: "rachel", displayName: "Rachel" },
    ]),
  ],
): AdminCatalogPage {
  return {
    photos,
    nextCursor: null,
    total: photos.length,
    signedUrlExpiresAt: "2026-07-24T00:00:00.000Z",
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CatalogTagger", () => {
  it("selects frames and sends the chosen bulk person tag", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ photoId: PHOTO_A, ok: true }],
            updated: 1,
            failed: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CatalogTagger
        initialPage={page()}
        initialFilters={{
          query: "",
          needs: "all",
          event: null,
          person: null,
          source: null,
          sort: "weekend",
        }}
        events={[{ slug: "ceremony", name: "Ceremony" }]}
        people={[{ slug: "rachel", name: "Rachel" }]}
      />,
    );

    fireEvent.click(
      screen.getAllByRole("checkbox", { name: /Select Ceremony/ })[0],
    );
    expect(screen.getByText("1 selected")).toBeDefined();

    fireEvent.change(
      screen.getByLabelText("Person", { selector: "#catalog-person" }),
      { target: { value: "rachel" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply to 1 photo" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, options] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/admin/catalog");
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(String(options.body))).toEqual({
      photoIds: [PHOTO_A],
      addPeopleSlugs: ["rachel"],
      removePeopleSlugs: [],
      addKeywords: [],
      removeKeywords: [],
    });
    expect(await screen.findByText("Updated 1 photo.")).toBeDefined();
  });

  it("filters by missing metadata and clears the current selection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(page()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CatalogTagger
        initialPage={page()}
        initialFilters={{
          query: "",
          needs: "all",
          event: null,
          person: null,
          source: null,
          sort: "weekend",
        }}
        events={[{ slug: "ceremony", name: "Ceremony" }]}
        people={[{ slug: "rachel", name: "Rachel" }]}
      />,
    );

    fireEvent.click(
      screen.getAllByRole("checkbox", { name: /Select Ceremony/ })[0],
    );
    fireEvent.change(screen.getByLabelText("Tag status"), {
      target: { value: "missing-people" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/catalog?needs=missing-people",
        { cache: "no-store" },
      );
    });
    expect(screen.getByText("Select frames to edit together")).toBeDefined();
  });

  it("keeps a bulk edit inside the server selection bound", () => {
    const photos = Array.from(
      { length: ADMIN_CATALOG_MAX_SELECTION + 1 },
      (_, index) => photo(`photo-${index}`, `RZ-${index}.jpg`),
    );

    render(
      <CatalogTagger
        initialPage={page(photos)}
        initialFilters={{
          query: "",
          needs: "all",
          event: null,
          person: null,
          source: null,
          sort: "weekend",
        }}
        events={[{ slug: "ceremony", name: "Ceremony" }]}
        people={[{ slug: "rachel", name: "Rachel" }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select loaded" }));

    expect(
      screen.getByText(`${ADMIN_CATALOG_MAX_SELECTION} selected`),
    ).toBeDefined();
    expect(
      screen.getByText(
        `The desk holds up to ${ADMIN_CATALOG_MAX_SELECTION} photos at once. Your first ${ADMIN_CATALOG_MAX_SELECTION} stay selected.`,
      ),
    ).toBeDefined();
  });
});
