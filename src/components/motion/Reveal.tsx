"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * Scroll-reveal primitive (packet 00). Wraps children in a plain flow
 * container that starts hidden (opacity 0, translateY) and eases in over
 * `--rz-dur-slow` / `--rz-ease-out` when it scrolls into view, with an
 * optional `delayMs` stagger for siblings. The reveal flips `data-reveal`
 * to "in" directly on the observed node (no per-reveal React render), and
 * the visual states live in src/styles/tokens.css.
 *
 * Safety rails, in order of precedence:
 * - No JS: the hidden state lives behind the `html.js` gate in tokens.css
 *   (the root layout stamps the class inline before hydration), so content
 *   is always visible without JS.
 * - prefers-reduced-motion: the element renders shown immediately, the
 *   observer is never engaged, and the motion custom properties are dropped,
 *   so no transform or transition exists. Content just appears.
 * - No IntersectionObserver (ancient browser): reveal immediately rather
 *   than leaving content hidden.
 */

type RevealTag = "article" | "div" | "section" | "li" | "span" | "figure";

export interface RevealProps {
  /** Element to render (all plain flow containers). Default "div". */
  as?: RevealTag;
  /** Transition-delay in ms, for staggering sibling reveals. Default 0. */
  delayMs?: number;
  /** Hidden-state translateY offset in px. Default 24. */
  y?: number;
  /** Reveal once and unobserve (default), or re-hide when scrolled out. */
  once?: boolean;
  className?: string;
  children: ReactNode;
}

const OBSERVER_OPTIONS: IntersectionObserverInit = {
  threshold: 0.15,
  rootMargin: "0px 0px -10% 0px",
};

/** Mirrors usePrefersReducedMotion in Slideshow.tsx: getServerSnapshot always
 *  returns false, so SSR and the pre-hydration client render agree, and
 *  useSyncExternalStore syncs to the guest's real OS preference right after
 *  mount without a hydration warning or a setState-in-effect. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    useCallback((onStoreChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
      }
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onStoreChange);
      return () => query.removeEventListener("change", onStoreChange);
    }, []),
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false,
    () => false,
  );
}

export function Reveal({
  as = "div",
  delayMs = 0,
  y = 24,
  once = true,
  className,
  children,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      node.dataset.reveal = "in";
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          node.dataset.reveal = "in";
          if (once) observer.unobserve(entry.target);
        } else if (!once) {
          node.dataset.reveal = "out";
        }
      }
    }, OBSERVER_OPTIONS);
    observer.observe(node);
    return () => observer.disconnect();
  }, [once, reducedMotion]);

  const Tag = as;
  return (
    <Tag
      ref={(node: HTMLElement | null) => {
        ref.current = node;
      }}
      data-reveal={reducedMotion ? "in" : "out"}
      className={className}
      style={
        reducedMotion
          ? undefined
          : ({
              "--rz-reveal-y": `${y}px`,
              "--rz-reveal-delay": `${delayMs}ms`,
            } as CSSProperties)
      }
    >
      {children}
    </Tag>
  );
}
