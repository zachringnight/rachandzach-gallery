# Comp B notes: Gallery House

Route: `/comps/b` (guest-gated, temporary, deleted by task 17). Files: `src/app/(guest)/comps/b/page.tsx`, `src/app/(guest)/comps/b/ChapterIndex.tsx`.

## Thesis

The homepage is Rachel and Zach's own gallery: five framed plates hung on a calm cream wall, with the couple as both subject and curator. Nothing moves except the visitor, and that restraint is what says "we took this seriously" louder than any animation could.

## Signature element

The ink-on-cream duotone frontispieces. Each day opens with a letterboxed slice of a plate reprinted in only the page's two colors (CSS blend: grayscale image screened over an ink ground, cream multiplied on top, zero new hues), with a small engraved-style plaque naming the day. The same device closes the page: the sunset hero, seen in full color at the entrance, returns as a duotone end wall. Color on arrival, memory on the way out.

Second device worth naming: the sticky chapter rail. Desktop shows a vertical hang list on a hairline with a coral tick tracking the current room (IntersectionObserver over a reading-line band); mobile collapses to a slim sticky strip of roman numerals whose room titles stay in the accessible name.

## Type treatment

- Fraunces with `opsz` 144 and both personality axes zeroed (`SOFT` 0, `WONK` 0): high-contrast, precise, museum didactic rather than bakery-charming. Hero names at `--text-hero`, weight 400, leading 0.95.
- One indulgent glyph: the ampersand between the names gets `SOFT` 100, weight 340, and coral. It is the only soft thing on the title wall.
- Everything else is immaculate small type: Inter at 11px, uppercase, 0.18em tracking for kickers, plaques, nav, and the facts checklist; 13 to 14px for label body copy. Wall labels run numeral, title, date line, text, in true museum order.
- The exhibition facts panel (Date, Place, Photography) is set as a ruled `dl` checklist, which gives the title wall an institutional spine without a single decorative element.

## Layout notes

- Plates are framed prints: hairline ink frame, white mat, hairline around the print, square corners (deliberate break from the site's default rounded card). Labels sit to the right with bases aligned to the frame.
- Plate shapes are disciplined, not uniform: landscape 3:2, portraits 3:4 at five columns, and the ceremony gets a full-width 21:9 panorama that leans into that photo's huge sky with the guest line held by its focal point.
- Motion is two things only: plates fade up in place (Reveal with y=0, lights coming on over an artwork) and the rail tick changes opacity. Reduced motion loses both cleanly.

## Salvage if not picked

- The duotone technique (`.compb-duotone`): three declarations, palette-pure, instantly reusable as section breaks on Weekend or as TV-mode interstitials.
- The scroll-tracking rail (`ChapterIndex` plus `.compb-rail` styles): drops straight into the Weekend timeline or the gallery event scrubber (task 20) as prior art.
- The frame-and-mat treatment for any "collection highlight" moment site-wide.
- The facts checklist `dl` pattern for the enter page or footer.
- The Fraunces axis recipe (opsz 144, SOFT 0, WONK 0, plus one softened accent glyph) as the house display style.
