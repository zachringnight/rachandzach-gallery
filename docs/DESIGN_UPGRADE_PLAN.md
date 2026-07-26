# Design upgrade plan — 0719 + co.

Date: 2026-07-26. Audit performed against live production (`https://rachandzach.com`),
signed in as a guest, desktop 1440x1000 and mobile 390x844.

This plan is the brief for the next visual pass. It does not change product scope,
data, auth, or the palette. It changes hierarchy, typography, layout, motion, and
art direction.

## Locked constraints (do not re-litigate)

- Palette stays cream / sand / wheat / ink / coral. Distinctiveness comes from
  type, layout, motion, and art direction, not new colors.
- Never surface comparative per-person photo counts at rest.
- No weekend-recap or event-summary sections. The product is a private archive.
- Rachel approves visual direction from rendered comps, not descriptions.
- All existing functionality (1,721 photos, Find me, favorites, signed originals,
  Drive/Dropbox, uploads, moderation) survives every change here.

---

## 1. Diagnosis

Ten findings, each observed in a screenshot.

**1.1 The chrome outranks the photographs.**
On `/photos` the first photograph appears roughly 1,350px down on desktop and
1,030px down on mobile, on an 844px-tall phone. Ahead of it: a ghost word marquee
("Search · Select · Save"), an eyebrow, a two-line display headline, a right-column
subhead, two hairline rules, a count row, a search field, and a collapsed "Search
the moments" accordion. Eight pieces of chrome before one photo, on a page whose
only job is photos.

**1.2 Every page runs the same template.**
Ghost marquee, eyebrow, huge headline, right-column subhead, rule, second huge
headline, second subhead. `/favorites` says "Favorites" and then "Keep the frames
you love close." `/my-weekend` says "Your photos" and then "Your photos, in one
place." Two headline blocks per page saying the same thing. The pages are not
designed; the template is.

**1.3 The lightbox under-shows the photo.**
At 1440x900 the image renders about 670px wide, roughly a third of the viewport
width, boxed by about 250px of fixed header and footer chrome. Every photo is
titled "A photograph from the archive" — a generic string set as the loudest text
in the frame. The single most important surface in a photo archive is the one
where the photo is smallest.

**1.4 Empty space is void, not composition.**
Home's "What comes next", `/my-weekend`, and `/favorites` each carry half-page
empty quadrants: a 12-column grid filled asymmetrically with nothing on the other
side and no tension holding it.

**1.5 The grid has no wayfinding and no de-duplication.**
1,721 photos scroll as one undifferentiated justified run: 14,618px on desktop,
42,220px on mobile. Near-identical frames from the same burst sit adjacent — four
consecutive near-duplicate group portraits in the sampled range. There is no sticky
chapter header, no time marker, no sense of where you are.

**1.6 Find me is a chip cloud.**
About 40 plain text chips, no faces, under two stacked headline blocks. This is the
number-one guest job and the least designed surface on the site. The repo already
ships face detection and recognition models.

**1.7 Mobile is one photo per row.**
The lowest possible browsing density on the device most guests will use.

**1.8 The type system is one voice.**
Manrope for everything from hero to eyebrow, Inter for body. No third voice for
counts, times, frame numbers, or metadata. The decorative wordmark appears in the
header and never returns, so it reads as a leftover rather than a motif.

**1.9 Numbering is decorative.**
01–05 on nav items, 01–04 on feature lists. Nav is not a sequence and the feature
list is not a process. The numbers encode nothing.

**1.10 The whole thing lands on the current default AI aesthetic.**
Warm cream near #F6F1EA, high-contrast display face, terracotta accent, zero
border radius, hairline rules, numbered markers. That is the most-produced machine
look of the moment. The palette is locked and correct — which means every other
axis has to work harder than it currently does.

---

## 2. The thesis

The subject is not "a wedding website." It is **one photographer's take on one day
in Santa Barbara, handed to a hundred people who each want the twelve pictures
they are in.**

The vernacular of that world is contact sheets, frame numbers, film edges, the
roll, and light changing across a single day. That is where the distinctiveness
comes from, and none of it needs a new color.

Two signature moves, one supporting system.

### Signature A — The Light Bar

A persistent thin rail pinned to the grid (vertical on desktop, horizontal above
the grid on mobile) that maps the entire archive onto the arc of the day. Each
segment is tinted with the dominant light sampled from the photographs in that
window: cool morning getting-ready, bright ceremony, warm golden hour, dark
reception. Scrub it and the grid jumps.

It is a progress indicator, a chapter navigator, and a piece of art direction
generated from the photographs themselves — a single element doing three jobs, in
the one currency (time) every guest already understands. `EventScrubber` already
exists as a plain event rail; this is the upgrade of that idea, not a new system.

Everything else on the page can then be quiet.

### Signature B — The contact sheet

Collapse burst duplicates into one frame with a stacked-edge affordance and a
count. Click to fan the burst out inline. This kills the four-identical-portraits
problem, cuts scroll length substantially, and speaks the subject's own language.

### Supporting — a third typographic voice

Add a technical/mono face for frame numbers, times, counts, metadata, and the
Light Bar. Display face, body face, archive face. Three roles, clearly separated.
Replace Manrope with a display face that has a point of view; Manrope and Inter is
the safest pairing available and reads as a default.

---

## 3. Packets

Ordered. Each is independently shippable and independently reviewable.

### P0 — Comps before code

Build three rendered full-page comps of `/photos` at desktop and 390px mobile:
one conservative (P1+P2 only), one with the Light Bar, one with Light Bar plus
contact sheet. Rachel and Zach pick from the renders. **No production code until a
comp is picked.** This is the standing rule for visual direction on this project.

Deliverable: six images plus a one-screen rationale per comp.

### P1 — Photos above the fold

Kill the ghost word marquee site-wide. Collapse each page's two headline blocks
into one page header: a single line, the live count, and the controls. Move search
and filters into a compact sticky control bar that docks to the top of the grid on
scroll.

Acceptance:
- First photograph visible without scrolling on 1440x1000 and on 390x844.
- Every page has exactly one headline.
- Search and filters remain reachable at any scroll depth.
- Control bar collapses to a single row on mobile.

### P2 — The lightbox becomes the photograph

Full-bleed image sized to the viewport with a fixed minimum margin. Chrome fades
out after two seconds of inactivity and returns on pointer move or key press.
Replace "A photograph from the archive" with real caption data — event, time, and
people when known — set small in the archive face, not as a headline. Add a
filmstrip of neighbors along one edge. Keep every existing action (favorite,
download, share, memories, keyboard shortcuts).

Acceptance:
- Image occupies at least 80% of the shorter viewport axis at 1440x900 and on
  mobile.
- No photo displays a generic placeholder title.
- Keyboard shortcuts and focus order unchanged; Escape still closes.
- Reduced motion disables the chrome fade.

### P3 — The Light Bar

Sample dominant light per photo at build or import time into a cached column.
Render the rail from real event boundaries plus that light data. Scrub to jump;
the active segment tracks scroll position. Sticky chapter label at the grid's top
edge showing where you are.

Acceptance:
- Rail derives from real data, no hand-authored gradient.
- Keyboard operable with a labeled native control mirroring the rail, matching
  the existing `EventScrubber` accessibility pattern.
- Scroll position and rail stay in sync in both directions.
- Works with filters applied and with the virtualized grid.

### P4 — Contact sheet grouping

Cluster near-duplicate frames (capture time proximity plus perceptual hash) into
one card with a stacked edge and a count. Expand inline. Preserve favorites and
selection semantics for every frame inside a group, expanded or not.

Acceptance:
- Adjacent near-duplicates no longer render as separate top-level cards.
- Total desktop scroll length for the unfiltered archive drops by at least 30%.
- Selecting a group selects its frames; favoriting inside a group persists.
- A guest can always reach every individual frame.

### P5 — Find me, with faces

Replace the chip cloud with a face-thumbnail picker: a cropped face per person,
name beneath, searchable, alphabetical. Keep the existing rule — no comparative
counts at rest; the count appears only after a person is chosen. Give the page one
headline instead of two.

Acceptance:
- No per-person counts visible before selection.
- Falls back to a name chip when no face crop exists.
- Fully keyboard navigable with visible focus.
- Selection still persists on-device only.

### P6 — Mobile density and reach

Two-column grid by default with a one-column toggle. Move the primary actions
(select, filters, search) into a bottom bar within thumb reach. Reduce the header
stack.

Acceptance:
- At least four photographs visible on first paint at 390x844.
- Primary actions sit in the bottom third of the screen.
- Toggle preference persists across navigation.

### P7 — Type system and structure cleanup

Introduce the three-role type system. Replace the display face. Delete decorative
numbering from nav and feature lists; keep numbering only where order carries
meaning. Give the wordmark a second role so it reads as a motif rather than a
one-off.

Acceptance:
- Three faces, each with a documented role, wired through `tokens.css`.
- No 01/02/03 markers on non-sequential content.
- Contrast ratios hold at AA on cream, sand, and wheat surfaces.
- No layout shift regression on font load.

### P8 — Motion pass

One orchestrated page-load sequence rather than scattered reveals. Grid images
resolve with a short blur-up. Lightbox opens from the clicked card's position.
Light Bar responds to scroll with damping. All of it on the two existing easing
curves and three durations already in `tokens.css`.

Acceptance:
- `prefers-reduced-motion` removes transforms and transitions everywhere.
- No animation on the critical path to first photograph.
- Existing `Reveal` primitive is reused, not replaced.

---

## 4. Sequencing

- **Ship first, low risk, high visible gain:** P0 → P1 → P2.
- **The differentiators:** P3 → P4.
- **Then:** P5 → P6 → P7 → P8.

P1 and P2 alone fix the two loudest problems: photos are buried, and the photo
viewer under-shows the photo. If only one thing gets built, build those.

## 5. Verification for every packet

Per `AGENTS.md`:

```bash
npm run typecheck && npm run lint && npm run test && npm run verify:build
npx playwright test tests/e2e --project=chromium
git diff --check
```

Plus, for every packet: inspect desktop and 390px screenshots directly. Snapshot
regeneration is not visual approval. Report pass and skip counts separately.
