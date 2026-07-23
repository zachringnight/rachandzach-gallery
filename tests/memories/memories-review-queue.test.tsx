/**
 * MemoriesReviewQueue render states (Memories wall, Round Two): the pending
 * list, approve / reject wiring to /api/admin/memories, row removal after a
 * decision, and the empty state.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoriesReviewQueue } from "@/components/memories/MemoriesReviewQueue";
import type { AdminMemory } from "@/lib/memories/shared";

const PHOTO = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function pendingMemory(id: string, body: string, displayName: string | null): AdminMemory {
  return {
    id,
    photoId: PHOTO,
    displayName,
    body,
    status: "pending",
    createdAt: "2026-07-22T18:00:00Z",
    reviewedAt: null,
  };
}

describe("MemoriesReviewQueue", () => {
  it("shows the empty state when nothing is waiting", () => {
    render(<MemoriesReviewQueue initialPending={[]} />);
    expect(screen.getByText("Nothing waiting on you right now.")).toBeDefined();
  });

  it("lists pending notes with byline, photo link, and both decision buttons", () => {
    render(
      <MemoriesReviewQueue
        initialPending={[
          pendingMemory("m1", "We loved the band.", "Sarah"),
          pendingMemory("m2", "Unattributed thought.", null),
        ]}
      />,
    );
    expect(screen.getByText("We loved the band.")).toBeDefined();
    expect(screen.getByText(/Sarah/)).toBeDefined();
    expect(screen.getByText(/Anonymous guest/)).toBeDefined();
    const links = screen.getAllByRole("link", { name: "View photo" });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveProperty("href", expect.stringContaining(`/photos/${PHOTO}`));
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(2);
  });

  it("posts an approval and removes the decided row", async () => {
    const user = userEvent.setup();
    const spy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "m1", status: "approved" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", spy);

    render(
      <MemoriesReviewQueue
        initialPending={[
          pendingMemory("m1", "Approve me.", null),
          pendingMemory("m2", "Leave me pending.", null),
        ]}
      />,
    );
    await user.click(screen.getAllByRole("button", { name: "Approve" })[0]);

    await waitFor(() => {
      expect(screen.queryByText("Approve me.")).toBeNull();
    });
    expect(screen.getByText("Leave me pending.")).toBeDefined();
    expect(spy).toHaveBeenCalledWith(
      "/api/admin/memories/m1/approve",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps the row and shows an error when a rejection fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
        ),
      ),
    );

    render(
      <MemoriesReviewQueue
        initialPending={[pendingMemory("m1", "Sticky row.", null)]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText("Sticky row.")).toBeDefined();
  });
});
