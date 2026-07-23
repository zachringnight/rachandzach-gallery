# Task 01: Brand and content foundation

**Wave:** 1
**Depends on:** none

## Objective

Create the shared visual and editorial system before page work begins. Reuse the canonical 0719 + co. mark, the old site's best factual copy, and the wheat-and-cream direction inspired by the actual wedding photos.

## Files

- Modify: package.json
- Modify: package-lock.json
- Modify: src/app/globals.css
- Create: src/styles/tokens.css
- Create: src/content/site.ts
- Create: src/content/features.ts
- Create: src/components/brand/BrandMark.tsx
- Create: src/components/brand/Wordmark.tsx
- Create: public/brand/0719-co-outline.svg
- Create: tests/content/site-content.test.ts

## Source assets

- Copy from: /Users/zsoskin/Documents/0719+co outline.svg
- Use only as reference: /Users/zsoskin/Documents/0719+co file.svg
- Use as copy reference: /Users/zsoskin/Downloads/rachandzach-sitemap-copy-ai-coder.pdf
- Use as visual reference:
  - /Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean/11 Sunset/rachelzach-768.jpg
  - /Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean/10 Dancing/rachelzach-941.jpg
  - /Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean/12 After Party/rachelzach-1164.jpg

## Interfaces

- Produces: SiteConfig
  - names: { primary: "Rachel", secondary: "Zach" }
  - date: "2025-07-19"
  - location: "Santa Barbara, CA"
  - navigation: NavigationItem[]
  - weekend: WeekendEventContent[]
  - voice: { eyebrow, heroTitle, heroBody, galleryIntro, uploadIntro }
- Produces: FeatureFlags
  - playlists: boolean
  - marathon: boolean
  - momentSearch: boolean
  - anniversaryCapsule: boolean
  - memoryNotes: boolean
- Produces CSS tokens:
  - --color-cream, --color-wheat, --color-sand, --color-tan
  - --color-coral, --color-ink, --color-muted, --color-white
  - --font-display, --font-body, --radius-card, --shadow-soft
- Consumes: no upstream code.

## Content rules

- Keep "all of our favorite people."
- Keep "yes, even you" as a small playful accent, not a repeated gimmick.
- Keep "from the coast to the dance floor."
- Keep "one last laugh, hug, and kiss" where it still fits the weekend story.
- Lead with Rachel and Zach, July 19, 2025, and Santa Barbara.
- Do not invent marathon details, playlist names, donation totals, URLs, or vendors.
- Do not copy the old sitemap structure.

## Steps

- [ ] Install the full shared dependency set once so later packets do not collide in package files: tailwindcss 4, @tailwindcss/postcss, @supabase/ssr, @supabase/supabase-js, @tanstack/react-virtual, zod, @node-rs/argon2, @uppy/core, @uppy/react, @uppy/tus, tus-js-client, @zip.js/zip.js, sharp, exifr, @huggingface/transformers, resend, @react-email/components, lucide-react, clsx, tailwind-merge, eslint, eslint-config-next, Vitest, Testing Library, @playwright/test, and @axe-core/playwright.
- [ ] Add npm scripts for typecheck, lint, unit tests, end-to-end tests, gallery import, and embedding import.
- [ ] Copy the outlined canonical SVG into public/brand without editing its paths.
- [ ] Wordmark.tsx renders the typeset site lockup in the display face. The only logo artwork is the canonical outline SVG; do not draw a second SVG wordmark.
- [ ] Define the neutral palette and accessible text combinations. Dusty coral is an accent, not the page background.
- [ ] Use an editorial display face with a production-safe license. Use a highly legible sans serif for controls.
- [ ] Write typed content objects. Set playlists, marathon, anniversaryCapsule, and memoryNotes to false. Set momentSearch to true only in development until packet 07 passes.
- [ ] Add a unit test that fails if an enabled navigation item has no route and fails if a disabled content module renders a placeholder link.
- [ ] Confirm the logo remains legible at 24 px and 96 px.
- [ ] Report status. Do not commit.

## Done-check

Run: npm run typecheck && npm run test -- tests/content/site-content.test.ts

Expected: TypeScript passes. The content test passes. No enabled route contains missing copy or a placeholder URL.

## Report

Report DONE, DONE_WITH_CONCERNS, BLOCKED, or NEEDS_CONTEXT. A font-license concern is DONE_WITH_CONCERNS, not permission to substitute an unlicensed file.
