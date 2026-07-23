# Copy and voice QA: 0719 digital wedding home

**Reviewer:** copy-qa agent (read-only pass)
**Date:** 2026-07-22
**Scope:** src/content/site.ts, src/content/features.ts, plus a sweep of every user-facing string in src/ (GalleryApp.tsx, LoginScreen.tsx, layout.tsx metadata, brand components) against /Users/zsoskin/Downloads/rachandzach-sitemap-copy-ai-coder.pdf (21 pages, read in full) and packet 01 content rules.

## Verdict

**PASS.** Every date, venue, address, and schedule fact in the landed content traces to the source PDF or the known facts. All four required phrases are present, each used exactly once and well placed. Zero em dashes in any user-facing string. No invented vendors, URLs, playlist names, marathon details, or donation totals. Three minor polish items below, none blocking: one redundant sentence in `galleryIntro`, one weak alt-text fallback in the legacy gallery lightbox, and one sanctioned deviation worth recording so nobody "fixes" it later.

---

## 1. Factual fidelity: clean

Every fact cross-checked against the PDF. Findings per event:

| Content claim (site.ts) | Source | Status |
| --- | --- | --- |
| Rachel & Zach, July 19, 2025, Santa Barbara, CA | PDF sitewide facts + known facts | Traced |
| Welcome Party: Hotel Californian, Fri Jul 18, 6:00-9:00 PM, 36 State St. | PDF p.1, p.6 | Traced |
| Wedding: Rincon Pergola, Sat Jul 19, shuttles 3:30 PM, ceremony 4:30 PM, outdoors, Santa Barbara views, cocktail hour, dinner and dancing until 10:00 PM | PDF p.1, p.7 timeline | Traced |
| After Party: Studio Sound Room, 10:30 PM-12:45 AM, 28 Anacapa St Unit C, 93109, beach bungalow bar, Funk Zone, sound ordinances at 10 PM, "more BPM and less personal space than the reception" | PDF p.1, p.8, FAQ p.12, note p.8 | Traced |
| Sunday Hang: Municipal Winemakers, Sun Jul 20, 9:00-11:00 AM, 22 Anacapa Street, 93101, breakfast burritos, acai bowls, coffee, wine, "one of our favorite wine spots" | PDF p.1, p.9, FAQ p.12 | Traced |
| Welcome party "by the water", "hungry and thirsty", "formal sit-down dinner" | PDF p.3 snapshot, p.7 copy, FAQ p.13 | Traced |

**Nothing invented.** No URLs, vendors, playlist names, marathon details, or donation totals appear anywhere in site.ts or features.ts. Nav hrefs are internal routes only, as packet 01 requires.

Two notes, neither a defect:

- **Narrative extrapolation, accepted.** `"Shuttles rolled out at 3:30 PM, and everyone rode them."` The PDF states a requirement ("Everyone is required to ride the shuttles"); the site states it as a thing that happened. That is the correct retrospective conversion for a post-wedding archive and traces to the requirement plus the 3:30 PM timeline fact. Keep.
- **Sanctioned deviation, record it.** PDF content behavior says to preserve the homepage headline exactly as `rach + zach`. The landed `heroTitle` is `"Rachel & Zach"`. This follows packet 01, which pins `names: { primary: "Rachel", secondary: "Zach" }`, requires the hero to lead with Rachel and Zach, and says not to copy the old sitemap. Packet overrides PDF here. Do not revert to `rach + zach`.

Time-label hedges: PDF `"10:30 PM-12:45 AM or so"` became `"10:30 PM-12:45 AM, give or take"`. Same fact, same wink, fine.

## 2. Required phrases: all present, each exactly once

| Phrase | Location | Count in src/ | Assessment |
| --- | --- | --- | --- |
| "all of our favorite people" | site.ts:130, heroBody | 1 | Well placed; upgrades the PDF subhead's "our favorite people" using the PDF's own schedule-intro wording |
| "from the coast to the dance floor" | site.ts:132, galleryIntro | 1 | Present, but the sentence around it doubles back on itself (see voice note below) |
| "one last laugh, hug, and kiss" | site.ts:123, sunday-hang description | 1 | Exactly where it belongs, in the weekend's closing beat |
| "yes, even you" | site.ts:101, wedding description | 1 | Used as a small playful accent, not a gimmick, per packet rule. Verified only one occurrence across all of src/ |

## 3. Voice: warm, playful, coastal, and concise, with one wobble

Strong throughout. `"nobody treated it like a formal sit-down dinner"`, `"dancing carried us to 10:00 PM"`, and the whole uploadIntro read like the couple, not a template. LoginScreen strings (`"That password did not work."`, `"Sign in to view that photo."`) are plain and human. Nothing template-flavored or stiff found.

**Finding 3a (minor): galleryIntro repeats itself.**

> `"Every photo from the weekend, from the coast to the dance floor: coastal views, happy tears, and plenty of dance floor evidence."`

"Coast" and "coastal" plus "dance floor" twice in one sentence. This happened because two good PDF lines (the photo-teaser phrase and the post-wedding gallery intro) were fused whole. Suggested rewrite, keeping the required phrase and the PDF's best joke:

> `"Every photo from the weekend, from the coast to the dance floor, with happy tears and plenty of evidence in between."`

**Observation (take or leave): hero stacks date and place twice.** The eyebrow reads `"July 19, 2025 · Santa Barbara, CA"` and the heroBody immediately repeats `"in Santa Barbara on July 19, 2025"`. The PDF's own hero had the same shape (eyebrow plus detail line), so this is faithful; if the hero feels crowded in layout review, the heroBody could drop the date and lean on the eyebrow. Not a defect.

## 4. Em dashes: zero

Grepped every `.ts`/`.tsx` under src/, plus tests/ and public/. No em dash appears in any user-facing string, code comment, or test fixture. Time ranges use plain hyphens (`"6:00-9:00 PM"`), the eyebrow uses a middot, and the lightbox arrows are `‹`/`›`. Clean.

## 5. Alt text: no leakage, one weak fallback

- **BrandMark** (src/components/brand/BrandMark.tsx:26): default `alt="0719 + co."` with a documented empty-string decorative escape hatch. Good.
- **No guest-name leakage into alt text anywhere.** Guest names appear only in visible caption chips and the lightbox heading inside the password-gated gallery, never in `alt` attributes. This matches the rule.
- **Finding 5a (minor, legacy surface): filename leaks into alt.** In src/components/GalleryApp.tsx:
  - Grid (line 188): `` alt={`${photo.event} photo ${photo.number || photo.filename}`} `` renders well in the normal case (`"Sunset photo 768"`) but falls back to raw filenames like `rachelzachday1.jpg` when `number` is missing.
  - Lightbox (line 215): `` alt={`${activePhoto.event} ${activePhoto.filename}`} `` always embeds the filename, e.g. `"Sunset rachelzach-768.jpg"`. Filenames are poor alt text, and the couple-name slug inside them would surface on a public page whenever `GALLERY_REQUIRE_PASSWORD` is not `"1"` (src/app/page.tsx:17-19 renders the gallery publicly in that case).
  - Suggested pattern for both: `` `${photo.event} photo ${photo.number}` `` with a numberless fallback of `` `${photo.event} photo` ``, never the filename. No keyword stuffing observed anywhere.
  - Advisory only: GalleryApp.tsx is a wave 2 edit target and may already be mid-replacement. If the new gallery components ship their own alt pattern, apply this rule there instead.

## 6. features.ts: compliant, no user-facing strings

Flags match packet 01 exactly: `playlists`, `marathon`, `anniversaryCapsule`, `memoryNotes` hard false; `momentSearch` true only in development. Disabled nav items carry their owning flag and the NavigationItem contract forbids placeholder links. No copy to QA here.

---

## Summary of requested changes

1. **(Minor)** Rewrite `galleryIntro` (src/content/site.ts:132) to remove the coast/dance-floor double-up. Suggested text in finding 3a.
2. **(Minor, legacy)** Drop filename fallbacks from gallery alt text (src/components/GalleryApp.tsx:188 and 215), or carry the fix into the wave 2 replacement components. Suggested pattern in finding 5a.
3. **(Record only)** `heroTitle: "Rachel & Zach"` is a deliberate packet-01 override of the PDF's `rach + zach` preservation rule. Note it so a future pass does not "correct" it.

No blocking issues. Content foundation is ready for the pages built on top of it.
