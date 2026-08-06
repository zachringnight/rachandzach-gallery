import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import EnterPage from "@/app/(access)/enter/page";

afterEach(cleanup);

/**
 * The access page is an async server component; awaiting it yields plain JSX
 * that testing-library can render. The contract under test is the hidden
 * `next` input the form posts to /api/access/login: it decides where a
 * guest lands after the password.
 */
async function renderEnter(params?: { error?: string; next?: string }) {
  const view = render(
    await EnterPage({ searchParams: Promise.resolve(params ?? {}) }),
  );
  const next = view.container.querySelector<HTMLInputElement>(
    'input[name="next"]',
  );
  expect(next, "the form must carry a hidden next input").not.toBeNull();
  return { view, next: next as HTMLInputElement };
}

describe("/enter destination", () => {
  it("lands a plain sign-in on Find me, not the full archive", async () => {
    const { next } = await renderEnter();
    expect(next.value).toBe("/my-weekend");
  });

  it("lets a sanitized deep link win over the default", async () => {
    const { next } = await renderEnter({ next: "/photos?event=wedding" });
    expect(next.value).toBe("/photos?event=wedding");
  });

  it("collapses an unsafe next back to Find me", async () => {
    const { next } = await renderEnter({ next: "https://evil.example/steal" });
    expect(next.value).toBe("/my-weekend");
  });

  it("collapses an /enter loop back to Find me", async () => {
    const { next } = await renderEnter({ next: "/enter?next=/enter" });
    expect(next.value).toBe("/my-weekend");
  });
});
