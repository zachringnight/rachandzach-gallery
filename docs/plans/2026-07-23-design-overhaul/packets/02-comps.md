# Task 02: Three homepage comps

**Wave:** 0 (after 00 and 01)
**Depends on:** 00, 01

Run as three parallel agents, one per variant. Model: Fable. Each agent owns exactly one variant directory and one notes file; no shared files, no edits outside them.

## Files (per variant, `<v>` in {a, b, c})
- Create: `src/app/(guest)/comps/<v>/page.tsx` (plus any variant-local components in that same directory)
- Create: `docs/plans/2026-07-23-design-overhaul/comps/<v>-notes.md`

## Interfaces
- Consumes: tokens and `Reveal` from task 00 (exact names in that packet); `storyPhotos`, `focalObjectPosition` from task 01; existing copy from `src/content/site.ts` (imported, never retyped); images only via the six `/story/*.jpg` paths.
- Produces: a complete, self-contained homepage take at `/comps/<v>`, and a notes file recording: the thesis in two sentences, the signature element, type treatment, what to salvage from this variant if not picked.

## Shared rules
- This is a FULL homepage: hero, the five story chapters, feature portals, footer strip. Real copy, real photos, real focal crops. No lorem, no stock, no new hues, no new deps.
- The page must feel like a love letter produced by a top studio, not a template. The calibration warning: warm-cream + serif + terracotta is the single most common AI-default look. The palette is locked, so distinctiveness must come from type scale and treatment, layout rhythm, art direction, and motion choreography.
- Timestamps as structure are available as a device (the weekend is chronological; real times live in the weekend content), not mandatory for every variant.
- Responsive at 375/768/1280. Reduced motion = everything simply visible. Keyboard focus visible.
- Header: each variant may sketch its own header treatment inline (this is the one place nav experimentation is allowed; the shipped header lands in task 05).

## Variant briefs
- **a, Editorial Album:** magazine art direction. Full-bleed focal-cropped hero with the wordmark and date set as an oversized Fraunces composition (use the variable axes). Chapters alternate full-bleed and inset with generous cream margins; timestamp markers as the structural device; quiet staggered reveals.
- **b, Gallery House:** museum hang. Photography in precise frames on a calm cream field, immaculate small type, captions like wall labels, a sticky chapter index rail tracking scroll position, ink-on-cream duotone section breaks. Near-zero motion; the discipline IS the statement.
- **c, Keepsake Cinema:** cinema. Slow Ken Burns hero (CSS transform loop), scroll-triggered chapter crossfades, film-title typography for chapter cards, end-credits-style closing. TV-mode DNA brought to the homepage. Must still be fully reduced-motion safe.

## Steps
- [ ] Read the manifest brief, task 00 and 01 outputs, `src/content/site.ts`, and the six story images (Read renders them; design to the actual photographs).
- [ ] Build the page. Critique against the brief twice during the build: "would a template produce this?" If yes for any section, push that section further.
- [ ] Write the notes file.

## Done-check
Run: `npm run typecheck && npm run lint`
Expected: pass, 0 errors. (Orchestrator runs the production build and screenshots all three variants after the wave lands; agents do not touch the running server.)

## Report
DONE with the variant letter, or BLOCKED naming the missing dependency.
