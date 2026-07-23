import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSelection } from "@/components/gallery/useSelection";

afterEach(cleanup);

describe("useSelection", () => {
  it("toggles immutable photo ids and adds every visible id once", () => {
    const { result } = renderHook(() => useSelection());

    act(() => result.current.toggle("a"));
    expect(result.current.selecting).toBe(true);
    expect([...result.current.selected]).toEqual(["a"]);

    act(() => result.current.selectAllVisible(["a", "b", "", "b"]));
    expect([...result.current.selected]).toEqual(["a", "b"]);

    act(() => result.current.toggle("a"));
    expect([...result.current.selected]).toEqual(["b"]);
  });

  it("clears selection and selection mode with Escape", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectAllVisible(["a", "b"]));

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(result.current.selecting).toBe(false);
    expect(result.current.selected.size).toBe(0);
  });
});
