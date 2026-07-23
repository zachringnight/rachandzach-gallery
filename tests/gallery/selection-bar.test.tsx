import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SelectionBar } from "@/components/gallery/SelectionBar";

afterEach(cleanup);

describe("SelectionBar", () => {
  it("keeps download, native save, favorite, and clear actions together", () => {
    render(
      <SelectionBar
        count={2}
        onFavoriteAll={vi.fn()}
        onClear={vi.fn()}
        downloadControl={<button type="button">Download ZIP</button>}
        saveControl={<button type="button">Save photos</button>}
      />,
    );

    expect(
      screen.getByLabelText("Selected photos").textContent,
    ).toContain("2 photos selected");
    expect(screen.getByRole("button", { name: "Download ZIP" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Save photos" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Favorite all" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDefined();
  });
});
