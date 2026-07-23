# Task 05: Public site and weekend story

**Wave:** 2
**Depends on:** 01

## Objective

Build the new post-wedding home around the actual weekend and 0719 + co. identity. It should feel editorial, affectionate, and specific to Rachel and Zach, not like a wedding template.

## Files

- Modify: src/app/layout.tsx
- Replace: src/app/page.tsx
- Create: src/app/(public)/weekend/page.tsx
- Create: src/app/(public)/not-found.tsx
- Create: src/components/site/SiteHeader.tsx
- Create: src/components/site/SiteFooter.tsx
- Create: src/components/site/Hero.tsx
- Create: src/components/site/WeekendTimeline.tsx
- Create: src/components/site/StoryChapter.tsx
- Create: src/components/site/PhotoMarquee.tsx
- Create: src/components/site/FeaturePortal.tsx
- Create: src/app/robots.ts
- Create: src/app/sitemap.ts
- Create: tests/content/public-routes.test.tsx

## Interfaces

- Consumes: SiteConfig, FeatureFlags, BrandMark, Wordmark, and CSS tokens from task 01.
- Produces: PublicShell({ children }: { children: React.ReactNode }) -> JSX.Element.
- Produces: FeaturePortal({ flag, href, title, body }: FeaturePortalProps) -> JSX.Element | null.
- Produces: WeekendTimeline({ events }: { events: WeekendEventContent[] }) -> JSX.Element.
- Produces route contract:
  - / is the post-wedding home.
  - /weekend is the chronological visual story.
  - /overview redirects to /.
  - /schedule-1 redirects to /weekend.
  - /gallery redirects to /photos.
  - /faq-1 and /travel redirect to /weekend with a legacy anchor.

## Page system

- Home hero: 0719 + co. mark, a full-bleed approved wedding image, "From the coast to the dance floor," and two actions: Find your photos and Browse the weekend.
- Home chapters: coast, ceremony, dinner, dancing, and after party.
- Weekend story: chronological photo-led chapters. Use the old schedule facts only when still appropriate as memory context.
- Feature portals: Add Yours, playlists, marathon, and future anniversary capsule. Disabled flags render nothing and stay out of navigation.
- Footer: Rachel and Zach, July 19, 2025, Santa Barbara, photographer credit when confirmed, and a discreet admin link.

## Steps

- [ ] Add a render test for public route titles, legacy redirects, hidden disabled modules, and empty alt text only for decorative images.
- [ ] Select local development hero and chapter images from ceremony, sunset, reception, dancing, and after party. Record each source path in site content.
- [ ] Create web-only derivatives for those public references. Do not move or alter originals.
- [ ] Build a calm responsive shell with a cream canvas, wheat surfaces, charcoal type, and restrained coral accents.
- [ ] Use full-bleed photography and typographic rhythm. Avoid a dashboard, dense card grid, gradients, glass effects, or generic wedding icons.
- [ ] Keep motion limited to subtle image reveals and marquee drift. Disable it under prefers-reduced-motion.
- [ ] Add metadata for Rachel and Zach, July 19, 2025, and Santa Barbara. Do not index protected routes.
- [ ] Render the old site's voice through new copy. Do not invent missing facts.
- [ ] Test keyboard navigation, focus visibility, contrast, and 200 percent zoom.
- [ ] Report status. Hero image publication still requires Zach's end review.

## Done-check

Run: npm run test -- tests/content/public-routes.test.tsx && npm run build

Expected: public pages and redirects build. Disabled content is absent. Protected gallery data is not present in public page HTML or the generated sitemap.

## Report

Report DONE_WITH_CONCERNS if any hero, font, credit, or copy choice needs Zach's final visual approval. Do not block the rest of the build for that normal end-review call.
