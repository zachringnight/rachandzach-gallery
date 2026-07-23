# Fable copy pass: 0719 digital wedding home

**Writer:** fable copywriting agent
**Date:** 2026-07-22
**Scope:** guest-facing strings in src/content/site.ts, src/app/page.tsx, src/app/(public)/**, src/app/(access)/enter/**, src/app/(guest)/add-yours/**, src/components/uploads/**, src/components/site/**, src/app/not-found.tsx
**Verification:** `npx vitest run tests/content` 36/36 green; `npx vitest run tests/modules tests/uploads` 101/101 green; eslint clean on all seven edited files; zero em dashes; every fact traces to the sitemap PDF or already-landed known facts.

## The shape of the pass

16 strings changed out of roughly 70 inventoried. The QA pass was right that the foundation is warm and on-voice, so most of this pass is de-duplication: the wave 2 pages reused the best lines and the required phrases enough times that the jokes were stepping on themselves. The rule applied throughout: every good line gets said once, in the place it works hardest.

## Changed strings

| # | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| 1 | site.ts `heroBody` | We got married by the coast in Santa Barbara on July 19, 2025, surrounded by all of our favorite people in one of our favorite places. | We got married in Santa Barbara, surrounded by all of our favorite people in one of our favorite places. We are still not over it. | The H1 directly above is "From the coast to the dance floor" and the eyebrow directly above is "July 19, 2025 · Santa Barbara, CA", so "by the coast" and the date were saying everything twice within four lines (QA observation 3). The short second sentence gives the hero a landing beat in the couple's own register. Test still passes: the eyebrow carries the date anchor. |
| 2 | site.ts `weekend`, sunday-hang | ...wine at one of our favorite wine spots as we shared one last laugh, hug, and kiss... | ...wine at one of our favorite spots as we shared one last laugh, hug, and kiss... | "wine at one of our favorite wine spots" doubled "wine" in eight words. The venue line above already names Municipal Winemakers. Required phrase untouched. |
| 3 | app/page.tsx, ceremony chapter | Outdoors, with Santa Barbara views in every direction and all of our favorite people in the seats. | Outdoors, with Santa Barbara views in every direction and the people we love most in the seats. | "all of our favorite people" appeared three times sitewide; the binding rule is exactly once. This was a same-page duplicate of the heroBody. "The people we love most" is the PDF's own overview phrasing, so the swap stays in the couple's vocabulary. |
| 4 | app/page.tsx, dance floor chapter | Coastal views, happy tears, and plenty of dance floor evidence. The gallery holds the proof. | Coastal views, happy tears, and plenty of dance floor evidence. It is all in the gallery. | "Evidence" then "proof" was the same joke twice in a row. The PDF line keeps the wit; the second sentence now just points. |
| 5 | app/page.tsx, Playlists portal | The weekend's soundtrack lands here when it is ready. | The weekend's soundtrack, chapter by chapter. | The portal only renders once the flag is on, so "when it is ready" would describe a live feature as unfinished. New body matches the playlists page's own description. |
| 6 | app/page.tsx, Marathon portal | That story arrives here when it is ready. | The story of Rachel's run, and how to support it. | Same flag logic as above. Mirrors the landed marathon page metadata; invents no marathon details. |
| 7 | weekend/page.tsx, intro | Three days by the water with all of our favorite people. Here is how it went, in order. | Three days by the water with everyone we love. Here is how it went, in order. | Third sitewide use of the protected phrase; reduced to one. "Everyone we love" keeps the warmth without cloning the hero. |
| 8 | weekend/page.tsx, Friday chapter | Dinner, drinks, and the weekend finding its feet by the coast. Nobody treated it like a formal sit-down dinner, which was the whole point. | Dinner, drinks, and the weekend finding its feet by the coast, with the best part still a day away. | The timeline three scrolls up already delivers "nobody treated it like a formal sit-down dinner" verbatim; the same joke twice on one page dulls both. The new tail points the story at Saturday. |
| 9 | weekend/page.tsx, after party chapter | The Funk Zone took it from there, until 12:45 AM, give or take. | The Funk Zone took it from there, and nobody was watching the clock. | The timeline above already shows "10:30 PM-12:45 AM, give or take", so the chapter repeated both the timestamp and the hedge. "Nobody was watching the clock" is the same fact told as a feeling, and it lands because the timeline literally watched the clock. |
| 10 | weekend/page.tsx, travel heading | Getting here, remembered | Getting to Santa Barbara | "Remembered" as a suffix read like a museum label next to the plain-spoken "Questions we kept hearing". The body's past tense already does the remembering. |
| 11 | weekend/page.tsx, FAQ question 3 | Did the weather plan get used? | What was the weather plan? | The old question asked for an outcome the answer never gave (and the PDF records no weather outcome, so we cannot invent one). The reframed question is one guests actually asked pre-wedding, which fits "Questions we kept hearing", and now the answer answers it. |
| 12 | weekend/page.tsx, FAQ answer 3 | The ceremony and reception were outdoors rain or shine, with a weather plan in place and fingers crossed it would not be needed. | The ceremony and reception were outdoors rain or shine, with a backup ready and fingers crossed it would not be needed. | "Weather plan ... plan" echoed the new question. Same facts, straight from the PDF. |
| 13 | (public)/not-found.tsx, body | Let's get you back to the weekend details. | Let's get you back to the party. | "Weekend details" was pre-wedding logistics language; post-wedding there are no details to get back to. The Funk Zone H1 stays PDF-exact and carries the joke; the body stays plain and warm, per the one-wink rule. |
| 14 | (access)/enter/page.tsx, intro | This part of the site is just for the people who were part of the weekend. Enter the password from your invite and come on in. | This part of the site is just for the people who shared the weekend with us. Enter the password from your invite and come on in. | "Part of the site ... part of the weekend" stuttered. "Shared the weekend with us" is warmer and cleaner. The closing "come on in" deliberately stays: it hands the guest the exact words on the button below. |
| 15 | (guest)/add-yours/page.tsx, header | Share the moments you caught over the weekend. Full-resolution JPEG, PNG, WebP, and HEIC are all welcome. Everything is reviewed before it appears in the gallery. | The photographer could not be everywhere. Your phone was. Share what you caught over the weekend. | The old header did the dropzone's job (formats, restated inches below) and the review notice's job (restated twice below), and had no room left for a reason to act. Now the header gives the why, the dropzone gives the specs, the notice gives the review promise. One job per line. |
| 16 | components/uploads/UploadDropzone.tsx, specs | JPEG, PNG, WebP, or HEIC. Up to 50 photos, 50 MB each. | Full-resolution JPEG, PNG, WebP, or HEIC. Up to 50 photos, 50 MB each. | Preserves the "send originals, not screenshots" nudge that left the add-yours header, in the specs line where it belongs. |

## Deliberately left alone

- **The four weekend descriptions' best lines** (site.ts): "nobody treated it like a formal sit-down dinner", the whole shuttle-and-"Yes, even you." beat, "more BPM and less personal space than the reception". These are the couple at their best and QA already traced every fact. Untouched except the two de-dupes above.
- **`galleryIntro` and `uploadIntro`**: both already sing ("plenty of evidence in between", "If your camera roll survived the dance floor"). No change survives a comparison with them.
- **`heroTitle` "Rachel & Zach"** and the eyebrow: approved override and pure fact, locked.
- **"From the coast to the dance floor" appears twice** (home H1 in Hero.tsx, `galleryIntro` in site.ts). Both locations are pinned by separate tests (public-routes h1 assertion; site-content phrase assertion), and the two never render on the same page, so both stay. Flagging so nobody counts it as a miss against the once-only rule; site.ts itself carries the phrase exactly once.
- **The sound-ordinance beat three times on /weekend** (timeline states it, dancing chapter winks at it, after party chapter continues it). Read in order it is escalation, not repetition: fact, wink, consequence. Kept.
- **Two "promised" callbacks on /weekend** (ceremony chapter "exactly as promised", FAQ "just like we promised"). Both pay off the PDF's "We promise the views and vibes will be worth it" and sit several screens apart. A running promise kept is on-theme for a wedding site.
- **All error and status microcopy** (enter page errors, upload queue states, skip/size errors, receipt copy): already plain, human, and generic where security policy requires ("that is not the password we sent" reveals nothing). Several are pinned by e2e specs. Errors are where clarity beats charm; no changes.
- **Upload receipt and review notice**: "Thank you! Your photos are in." and "Every photo is reviewed by Rachel and Zach before it appears in the gallery." say exactly what a guest needs at exactly the right moments. The review promise now appears once pre-submit and once post-submit, which is the right amount of over-communication for "why can't I see my photo yet".
- **Footer**: "Made with love for the people we love." is the PDF's own line and the facts are facts.
- **Nav labels, buttons, headings** ("Find your photos", "Browse the weekend", "Keep the weekend going", "Questions we kept hearing", chapter titles): already crisp; several test-pinned.
- **Home Friday chapter "no seating chart, no schedule"**: mild vibe-claim already landed and QA-passed; rewriting it risks more than it gains.

## Constraint audit

- Required phrases: "all of our favorite people" once (heroBody), "from the coast to the dance floor" once in site.ts (plus the test-pinned H1, see above), "one last laugh, hug, and kiss" once (sunday-hang, the weekend's closing beat), "yes, even you" once (wedding description). Grep-verified after edits.
- Em dashes: zero across all edited files (grep-verified).
- No invented facts: every changed line either restates a PDF fact, drops a duplication, or adds only forward-pointing connective tissue ("the best part still a day away" is Saturday's wedding; "nobody was watching the clock" is the PDF's own "or so" hedge told warmly).
- No placeholders; all lengths within roughly plus or minus 40 percent of the originals; error messages remain generic per security policy.

## Component micro-pass

**Writer:** fable copywriting agent
**Date:** 2026-07-22
**Scope:** guest-facing strings (JSX text nodes, string props, aria-labels) in src/components/gallery/**, src/components/favorites/**, src/components/slideshow/**, src/components/personalization/**
**Verification:** `npx vitest run tests/gallery tests/favorites tests/downloads tests/personalization` 157/157 green across 9 files; `npx eslint` on all six edited files, 0 errors (2 pre-existing warnings on untouched lines: an unused import in GalleryShell.tsx and a no-img-element in FavoritesGallery.tsx); zero em dashes; no new uses of any protected phrase (grep-verified). No test assertions needed updating: every pinned string was left intact by design.

10 strings changed out of roughly 65 inventoried. The component layer was written to the same voice rules as the pages, so most of what needed fixing was not tone but truth: one empty state pointed at a control that does not exist where it claims, one fallback renders broken English, one aria-label describes its slider backwards, and the My Weekend intro repeats the page header sitting directly above it.

| # | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| 17 | gallery/GalleryShell.tsx, session error body | Sign in again to keep browsing the gallery. | Enter the password from your invite to keep browsing. | Guests never signed in; they entered a password. "Enter the password from your invite" is the enter page's own phrasing (see #14), so the error speaks the vocabulary of the page its button leads to. |
| 18 | gallery/GalleryShell.tsx, session error button | Go to sign in | Enter the password | Same fix on the control: verb-first, and it names what the guest will actually do at /enter. No test pins either string. |
| 19 | favorites/FavoritesGallery.tsx, load error | Could not load your favorites. Try again in a moment. | We could not load your favorites. Try again in a moment. | The house error pattern is first person plural ("We could not load photos", "We could not load your weekend right now"). This was the only subjectless one. |
| 20 | favorites/FavoritesGallery.tsx, loading | Loading your favorites... | Loading your favorites… | Every other loading line on these surfaces uses a real ellipsis ("Loading photos…", "Gathering your weekend…"). The pinning regex (/loading your favorites/i) does not cover the dots. |
| 21 | favorites/FavoritesGallery.tsx, empty state | You have not favorited any photos yet. Open a photo in the gallery and tap the heart to add it here. | You have not favorited any photos yet. Play a slideshow from My Weekend and tap the heart on the ones you love. | The old next action was false: FavoriteButton renders only in slideshow toolbars and on favorites tiles, so opening a photo in the gallery shows no heart. The one real zero-favorites path is a My Weekend slideshow, and the empty state now points straight at it. First sentence untouched: pinned verbatim by tests/e2e/access.spec.ts, tests/e2e/gallery.spec.ts, and tests/favorites/favorites-gallery.test.tsx. Revisit this line when hearts land in the gallery lightbox. |
| 22 | slideshow/SlideshowControls.tsx, speed slider aria-label | Slideshow speed in seconds | Seconds per photo | "Speed in seconds" reads backwards on a slider where a bigger number is slower. The value is literally how many seconds each photo stays up, so the label now says that. Visible "Speed" label and the "5.0s" readout unchanged. |
| 23 | personalization/MyWeekendSetup.tsx, intro | Pick your name and we will gather every confirmed photo of your weekend in one place, grouped by moment. This choice stays on this device only -- we never send it anywhere. | Pick your name to see your weekend, grouped by event. Your choice stays on this device only. We never send it anywhere. | The page header directly above already says "we will gather every confirmed photo ... that includes you"; the intro repeated it almost verbatim two lines later. "Grouped by event" replaces "grouped by moment" because the groups are the weekend's events, and "moment" belongs to Moment Search, which sits on this same page. "Confirmed" is moderation vocabulary. The "--" splice is gone. "See your weekend" hands the guest the button below ("Show my weekend"), the enter-page pattern from #14. |
| 24 | personalization/MyWeekendSetup.tsx, no-people state | My Weekend needs at least one confirmed name in the gallery. Check back once photos have been tagged. | No one has been tagged in photos yet. Check back soon. | The old copy said the same fact twice ("needs a confirmed name", "once photos have been tagged") in tagging-pipeline vocabulary. One plain sentence, one next action; the header above already names My Weekend. |
| 25 | personalization/MyWeekendGallery.tsx, empty state | No confirmed photos of {personName} yet. Check back as more photos are tagged. | No photos of {personName} here yet. Check back as more of the weekend gets tagged. | Drops the "confirmed" jargon (the tagging sentence already carries the honest hedge) and un-doubles "photos ... photos". |
| 26 | personalization/MyWeekendClient.tsx, fallback name | You | Guest | The fallback composes into visible copy: "You's weekend" as the page heading, "Not You?" on the button, "You's weekend slideshow" in the dialog label. "Guest" is grammatical in all three. String value only; the fallback logic is untouched. |

### Deliberately left alone

- **All filter and picker labels** (Sort, Weekend order, Newest, Orientation, Source, Events, All events, People, Everyone, Search people): crisp scan targets; wit is banned on controls and none was added.
- **"This looks like a connection hiccup, not an empty gallery."**: already the best error line in scope; the reassurance is the clarity.
- **"No photos match these filters." + "Clear filters"**: an empty state with exactly one next action, working as designed.
- **"Gathering your weekend…" and "Loading your weekend…"**: a matched warm pair a guest may see in sequence; the progression reads as intended.
- **"Not {personName}?"**: the familiar account-switch pattern, playful and three words long.
- **Both "This preview is unavailable." lines and both "Preview unavailable" tiles**: truthful and blame-free; charm here would cost clarity.
- **Transport controls** ("Prev"/"Next", "Play"/"Pause" (test-pinned), "Hide captions"/"Show captions", "Full screen", "Download", "Close"): guests scan these mid-slideshow; they stay functional.
- **"There is nothing in {modeLabel} to show yet."**: generic-safe copy for a component that accepts any mode label, and unreachable through normal use since callers hide the slideshow button when empty.
- **All aria-labels except the speed slider**: already descriptive over cute ("Open photo from {event} with {names}", "Previous photo", "Close slideshow", "Filter by person").
- **Flagged, not fixed (out of scope, lives in src/app):** the /favorites page header says "starred" while every control is a heart, and the my-weekend page header still carries the now-last guest-facing "confirmed photo". Both belong to whoever holds src/app.

### Constraint audit

- Em dashes: zero across all six edited files and all four scoped directories (grep-verified); the one "--" splice in scope was removed.
- Protected phrases: no new uses anywhere in scope (grep-verified); "the ones you love" in #21 is not one of the four protected phrases.
- No invented facts: the My Weekend slideshow path in #21 is real (the Play slideshow button renders whenever photos exist and its toolbar carries the heart); "grouped by event" matches groupByEvent's actual behavior; every other change drops jargon, de-dupes, or fixes typography.
- Lengths: labels stay short ("Enter the password" fits the same button as "Go to sign in"); both rewritten paragraphs are shorter than their originals; no layout risk.
