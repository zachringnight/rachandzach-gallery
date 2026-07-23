/**
 * Reveal motion primitive tests (packet 00). jsdom has no
 * IntersectionObserver, so a recording mock is stubbed in for every test;
 * matchMedia mocking follows the tv.test.tsx pattern. Covers the scoped
 * list: children render inside the requested `as` element, `data-reveal`
 * flips to "in" when the observed entry intersects, and under
 * prefers-reduced-motion no transform style is applied (the element is shown
 * immediately with no motion styles at all). A couple of small supporting
 * assertions (observer options, motion custom properties in the normal path)
 * pin the packet's exact contract without expanding past that scope.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Reveal } from "@/components/motion/Reveal";

type IOCallback = (
  entries: IntersectionObserverEntry[],
  observer: IntersectionObserver,
) => void;

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly callback: IOCallback;
  readonly options?: IntersectionObserverInit;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(callback: IOCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.instances.push(this);
  }

  intersect(target: Element, isIntersecting: boolean) {
    this.callback(
      [{ target, isIntersecting } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "matchMedia");
  vi.restoreAllMocks();
});

describe("Reveal rendering", () => {
  it("renders children inside the default div wrapper, hidden-state armed", () => {
    const { container } = render(<Reveal>Reveal me</Reveal>);
    expect(screen.getByText("Reveal me")).toBeDefined();
    const el = container.firstElementChild;
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe("DIV");
    expect(el!.getAttribute("data-reveal")).toBe("out");
  });

  it("renders the `as` element and passes className through", () => {
    const { container } = render(
      <Reveal as="section" className="stack">
        content
      </Reveal>,
    );
    const el = container.firstElementChild;
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe("SECTION");
    expect(el!.className).toBe("stack");
    expect(el!.textContent).toBe("content");
  });

  it("sets the motion custom properties from y and delayMs when motion is allowed", () => {
    const { container } = render(
      <Reveal delayMs={120} y={32}>
        moving
      </Reveal>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue("--rz-reveal-y")).toBe("32px");
    expect(el.style.getPropertyValue("--rz-reveal-delay")).toBe("120ms");
  });
});

describe("Reveal intersection", () => {
  it('observes with the packet options and flips data-reveal to "in" when the entry intersects', () => {
    const { container } = render(<Reveal>content</Reveal>);
    const el = container.firstElementChild as HTMLElement;
    const io = MockIntersectionObserver.instances.at(-1);
    expect(io).toBeDefined();
    expect(io!.observe).toHaveBeenCalledWith(el);
    expect(io!.options).toEqual({
      threshold: 0.15,
      rootMargin: "0px 0px -10% 0px",
    });

    // A non-intersecting callback (initial observation off-screen) stays out.
    act(() => io!.intersect(el, false));
    expect(el.getAttribute("data-reveal")).toBe("out");

    act(() => io!.intersect(el, true));
    expect(el.getAttribute("data-reveal")).toBe("in");
    // once defaults true: the revealed element is left alone afterwards.
    expect(io!.unobserve).toHaveBeenCalledWith(el);
  });
});

describe("Reveal reduced motion", () => {
  it("applies no transform style; content just appears, observer never engaged", () => {
    mockReducedMotion(true);
    const { container } = render(
      <Reveal delayMs={120} y={32}>
        calm
      </Reveal>,
    );
    const el = container.firstElementChild as HTMLElement;
    // Shown immediately: the CSS hidden state (which carries the translateY)
    // can never match, and no observer was created.
    expect(el.getAttribute("data-reveal")).toBe("in");
    expect(MockIntersectionObserver.instances).toHaveLength(0);
    // No inline transform, and the motion custom properties are dropped too.
    expect(el.style.transform).toBe("");
    expect(el.style.getPropertyValue("--rz-reveal-y")).toBe("");
    expect(el.style.getPropertyValue("--rz-reveal-delay")).toBe("");
  });
});
