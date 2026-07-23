# Wave 2 review: public site (packet 05)

Static, adversarial review of the packet 05 public surface: layout, home, weekend
story, branded 404, site components, redirects, robots, sitemap, story-photos
content, the public-routes test, and the redirects() merge in next.config.ts. No
commands beyond read-only file and image inspection. Wave 3 edit paths (guest,
gallery, uploads) were not touched.

Overall this packet is in good shape. Privacy discipline is genuinely solid, the
token/font wiring resolves, motion respects reduced-motion, and the redirect data
is correct. Two real defects and a cluster of copy-accuracy items follow.

## Findings, most severe first

### 1. MEDIUM — Branded 404 never serves for unmatched URLs (wrong segment)

`src/app/(public)/not-found.tsx:1` (whole file). Next.js only renders a
`not-found.tsx` from the ROOT app segment (`src/app/not-found.tsx`) for globally
unmatched URLs. This file lives inside the `(public)` route group, which is a
`notFound()` boundary for pages in that subtree only. No public page ever calls
`notFound()`, and there is no root `src/app/not-found.tsx` (confirmed absent), so
the component is effectively dead.

Failure scenario: a guest hits `/anything-wrong`. Instead of the Funk Zone page
inside the site shell, they get Next.js's built-in bare 404 rendered in the root
layout (no header, no footer, no branded copy). The file's own comment (lines
5-11) already flags this for Integrate/packet 12, so it is a known but currently
unresolved gap, not an oversight.

Compounding it: the test at `tests/content/public-routes.test.tsx:188` imports
`NotFound` and renders it directly, so it passes regardless of routing. Green
tests give false confidence that the 404 works in production.

Minimal fix: add `src/app/not-found.tsx` that re-exports this component
(`export { default } from "./(public)/not-found";`), or move the file to the root
segment. Until then, no arbitrary bad URL shows the branded page.

### 2. MEDIUM — Footer body text fails WCAG AA contrast (muted on sand)

`src/components/site/SiteFooter.tsx:15` sets `bg-sand` on the footer, and lines
25, 28, and 34 render `text-muted` on it: the date line
("July 19, 2025 · Santa Barbara, CA"), the italic "Made with love..." line, and
the "Admin" link. Measured contrast of `--rz-muted` (#6B645A) on `--rz-sand`
(#E8DBC2) is 4.27:1. WCAG AA for normal-size text (these are text-sm ~14px and
text-xs ~12px) requires 4.5:1, so all three fail.

The tokens file only guarantees muted at 5.1:1 on cream (#F6F0E4); that guarantee
does not carry to the sand surface, and this is the one place muted sits on sand.
Everywhere else muted is on cream (5.1:1) or white (5.8:1) and passes. The packet
step explicitly calls for a contrast pass, so this should not ship.

Failure scenario: a low-vision guest cannot reliably read the wedding date or find
the admin link in the footer at AA.

Minimal fix: use `text-ink` for the footer date and tagline (13.4:1 on sand), or
introduce a dedicated darker "muted-on-sand" token that clears 4.5:1. The Admin
link should likewise move off `text-muted`.

### 3. LOW/MEDIUM — Contradictory ZIP codes on the same block of Anacapa Street

`src/content/site.ts:110` gives the after party (Studio Sound Room) address as
"28 Anacapa St, Unit C, Santa Barbara, CA 93109", while line 121 gives Municipal
Winemakers as "22 Anacapa Street, Santa Barbara, CA 93101". 22 and 28 Anacapa are
a few doors apart and must share a ZIP; 93109 and 93101 cannot both be right, and
Anacapa Street downtown / Funk Zone is 93101, so the after-party 93109 looks
wrong. This copy is rendered publicly by `WeekendTimeline` on `/weekend`.

Failure scenario: a guest maps 28 Anacapa St + 93109 and is sent to the wrong side
of town. This is exactly the "do not invent missing facts" risk the packet calls
out. Minimal fix: confirm the after-party ZIP against the original site and
correct it (likely 93101). (site.ts is packet 01's content file; flagging for the
content owner, not editing here.)

### 4. LOW — Redirect hash fragments depend on Next.js Location handling

`src/lib/redirects.ts:24-25` maps `/faq-1 -> /weekend#faq` and
`/travel -> /weekend#travel`. The target anchors do exist on the page
(`#faq` at weekend/page.tsx:123, `#travel` at :92, both with scroll-mt-24), and
the data shape is correct, so this is mostly right. The residual risk: a hash in a
next.config `redirects()` destination is only honored if Next emits it in the
`Location` header. Because the legacy requests carry no fragment of their own, a
browser cannot recover a dropped fragment (RFC 7231 §7.1.2), so if the fragment is
stripped the guest lands on `/weekend` top, not the FAQ/travel section.

Minimal action: verify at build/runtime that `/faq-1` responds with
`Location: /weekend#faq` (not `/weekend`). If Next strips it on this version, move
the anchor jump to a client effect or a rewrite target. Flagging as verify, not a
confirmed break.

### 5. LOW — Ungrammatical FAQ question

`src/app/(public)/weekend/page.tsx:138`: the `<dt>` reads
"What was Santa Barbara cocktail?" The answer is about attire, so a word is
missing (intended something like "What was the Santa Barbara cocktail dress
code?"). User-facing and reads as broken copy. Minimal fix: restore the missing
words.

### 6. LOW — "Harbour View Inn" spelling

`src/app/(public)/weekend/page.tsx:108` names "Harbour View Inn". Santa Barbara's
hotel is "Harbor View Inn" (American spelling). Verify against the original copy
and correct if it is a transcription slip.

## Clean areas (verified, no action)

- Privacy leakage: none found. `sourcePath`, `imageDataHash`, and `approval` in
  `story-photos.ts` are never rendered; components read only `src`/`alt`/
  `width`/`height`. Every consumer (page.tsx, weekend/page.tsx, Hero, StoryChapter,
  PhotoMarquee) is a Server Component, and no `use client` file imports
  `story-photos`, so the read-only master path
  ("Rachel & Zach - Wedding Master Clean" / "11 Sunset/...") never reaches the
  client bundle or the RSC payload. No guest names in copy or alt; only the couple
  and public business names. Sitemap, robots, and image URLs carry no master paths.
- Dev-placeholder discipline: all 6 picks (hero + 5 chapters) record `sourcePath`,
  8-char `imageDataHash`, and `approval = STORY_PHOTO_APPROVAL`; the module header
  states they are stand-ins pending Zach's review. The provenance test enforces it.
- Image derivatives: declared dimensions match actual pixels for all six
  (hero 2000x1500, coast/ceremony 1600x1200, dinner 1600x1067, dancing &
  after-party 1067x1600), so no aspect/CLS mismatch. Sizes 48-286 KB, all
  reasonable for a hero, none multi-MB.
- Font wiring: `layout.tsx:24` attaches `--font-display-face`/`--font-body-face`
  to `<html>`; tokens.css resolves `--rz-font-display`/`--rz-font-body` through
  them with fallbacks, and @theme maps `font-display`/`font-body`. Chain resolves.
- Tokens vs hex: no raw hex in any site component; all colors go through tokens
  (ink, cream, sand, wheat, coral, muted, white, radius-card, shadow-soft).
- Em dashes: none in content or site components (nor en dashes). Clean.
- Reduced motion: PublicShell scopes both allowed motions (rz-reveal, rz-drift)
  and disables both under `prefers-reduced-motion: reduce`.
- Landmarks / a11y structure: skip link to `#main`, single `<main>`, labeled
  `<header>`/`<footer>` nav, exactly one h1 per page, no skipped heading levels on
  home or weekend, focus-visible outlines on every link/button, min-h-12 targets.
- Marquee: correctly decorative (`data-marquee aria-hidden="true"`, empty alt on
  every image), and the alt-discipline test covers it.
- Disabled feature portals and flagged nav items render nothing (FeaturePortal
  returns null; SiteHeader filters), verified by tests; playlists/marathon absent
  from public HTML.
- Redirect correctness: 5 legacy routes present, all permanent (308), anchors
  exist. `redirects()` in next.config runs before the proxy, so `/gallery` -> (308)
  `/photos` -> proxy default-deny -> `/enter?next=/photos`, matching the packet;
  `/overview`, `/schedule-1`, `/faq-1`, `/travel` all land on public routes. No
  redirect loop with the proxy allowlist (`/enter` is public).
- robots/sitemap: protected routes (/photos, /my-weekend, /add-yours, /admin,
  /api) disallowed and absent from the sitemap, which lists only `/` and
  `/weekend`. SITE_ORIGIN is the couple's own public domain, appropriate for
  crawler absolute URLs.

## Test-coverage note (not a defect)

`tests/content/public-routes.test.tsx:150` asserts the rendered HTML omits
"gallery-assets", "/api/", and /supabase/i, which is good defense in depth. It
does not assert absence of the master path fragments (e.g. "Wedding Master",
"Sunset/"). Adding that assertion would lock in the privacy property against a
future refactor that accidentally renders `sourcePath`. Optional hardening.
