# Comp A: Editorial Album

Route: `/comps/a` (guest gate). Source: `src/app/(guest)/comps/a/page.tsx`, self-contained, deleted by task 17.

## Thesis

The homepage is the opening signature of a hardbound annual printed for one weekend: cover plate, large-serif standfirst, five timestamped chapters, contents page, colophon. Print discipline (hairline rules, square corners, no cards, no shadows) is what separates it from the warm-cream-plus-serif template look the palette invites.

## Signature element

The timestamp spine. Every chapter opens with a hairline running head (`No. 01` through `No. 05` plus the locked kicker), and the chapters with real clock times in `siteConfig.weekend` carry them as oversized light-weight Fraunces numerals: 6:00 PM overlapping the welcome-party plate, 4:30 PM set into the ceremony photo's empty sky (the photo is nearly all pale sky, so ink type lives inside the photograph at full contrast), 10:30 PM leading the after party. Chapters without a real time get no invented numeral. Secondary signature: the page turns to ink at dusk. Chapters 04 and 05 (dusk and flash photographs) sit on a full-bleed ink field before the paper returns to cream.

## Type treatment

All Fraunces variable axes, no new faces:

- Cover names: `opsz 144`, weight 480, 0.9 leading, clamp(3.5rem, 12vw, 9rem); the ampersand is coral italic with `SOFT 100, WONK 1` (sr-only "and" preserved).
- Timestamp numerals: weight 330 at `opsz 144`, clamp up to 10.5rem; hairline numerals, not bold poster type.
- Standfirst: the approved `heroBody` set in Fraunces at clamp(1.375rem, 2.4vw, 1.875rem), `SOFT 30`, indented right of an oversized locked heading.
- Night words: "Saturday night" in wheat italic `SOFT 100, WONK 1` at display size, decorative (running head carries the same words for AT).
- Labels/nav/body UI: Inter, 11px caps tracked 0.25em to 0.28em.

## Copy discipline

Zero new guest-facing strings. Chapter kickers/titles/bodies mirrored verbatim from the approved `src/app/page.tsx` (comps cannot import it); contents-page bodies reuse the approved intros from the weekend, photos (`galleryIntro`), My Weekend, and Add Yours (`uploadIntro`) surfaces; titles come from `siteConfig.navigation` labels. Clock times and the cover date are facts from `siteConfig`.

## What to salvage if not picked

- The running-head system (folio number + hairline + locked kicker) works over any direction, including the gallery frame (task 07) as event headers.
- Ink type set inside the ceremony photo's sky: the single strongest image treatment here; reusable in any hero or the weekend page.
- The contents-page portal pattern (annotated index rows with approved destination intros) as the FeaturePortal replacement in task 03; it reads editorial instead of card-grid SaaS.
- The day-to-night ink section for TV mode chrome (task 14) and the lightbox, where the same cream-on-ink hierarchy applies.
- The colophon footer (thick-thin rule, names, credit) nearly ships as-is for task 05.

## Viewing notes for the gate

- The shared `SiteHeader` from the guest layout renders above the comp's own masthead sketch (comps cannot replace the layout), so the top of the page shows both; judge the masthead below the shared header.
- Reduced motion: all reveals render visible immediately (Reveal primitive); the only other motion is a motion-safe arrow nudge on hover.
- Checked at 375 / 768 / 1280: single column stacks in chapter order (marker, plate, text); no horizontal scroll.
