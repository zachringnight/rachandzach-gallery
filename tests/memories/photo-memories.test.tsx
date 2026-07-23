/**
 * PhotoMemories render states (Memories wall, Round Two): the approved wall,
 * the quiet empty state, the composer's pending-review notice, and error
 * paths. fetch is stubbed per test; the component talks only to
 * /api/memories.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhotoMemories } from "@/components/memories/PhotoMemories";
import type { GuestMemory } from "@/lib/memories/shared";

const PHOTO = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(handler: (input: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function approvedWall(memories: GuestMemory[]) {
  return stubFetch((url, init) => {
    if ((init?.method ?? "GET") === "GET") {
      return jsonResponse({ memories });
    }
    return jsonResponse({ id: "new-id", status: "pending" }, 201);
  });
}

describe("PhotoMemories wall", () => {
  it("renders approved notes as quiet captions with optional bylines", async () => {
    approvedWall([
      {
        id: "m1",
        displayName: "Sarah",
        body: "We danced until they turned the lights on.",
        createdAt: "2026-07-19T23:00:00Z",
      },
      {
        id: "m2",
        displayName: null,
        body: "Best table assignment of my life.",
        createdAt: "2026-07-19T23:30:00Z",
      },
    ]);
    render(<PhotoMemories photoId={PHOTO} />);

    expect(
      await screen.findByText("We danced until they turned the lights on."),
    ).toBeDefined();
    expect(screen.getByText("From Sarah")).toBeDefined();
    expect(screen.getByText("Best table assignment of my life.")).toBeDefined();
    // The anonymous note carries no byline.
    expect(screen.getAllByText(/^From /)).toHaveLength(1);
  });

  it("shows the quiet empty state when nobody has written yet", async () => {
    approvedWall([]);
    render(<PhotoMemories photoId={PHOTO} />);
    expect(
      await screen.findByText("No memories on this photo yet. Leave the first one."),
    ).toBeDefined();
  });

  it("shows the unavailable state when the list request fails", async () => {
    stubFetch(() => jsonResponse({ error: "nope" }, 500));
    render(<PhotoMemories photoId={PHOTO} />);
    expect(
      await screen.findByText("Memories are unavailable right now."),
    ).toBeDefined();
  });
});

describe("PhotoMemories composer", () => {
  it("mentions review before sending and confirms the pending state after", async () => {
    const user = userEvent.setup();
    const spy = approvedWall([]);
    render(<PhotoMemories photoId={PHOTO} />);

    await user.click(
      await screen.findByRole("button", { name: "Leave a memory" }),
    );
    // The pending-review notice is visible while composing.
    expect(
      screen.getByText(/approve memories before they appear/),
    ).toBeDefined();

    await user.type(
      screen.getByLabelText(/Your memory/),
      "The toast was perfect.",
    );
    await user.type(screen.getByLabelText(/Your name/), "Sarah");
    await user.click(screen.getByRole("button", { name: "Share it" }));

    expect(
      await screen.findByText(/yours will appear here once it is approved/),
    ).toBeDefined();

    const post = spy.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(post).toBeDefined();
    const body = JSON.parse(String((post![1] as RequestInit).body)) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({
      photoId: PHOTO,
      body: "The toast was perfect.",
      displayName: "Sarah",
    });
  });

  it("surfaces the server's message when a send is refused", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if ((init?.method ?? "GET") === "GET") return jsonResponse({ memories: [] });
      return jsonResponse(
        { error: "That is a lot of memories at once. Give it a few minutes." },
        429,
      );
    });
    render(<PhotoMemories photoId={PHOTO} />);

    await user.click(
      await screen.findByRole("button", { name: "Leave a memory" }),
    );
    await user.type(screen.getByLabelText(/Your memory/), "Too fast");
    await user.click(screen.getByRole("button", { name: "Share it" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveProperty(
      "textContent",
      "That is a lot of memories at once. Give it a few minutes.",
    );
    // No pending confirmation appeared.
    expect(screen.queryByText(/yours will appear here/)).toBeNull();
  });
});
