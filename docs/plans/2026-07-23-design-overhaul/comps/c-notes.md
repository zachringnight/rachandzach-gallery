# Comp C: Keepsake Cinema

Route: `/comps/c` (guest gate). Files: `src/app/(guest)/comps/c/page.tsx`, `src/app/(guest)/comps/c/ReelProgress.tsx`.

## Thesis

The wedding is a film the family gets to rewatch, so the homepage is a screening: opening titles, five scenes, an intermission, end credits. Scroll is the projector; every cut lands on a real photograph held full frame.

## Signature element

The reel. Hero plus five scenes are sibling sticky frames in one tall container; each frame pins at the top of the viewport while the next slides over it, and the incoming photograph rides a pure-opacity Reveal so the cut reads as a scroll-driven dissolve into the pinned frame beneath. A decorative reel counter (ReelProgress, scroll math, aria-hidden) tracks Scene 01 to 05 down the right edge. Supporting moves: slow Ken Burns on the hero with transform-origin set to the photo's focal point, so the drift zooms toward Rachel and Zach's faces; end credits that literally roll the four real venues and the photographer on a paused-on-hover loop.

## Type treatment

Fraunces variable axes carry the film language on the locked palette. Opening title: text-hero size, opsz 144, SOFT 40, WONK 0, line-height 0.9, names stacked on two lines with a coral ampersand. Scene titles: text-display, opsz 96, SOFT 100, WONK 1, so the chapter cards get the warm, slightly wonky title-card personality without ever leaving Fraunces. Credits venues: text-title, opsz 72. All meta lines are Inter, uppercase, tracked 0.25em, with a coral scene number and a hairline rule as the slate.

## Motion and safety notes

- Reduced motion: Ken Burns, scroll cue, credits roll, tick and card transitions all collapse via one media query; Reveal collapses on its own. Sticky frames remain plain scroll positioning (position, not animation), same judgment as sticky headers.
- No JS: the html.js gate keeps every Reveal visible, the counter renders dim, the roll shows its first copy statically. Nothing is unreachable.
- The credits roll is decorative motion around real facts; links never ride the moving track (static photographer credit below it) and the loop duplicate is aria-hidden. Same WCAG posture as PhotoMarquee, plus hover and focus pause.
- Scene copy, portal copy, hero actions, and the footer love line are the approved strings verbatim; sources are commented in the page.

## Salvage if not picked

- The sticky-cover dissolve recipe (sibling sticky frames plus pure-opacity Reveal) as a lightweight full-bleed chapter treatment for the weekend page or TV mode chrome.
- Focal-point transform-origin Ken Burns: one line of inline style that makes any slow zoom drift toward the faces; TV mode should steal this outright.
- The slate row (coral scene number, hairline rule, tracked kicker) as a general section-label device.
- The end-credits venue roll for the weekend page footer or TV mode idle screen.
- Scene-title Fraunces setting (SOFT 100, WONK 1) anywhere the site wants warmth with personality at display sizes.

## Build health

`npm run typecheck` passes. `npx eslint "src/app/(guest)/comps/c/"` is clean. Repo-wide `npm run lint` exits 1 from pre-existing errors confined to `ds-bundle/_ds_bundle.js` and `ds-bundle/_vendor/react.js`, generated artifacts outside this packet's file list; eslint.config.mjs does not ignore that directory and this packet may not edit it.
