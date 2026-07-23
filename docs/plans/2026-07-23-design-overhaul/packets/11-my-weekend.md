# Task 11: My Weekend v2

**Wave:** 2
**Depends on:** 07

## Files
- Modify: `src/components/personalization/` (MyWeekendSetup.tsx, MyWeekendGallery.tsx, MyWeekendClient.tsx, DownloadMyWeekendButton.tsx as needed)

## Interfaces
- Consumes: frame (07), card language (08 if landed; otherwise current cards).
- Produces: the personalized page in the picked direction.

## Steps
- [ ] The picker is the emotional unlock ("tell us who you are"). Elevate it: the person list deserves better than text pills. If a cheap, private face-thumbnail per person exists in the data (check `src/lib/gallery` facets for any avatar/preview field), use it; if not, design a beautiful typographic treatment and note the avatar idea as a concern for round two. DO NOT build a new data pipeline.
- [ ] Count rule holds everywhere: a person's photo count appears only after they are picked (the results header "N photos of your weekend" is the right home for it).
- [ ] Results: grouped-by-event flow with the timestamp device, slideshow and Download-my-weekend actions promoted as the hero actions.
- [ ] All strings pinned (Fable pass); privacy line ("stays on this device") keeps its prominence.

## Done-check
Run: `npx vitest run tests/personalization && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS.
