# Task 00: Tokens v2 + motion primitives

**Wave:** 0
**Depends on:** none

## Files
- Modify: `src/styles/tokens.css` (follow the existing pattern: private `--rz-*` values, public aliases in the same blocks where the current tokens live)
- Modify: `src/components/brand/Wordmark.tsx` (Fraunces axes only, see step 2)
- Modify: `src/app/layout.tsx` (js-gate class, step 4)
- Create: `src/components/motion/Reveal.tsx`
- Create: `tests/motion/reveal.test.tsx`

## Interfaces
- Produces (CSS tokens, exact names):
  - Type scale: `--rz-text-hero: clamp(2.75rem, 8vw, 6.5rem)`, `--rz-text-display: clamp(2rem, 5vw, 3.75rem)`, `--rz-text-title: clamp(1.5rem, 3vw, 2.25rem)`, `--rz-text-kicker: 0.75rem`
  - Motion: `--rz-ease-out: cubic-bezier(0.22, 1, 0.36, 1)`, `--rz-ease-inout: cubic-bezier(0.65, 0, 0.35, 1)`, `--rz-dur-fast: 200ms`, `--rz-dur-med: 450ms`, `--rz-dur-slow: 800ms`
  - Rhythm: `--rz-space-section: clamp(4rem, 10vw, 8rem)`, `--rz-space-prose: 42rem`
- Produces (component):
  `Reveal({ as?: "div" | "section" | "li" | "span" | "figure", delayMs?: number, y?: number, once?: boolean, className?: string, children: React.ReactNode })` renders its children wrapped in `as` (default "div"), hidden until scrolled into view, then eased in over `--rz-dur-slow` `--rz-ease-out` with `delayMs` stagger.

## Steps
- [ ] Add the tokens above to `src/styles/tokens.css`, private `--rz-*` first, public aliases following the file's existing "Public tokens" convention so Tailwind utilities can reach them.
- [ ] In `Wordmark.tsx`, extend the Fraunces `next/font` config with `axes: ["SOFT", "WONK", "opsz"]` if not already present (variable axes for editorial range; if the current config already pins axes, add only the missing ones). Do not change families or variable names; the wordmark must render pixel-identical at its current size.
- [ ] Implement `Reveal.tsx` ("use client"): IntersectionObserver with `threshold: 0.15`, `rootMargin: "0px 0px -10% 0px"`. No-JS safety: the hidden state applies only under an `html.js` gate (`.js [data-reveal]:not([data-reveal="in"]) { opacity: 0; transform: translateY(...) }` pattern, styles colocated via tokens.css additions or a module import). `prefers-reduced-motion: reduce` disables transform and transition entirely (content just appears). `once` defaults true (unobserve after reveal).
- [ ] In `src/app/layout.tsx`, add the js gate: a tiny inline `<script>` before hydration that does `document.documentElement.classList.add("js")`. Nothing else in the layout changes.
- [ ] Tests (`tests/motion/reveal.test.tsx`, jsdom): renders children and the `as` element; with a mocked IntersectionObserver, flips `data-reveal` to `"in"` when the entry intersects; with `matchMedia` mocked to `prefers-reduced-motion: reduce`, no transform style is applied.

## Done-check
Run: `npx vitest run tests/motion && npm run typecheck && npm run lint`
Expected: all pass, 0 lint errors.

## Report
DONE, or DONE_WITH_CONCERNS naming any token that had to deviate from the exact values above.
