# Task 13: Add Yours v2

**Wave:** 2
**Depends on:** 05

## Files
- Modify: `src/app/(guest)/add-yours/` (page), `src/components/uploads/` (UploadDropzone.tsx and queue/receipt components)

## Interfaces
- Consumes: tokens (00), header (05).
- Produces: the upload page in the picked direction. Upload logic (Uppy/TUS, batch submit, receipt states) untouched.

## Steps
- [ ] Header pattern: the page currently lacks the kicker treatment other pages have; align it (copy stays: "The photographer could not be everywhere. Your phone was." is the approved header).
- [ ] Dropzone: the dashed default box becomes a designed invitation (palette texture, motion on drag-over, clear file-spec line which is pinned copy).
- [ ] Queue/receipt states: progress, per-file errors, and the receipt ("Thank you! Your photos are in.") styled with the same care; error strings pinned.
- [ ] Tab title: this page's `metadata.title` is missing the site suffix pattern; fix to match the others.

## Done-check
Run: `npx vitest run tests/uploads && npm run typecheck && npm run lint`
Expected: all pass.

## Report
DONE, or DONE_WITH_CONCERNS.
