/**
 * FaceTagSuggestions surface + its wiring into BatchReviewer (Round Two
 * moderation assist): aggregation and selection scoping, the render-nothing
 * default, and the pre-checked-at-high-confidence seeding feeding the
 * existing confirmed-tag decision flow (MetadataEditor's peopleSlugs).
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aggregateSuggestions,
  FaceTagSuggestions,
  type ItemFaceSuggestions,
} from "@/components/admin/FaceTagSuggestions";
import { BatchReviewer } from "@/components/admin/BatchReviewer";
import type { ReviewItem } from "@/components/admin/BatchReviewer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const JO = { slug: "jo-cohn", name: "Jo Cohn", similarity: 0.75, confident: true };
const SAM = { slug: "sam-day", name: "Sam Day", similarity: 0.52, confident: false };

const TWO_ITEMS: ItemFaceSuggestions[] = [
  { itemId: "item-1", suggestions: [JO, SAM] },
  { itemId: "item-2", suggestions: [{ ...JO, similarity: 0.6 }] },
];

describe("aggregateSuggestions", () => {
  it("unions across items keeping the strongest match per person, strongest first", () => {
    const rows = aggregateSuggestions(TWO_ITEMS, []);
    expect(rows).toEqual([JO, SAM]);
  });

  it("scopes to the selected items when a selection exists", () => {
    const rows = aggregateSuggestions(TWO_ITEMS, ["item-2"]);
    expect(rows).toEqual([{ ...JO, similarity: 0.6 }]);
  });

  it("returns [] for empty input", () => {
    expect(aggregateSuggestions([], [])).toEqual([]);
  });
});

describe("FaceTagSuggestions", () => {
  it("renders nothing at all when there are no suggestions", () => {
    const { container } = render(
      <FaceTagSuggestions
        itemSuggestions={[]}
        selectedItemIds={[]}
        confirmedSlugs={[]}
        onToggle={() => {}}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows each proposed person with match strength; checked follows confirmedSlugs", () => {
    render(
      <FaceTagSuggestions
        itemSuggestions={TWO_ITEMS}
        selectedItemIds={[]}
        confirmedSlugs={["jo-cohn"]}
        onToggle={() => {}}
      />,
    );
    const jo = screen.getByRole("checkbox", { name: /Jo Cohn/ });
    const sam = screen.getByRole("checkbox", { name: /Sam Day/ });
    expect((jo as HTMLInputElement).checked).toBe(true);
    expect((sam as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/75% match, strong/)).toBeDefined();
    expect(screen.getByText(/52% match/)).toBeDefined();
  });

  it("reports toggles through onToggle with the slug", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <FaceTagSuggestions
        itemSuggestions={TWO_ITEMS}
        selectedItemIds={[]}
        confirmedSlugs={[]}
        onToggle={onToggle}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: /Sam Day/ }));
    expect(onToggle).toHaveBeenCalledWith("sam-day");
  });
});

describe("BatchReviewer wiring", () => {
  const items: ReviewItem[] = [
    {
      itemId: "item-1",
      originalName: "IMG_1234.jpg",
      mediaType: "image/jpeg",
      bytes: 1024 * 1024,
      status: "pending",
      rejectionReason: null,
      previewUrl: null,
      createdAt: "2026-07-20T02:00:00Z",
    },
  ];

  function renderReviewer(
    faceSuggestions?: ItemFaceSuggestions[],
    options: { items?: ReviewItem[]; batchStatus?: string } = {},
  ) {
    return render(
      <BatchReviewer
        batchId="11111111-1111-4111-8111-111111111111"
        displayName="A guest"
        email={null}
        note={null}
        batchStatus={options.batchStatus ?? "pending"}
        items={options.items ?? items}
        events={[]}
        people={[
          { slug: "jo-cohn", name: "Jo Cohn" },
          { slug: "sam-day", name: "Sam Day" },
        ]}
        notifications={[]}
        faceSuggestions={faceSuggestions}
      />,
    );
  }

  it("renders no suggestion surface when the pipeline produced nothing", () => {
    renderReviewer(undefined);
    expect(screen.queryByText("Face suggestions")).toBeNull();
  });

  it("pre-checks confident matches into the confirmed-people flow; review-tier stays unchecked", () => {
    renderReviewer([{ itemId: "item-1", suggestions: [JO, SAM] }]);
    const jo = screen.getByRole("checkbox", { name: /Jo Cohn/ }) as HTMLInputElement;
    const sam = screen.getByRole("checkbox", { name: /Sam Day/ }) as HTMLInputElement;
    expect(jo.checked).toBe(true);
    expect(sam.checked).toBe(false);
  });

  it("keeps the suggestion checkboxes and MetadataEditor's person chips as one shared state", async () => {
    const user = userEvent.setup();
    renderReviewer([{ itemId: "item-1", suggestions: [JO, SAM] }]);

    // Unchecking the pre-checked suggestion unstages the person entirely.
    const jo = screen.getByRole("checkbox", { name: /Jo Cohn/ }) as HTMLInputElement;
    await user.click(jo);
    expect(jo.checked).toBe(false);

    // Staging a person from MetadataEditor's chip checks the suggestion box.
    await user.click(screen.getByRole("button", { name: "Sam Day" }));
    const sam = screen.getByRole("checkbox", { name: /Sam Day/ }) as HTMLInputElement;
    expect(sam.checked).toBe(true);
  });

  it.each(["submitted", "under_review"])(
    "allows an approved item in an active %s batch to retry without making it rejectable",
    async (batchStatus) => {
      const user = userEvent.setup();
      const retryItems: ReviewItem[] = [
        {
          ...items[0],
          itemId: "approved-item",
          originalName: "retry-approved.jpg",
          status: "approved",
        },
        {
          ...items[0],
          itemId: "rejected-item",
          originalName: "already-rejected.jpg",
          status: "rejected",
        },
      ];
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [{ itemId: "approved-item", ok: true }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      renderReviewer(undefined, {
        items: retryItems,
        batchStatus,
      });

      const approved = screen.getByRole("checkbox", {
        name: /retry-approved\.jpg/i,
      }) as HTMLInputElement;
      const rejected = screen.getByRole("checkbox", {
        name: /already-rejected\.jpg/i,
      }) as HTMLInputElement;
      expect(approved.disabled).toBe(false);
      expect(rejected.disabled).toBe(true);

      await user.click(approved);
      expect(
        (
          screen.getByRole("button", {
            name: "Reject (0)",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      await user.click(screen.getByRole("button", { name: "Approve (1)" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [, request] = fetchMock.mock.calls[0];
      expect(JSON.parse(String(request?.body))).toMatchObject({
        itemIds: ["approved-item"],
      });
    },
  );

  it.each(["approved", "partially_approved", "rejected"])(
    "keeps approved items disabled in terminal %s batches",
    (batchStatus) => {
      renderReviewer(undefined, {
        items: [
          {
            ...items[0],
            itemId: "approved-item",
            originalName: "already-terminal.jpg",
            status: "approved",
          },
        ],
        batchStatus,
      });

      const approved = screen.getByRole("checkbox", {
        name: /already-terminal\.jpg/i,
      }) as HTMLInputElement;
      expect(approved.disabled).toBe(true);
    },
  );

  it("filters an approved retry out of a mixed Reject action", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ itemId: "pending-item", ok: true }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    renderReviewer(undefined, {
      items: [
        {
          ...items[0],
          itemId: "approved-item",
          originalName: "retry-approved.jpg",
          status: "approved",
        },
        {
          ...items[0],
          itemId: "pending-item",
          originalName: "still-pending.jpg",
          status: "pending",
        },
      ],
      batchStatus: "submitted",
    });

    await user.click(
      screen.getByRole("checkbox", { name: /retry-approved\.jpg/i }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: /still-pending\.jpg/i }),
    );
    await user.click(screen.getByRole("button", { name: "Reject (1)" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, request] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/reject");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      itemIds: ["pending-item"],
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Approve (1)" }),
      ).toBeDefined(),
    );
  });
});
