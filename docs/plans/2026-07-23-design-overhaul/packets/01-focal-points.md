# Task 01: Story-photo focal points

**Wave:** 0
**Depends on:** none

## Files
- Modify: `src/content/story-photos.ts`
- Modify: `tests/content/` (the existing story-photo provenance test file gains focal assertions)

## Interfaces
- Produces: on every story photo object, `focal: { x: number; y: number }` (each 0..1, fraction of image width/height where the visual anchor sits), and an exported helper:
  `focalObjectPosition(photo: { focal: { x: number; y: number } }): string` returning e.g. `"50% 32%"` for `{x: 0.5, y: 0.32}`.

## Steps
- [ ] Read each of the six images in `public/story/` with the Read tool (they render visually). For each, choose the focal point ON THE FACES (or the emotional anchor if no faces). The hero (`hero-sunset-a6fa78bb.jpg`) is the one currently cropping the couple's heads off in a wide-viewport `object-cover`: its focal must sit on their faces in the upper portion of the frame.
- [ ] Add `focal` to the `StoryPhoto` type and every entry, with a one-line comment per photo naming what the point anchors ("Rachel and Zach's faces", "the toast").
- [ ] Implement and export `focalObjectPosition` next to the data.
- [ ] Extend the existing story-photo test: every photo has focal x and y within [0, 1]; `focalObjectPosition({focal:{x:0.5,y:0.32}})` returns `"50% 32%"`.

## Done-check
Run: `npx vitest run tests/content && npm run typecheck`
Expected: all pass.

## Report
DONE, or NEEDS_CONTEXT if any image cannot be read visually.
