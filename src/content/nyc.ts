/**
 * Rachel's 2026 TCS New York City Marathon fundraiser.
 *
 * The story below is preserved verbatim from Rachel's NYRR fundraising page.
 * Progress is an explicitly dated snapshot rather than a scraped live total;
 * the NYRR page remains the canonical source for donations and current
 * progress.
 *
 * HAND-ENTERED VALUES DRIFT. Anything read off the NYRR page (the raised
 * total, the donation count) carries an `asOf` date that the UI renders next
 * to it, so a stale number reads as a dated snapshot rather than as a live
 * one. When you update a number, update its `asOf` in the same edit.
 */
export const nycFundraiser = {
  runnerName: "Rachel Casciano",
  /** Official race name. Used in full at least once on the page. */
  raceName: "2026 TCS New York City Marathon",
  charityName: "Team for Kids",
  /** Full program name, for the first prominent mention. */
  charityFullName: "NYRR Team for Kids",
  /**
   * What Team for Kids actually is, in the site's voice. Sourced from Rachel's
   * own NYRR story and NYRR's program description, not invented.
   */
  charityBlurb:
    "Team for Kids is the fundraising team behind New York Road Runners' free youth and community running programs. Adult runners take on a race, and what they raise puts running shoes, coaches, and race days in front of kids who would not otherwise get them.",
  taxNote:
    "Donations are 100% tax deductible and support a 501(c)(3) non-profit organization.",
  /*
   * Outbound links, in the priority the page gives them:
   *   1. donationUrl      the ask. Primary CTA, twice on the page.
   *   2. fundraiserUrl    her page: live total, and where donors land.
   *   3. impactReportUrl  supporting evidence for the cause. Secondary CTA.
   *   4. raceInfoUrl      context for "what is this race". Lowest priority;
   *                       it must never compete with the donate action.
   * Stored clean: no utm_*, fbclid, or other click identifiers. Those are
   * session-scoped tracking parameters and do not belong baked into a site.
   */
  fundraiserUrl: "https://fundraisers.nyrr.org/rachel-casciano",
  donationUrl:
    "https://donations.nyrr.org/donations/new?fundraiser=fa3fbedc687074f450f7",
  impactReportUrl: "https://ceros.nyrr.org/1/p/1",
  raceInfoUrl: "https://www.nyrr.org/tcsnycmarathon",
  /**
   * Course, not a date. This is the fixed, published TCS NYC Marathon route.
   * The two DATES live in nycRaceDay and nycFundraisingDeadline below, and
   * they are deliberately separate things.
   */
  course: "Staten Island to Central Park",
  photo: {
    src: "/nyc/rachel-running.jpg",
    width: 4251,
    height: 5314,
    alt: "Rachel smiling with her arms outstretched while running through a city race",
    /**
     * Caption for the hero frame. Deliberately does NOT name New York: the
     * bib and singlet in this frame are from an earlier 2026 race, so
     * labelling it "New York City · 2026" (as this page used to) claimed a
     * place the photograph is not of. Swap in an actual NYC race photo after
     * the marathon and this caption can name the city.
     */
    caption: "Running toward something bigger.",
    captionMeta: "Next stop: New York",
  },
  /**
   * 1200x630 share card, cropped from the hero photo (sharp, centred on
   * Rachel). Used for link previews when this page gets texted around, which
   * is most of how it will be found.
   */
  shareImage: {
    src: "/nyc/nyc-share.jpg",
    width: 1200,
    height: 630,
    alt: "Rachel running mid-race with both arms outstretched and a huge smile",
  },
  /**
   * Read off the NYRR fundraiser page by hand on `asOf`. Never live.
   *
   * `raised` and `goal` are plain dollars. The displayed percentage is always
   * computed from them (see fundraiserProgressPercent / fundraiserRawPercent),
   * never hardcoded, so the two can never disagree.
   *
   * `donations` counts contributions, not unique people. Repeat and anonymous
   * gifts count toward the total without inferring anyone's identity.
   */
  progress: {
    /*
     * Read off https://fundraisers.nyrr.org/rachel-casciano on 2026-10-05.
     *
     * The Supporters tab listed 81 donations totaling $8,770.50, matching
     * the page header, with no pagination left to load. This includes repeat
     * and anonymous gifts; it is not a unique-person count. NYRR's countdown
     * read "Only 2 days remaining" on the same visit (Oct 7 from Oct 5).
     */
    raised: 8770.50,
    goal: 10000,
    donations: 81,
    asOf: "October 5, 2026",
    asOfISO: "2026-10-05",
  },
  /**
   * The Team for Kids numbers quoted in Rachel's own NYRR story below. Kept
   * here rather than inline in the page so the copy and the stat band can
   * never drift apart.
   */
  impactStats: [
    { value: "$120M+", label: "raised by Team for Kids" },
    { value: "2.5M", label: "students served" },
    { value: "26.2", label: "miles through New York" },
  ],
  story: [
    "Hi friends and family! I’m running the 2026 TCS New York City Marathon with Team for Kids, a team of adult runners who raise funds to support New York Road Runners' free youth and community programs. Team for Kids has raised over $120M and served 2.5M students in NYC and across the nation with the goal of encouraging lifelong physical activity.",
    "It’s no secret that running has played a pivotal role in my life - opening doors of opportunity and getting me through some of my hardest moments. I really don't know where I would be without it. All kids should have the same chance to experience the cathartic and life-changing power of running, and that's why I'm finding it so special to give back to the sport that gave me so much.",
    "Your donation* will help empower youth and communities to develop and encourage healthy habits via running, making it possible for more kids to further their lives through this transformational sport. Thank you for taking part in getting more kids running towards brighter futures, I appreciate it so much.",
  ],
  /**
   * Rachel's "why", pulled up out of the story so it reads before anyone has
   * to scroll into a paragraph.
   *
   * THIS IS NOT A PARAPHRASE. It is an exact substring of story[1], kept
   * character-for-character including the hyphen and the curly apostrophe, so
   * that presenting it in quotation marks is honest. A unit test asserts the
   * substring relationship; if you reword this, reword story[1] too, or the
   * test fails on purpose. Rach can replace both with whatever she prefers.
   */
  pullQuote:
    "It’s no secret that running has played a pivotal role in my life - opening doors of opportunity and getting me through some of my hardest moments.",
  signoff: "With love, Rach",
  footnote:
    "*Donations are 100% tax deductible and support a 501(c)(3) non-profit organization.",
} as const;

export interface KeyDate {
  /** ISO date (YYYY-MM-DD). Absolute, never a stored day count. */
  iso: string;
  /** Human label, e.g. "Sunday, November 1, 2026". */
  label: string;
}

/*
 * TWO DIFFERENT DATES. Do not conflate them in the UI, and do not let one
 * label stand in for the other: the fundraising window closes 25 days BEFORE
 * she runs, which is normal for a charity entry but is not what a reader
 * assumes. Both are labelled explicitly on the page.
 *
 * Both are stored as ABSOLUTE DATES. Nothing anywhere stores "N days left":
 * a stored countdown is wrong the day after it is written, a stored date is
 * right forever. The remaining-days figure is computed in the browser at view
 * time by src/components/nyc/DaysRemaining.tsx -- see that file for why it is
 * a client component and not a server calculation.
 */

/** Race day. CONFIRMED by the owner 2026-07-27. Authoritative, not derived. */
export const nycRaceDay: KeyDate = {
  iso: "2026-11-01",
  label: "Sunday, November 1, 2026",
};

/**
 * Fundraising deadline. CONFIRMED by the owner 2026-07-27.
 *
 * Originally back-calculated from the "72 days remaining" figure on the NYRR
 * page and carried as provisional; the date has since been confirmed, so it
 * is authoritative. Note it closes 25 days BEFORE race day, which is normal
 * for a charity entry and is why the two dates are labelled separately in the
 * UI -- a reader will otherwise assume the deadline is race day.
 *
 * Everything downstream (the countdown, the closing message) follows from
 * this one value.
 */
export const nycFundraisingDeadline: KeyDate = {
  iso: "2026-10-07",
  label: "Wednesday, October 7, 2026",
};

/* ==========================================================================
 * Rachel's marathon post on Instagram
 * ==========================================================================
 *
 * The permalink below is real, supplied by the owner 2026-07-27. Its saved
 * still (`image`) is optional: without one the card renders as type and still
 * links out, which is correct, just quieter.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO OFFICIAL INSTAGRAM <script> EMBED
 * ---------------------------------------------------------------------------
 * Instagram's official embed needs three things this site's Content Security
 * Policy denies (src/lib/auth/security-headers.ts, applied to EVERY response
 * by both next.config.ts and proxy.ts):
 *
 *   script-src  'self' 'unsafe-inline' [+ Google/Dropbox paths]  -> blocks
 *               https://www.instagram.com/embed.js
 *   frame-src   'none' unless Drive/Dropbox are enabled          -> blocks
 *               the <iframe> that embed.js injects
 *   img-src     'self' data: blob: https://*.supabase.co         -> blocks
 *               scontent.cdninstagram.com media
 *
 * The CSP is global, not per-route, so opening it for Instagram would let a
 * Meta-owned script run on the authenticated gallery pages too, on a site
 * whose whole security posture is default-deny and fail-closed. Not worth it
 * for one post. (The same rule rules out any third-party NYRR or fundraising
 * "thermometer" widget, which is why the progress bar on this page is local.)
 *
 * So this page uses a locally hosted still of the post that links out to
 * Instagram instead. Tradeoff: it does not live-update (a new caption or like
 * count means re-saving the image), and someone has to save it. In exchange it
 * costs zero third-party script, zero cross-site tracking of the people Rachel
 * sends this page to, no CSP change, and it renders instantly on a phone.
 *
 * If a live embed is ever genuinely wanted, the smallest safe change is to add
 * ONLY `https://www.instagram.com` to frame-src and use the scriptless iframe
 * form (https://www.instagram.com/p/<shortcode>/embed), which needs no
 * script-src or img-src widening. That still hands Meta a third-party frame on
 * a public page; make it a deliberate decision, not a default.
 * ======================================================================== */

export interface InstagramPostImage {
  /** Local path under public/. */
  src: string;
  width: number;
  height: number;
  /** Describes the picture for screen readers. Never "Instagram post". */
  alt: string;
}

export interface InstagramPostContent {
  /** Canonical permalink, e.g. https://www.instagram.com/p/<shortcode>/ */
  postUrl: string | null;
  /**
   * Shortcode from the permalink. Only needed by the scriptless iframe form
   * described above, which is NOT in use because frame-src is 'none'.
   * Recorded so that decision stays a one-line change rather than a
   * re-derivation.
   */
  shortcode: string | null;
  /** Display handle including the @, e.g. "@rachcasciano". */
  handle: string | null;
  /** Short human date for the card, e.g. "April 2026". */
  postedOn: string | null;
  /** One or two lines lifted from the caption. Not the whole caption. */
  excerpt: string | null;
  /**
   * Locally saved still of the post. Null renders a typographic card that
   * still links out, rather than a broken image.
   *
   * To add one: save the post image to public/nyc/instagram-post.jpg and set
   * the real pixel width/height below. (Until 2026-08-09 the filename also had
   * to be allow-listed in a public-routes array or it 404'd behind the gate;
   * that gate and that list are gone.)
   */
  image: InstagramPostImage | null;
}

export const instagramPost: InstagramPostContent = {
  postUrl: "https://www.instagram.com/p/Dal9ZrOyy4Z/",
  shortcode: "Dal9ZrOyy4Z",
  // OPTIONAL, all three. Each is independently skipped when null, so a
  // half-filled card still reads correctly.
  handle: null,
  postedOn: null,
  excerpt: null,
  // OPTIONAL: see InstagramPostImage above for how to add the still.
  image: null,
};

/* ==========================================================================
 * Supporters wall
 * ==========================================================================
 *
 *   ⚠️  DRAFT. NOT APPROVED. DOES NOT RENDER YET.  ⚠️
 *
 * WHAT THIS IS
 * The names and messages below were read ONCE from Rachel's NYRR fundraiser
 * page (https://fundraisers.nyrr.org/rachel-casciano) on 2026-07-27 and
 * written into this file by hand. That is the whole data path. There is no
 * scraper, no cron, no API route, and no runtime fetch of NYRR anywhere in
 * this repo: this file is the source of truth, evaluated at build time. If
 * these messages should ever be refreshed, someone re-reads the page and
 * edits this list deliberately.
 *
 * WHY `approved` IS NOW TRUE
 * These are 46 real people's names and the personal notes they wrote to
 * Rachel. NYRR showing them on NYRR's own page is not the same act as
 * republishing them on rachandzach.com, which is a public, unauthenticated
 * site, so this shipped gated: while `approved` was false the entire section
 * rendered nothing, exactly as if the list were empty.
 *
 * The owner reviewed the list and approved publication on 2026-07-27.
 *
 * The gate stays in the code rather than being deleted. Anyone who needs to
 * pull the wall down -- a donor asks to be removed, a name turns out to be
 * wrong -- flips this one flag and the section disappears, without touching
 * the list or the component.
 *
 * WHAT IS DELIBERATELY ABSENT
 * - Donation AMOUNTS. Never stored, never shown. Per-person amounts invite
 *   exactly the ranking this project refuses everywhere else.
 * - ANONYMOUS donors. NYRR reported 47 donations; 46 carry a display name and
 *   are listed here. The unlisted one is not reconstructed or counted in by
 *   name. Anyone giving anonymously made an explicit choice, and it stands.
 *
 * SEARCH ENGINES
 * Turning `approved` on also switches /nyc to noindex (see the page's
 * metadata). That coupling is on purpose: names and personal messages should
 * not become searchable under this domain. The cost is that the fundraiser
 * page drops out of search results while the wall is live. It is shared by
 * link rather than found by search, so that is the right trade, but it IS a
 * trade and the owner should know they are making it.
 */
export interface Supporter {
  /** Display name exactly as the donor chose it on NYRR. Never an amount. */
  name: string;
  /** Their note, trimmed of platform artefacts. Null when they left none. */
  message: string | null;
}

export interface SupportersContent {
  /**
   * Gate. While false the wall renders nothing, regardless of `people`.
   *
   * Either owner (Rachel or Zach) can approve, and approval covers the list
   * as it stands plus later donors on the same fundraiser. Zach confirmed
   * that standing approval on 2026-08-11; it replaces an earlier note here
   * that said only Rachel could set this and only after reading each name.
   *
   * What has NOT changed: this is still the one lever that takes the whole
   * wall down, names still come from the donor's own public display name on
   * NYRR, amounts are never stored, and anyone who gave anonymously is
   * excluded by visibleSupporters regardless of what is in `people`.
   */
  approved: boolean;
  /** Date the list was read off NYRR, rendered with the wall once approved. */
  seededOn: string;
  people: readonly Supporter[];
  /** Optional line under the wall. Null renders nothing. */
  note: string | null;
}

export const nycSupporters: SupportersContent = {
  approved: true,
  seededOn: "August 17, 2026",
  note: null,
  /*
   * Newest first, matching the order NYRR lists them in. Linda Willey gave
   * between 2026-08-11 and 2026-08-17. Standing approval covers later donors
   * on the same fundraiser.
   */
  people: [
    {
      name: "Linda Willey",
      message: "Rachel, you are an amazing runner! Aunt Linda and Uncle Paul",
    },
    { name: "Tatiana Jovic", message: null },
    { name: "Alicia Garrity", message: "my gal. so proud of you!" },
    {
      name: "Jessie Long",
      message:
        "You’re an inspiration! Get it for those kiddos xx - Jessie, Danny and Stevie",
    },
    { name: "LunarEpic", message: null },
    { name: "Kaitlyn Young", message: null },
    { name: "Vanguard", message: null },
    { name: "Melody Attila", message: "You got this Aunt Rach!!! You are amazing!" },
    {
      name: "Scott Andrew Paige",
      message: "Go get em Rach! Wonderful cause and iconic race, enjoy.",
    },
    { name: "Jeff and Donna Smith", message: "Great job!!" },
    { name: "Caleb Omens", message: "Send it, lady." },
    { name: "Deborah Hyun", message: null },
    { name: "Hoshang Unvala", message: "Go Rachel!" },
    { name: "Birmingham Family", message: "Good luck Rachel!" },
    { name: "one of your cousins muahah", message: null },
    { name: "Rich Close", message: null },
    { name: "Joanie and Toby", message: "Go Rach!!" },
    { name: "Pam Waamuth", message: "Happy to support you Rach!!" },
    { name: "Katherine Turney", message: "GO RACH GO!" },
    { name: "Lizzy Yao", message: "Yaaaassas Rach!!!" },
    { name: "Nancy Engh", message: "Kick up some dust! Kudos!" },
    { name: "Natalie Weeks", message: "let's goooo Rach!" },
    {
      name: "Phil Quist",
      message: "Good luck!! You are going to crush it. Love, Phil and Jamie.",
    },
    {
      name: "Marisa Hunsicker",
      message: "this is awesome!! good luck! I know you'll kick butt!!",
    },
    { name: "Taylor Bennett", message: "Run Rach!!!" },
    { name: "Paden Spencer", message: "no dunk tank needed" },
    { name: "Zach Hetrick", message: null },
    {
      name: "Virginia Rush",
      message: "Rachel, We are so proud of you! Love always, Din and Jeff",
    },
    { name: "Marcus Herzberger Family Foundation", message: null },
    { name: "Paul Cohn", message: "Good luck! Paul and Jo Cohn" },
    { name: "Trelawny Vermont-Davis", message: null },
    {
      name: "Stephanie and RIck",
      message: "With lots of love, kick some NY Marathon a##!",
    },
    {
      name: "Todd Lurie",
      message: "Go Rach! Proud to always be behind you in all you do!",
    },
    { name: "Debi Becker", message: "Go Rach!!! Forever proud" },
    { name: "Lauren and Jake Lurie", message: "Way to go! We're so proud of you!" },
    {
      name: "Morgan and Erik",
      message:
        "You are incredible!! We will always be your biggest cheerleaders!",
    },
    {
      name: "Lisa Caplan",
      message:
        "What a wonderful fundraiser ❤️ You go dear Rach ❣️ You truly are AMAZING",
    },
    {
      name: "Jody Post",
      message: "congratulations cannot wait to be there to cheer you on.",
    },
    { name: "Maddie and Jeff Lurie", message: "GO RACH!!! SO PROUD!" },
    {
      name: "Laura Weisman",
      message:
        "we love you, rach!!! so excited to see you at the finish line!!!",
    },
    { name: "Megan McCullough", message: "So proud of you my friend!" },
    { name: "Kayla Kohler", message: "Run Rachey run!!!" },
    { name: "Lauren Bond", message: "RUN RACH RUN" },
    { name: "Amanda Pliska", message: "go Rach, go!!!" },
    { name: "Sheldon Tucker", message: null },
    { name: "Anne Wintroub", message: "Yes to this, yes to YOU!" },
    { name: "Tara Richardson", message: "WOOOO PROUD OF YOU" },
    { name: "Beth Caputo", message: "good luck Rach!" },
    { name: "Lauren Lattimer", message: "I LOVE YOU GO CRUSH IT!!!" },
    { name: "Dean Kraras", message: "Good luck Rachel!" },
    { name: "Carter Cheskey", message: null },
    { name: "Dominique Caron", message: "Run fast!!!!!!!!" },
    { name: "Tim Corkum", message: "you got this!!" },
  ],
};

/**
 * True only when Rachel has approved the wall AND there is something in it.
 * Both the section and the page's noindex decision read this one function, so
 * they can never disagree about whether names are on the page.
 */
export function hasSupporters(
  content: SupportersContent = nycSupporters,
): boolean {
  if (!content.approved) return false;
  return content.people.some((person) => person.name.trim().length > 0);
}

/**
 * Anonymous entries never make it into `people` in the first place, but a
 * future hand-edit could paste one in. This is the last line of defence.
 */
export function visibleSupporters(
  content: SupportersContent = nycSupporters,
): readonly Supporter[] {
  if (!hasSupporters(content)) return [];
  return content.people.filter((person) => {
    const name = person.name.trim();
    if (name.length === 0) return false;
    return !/^anonymous\b/i.test(name);
  });
}

/** True once a real Instagram permalink has been supplied. */
export function hasInstagramPost(
  content: InstagramPostContent = instagramPost,
): boolean {
  return isUsableUrl(content.postUrl);
}

/**
 * Guards against a half-filled config: an empty string, whitespace, or a
 * leftover "TODO"/"REPLACE_ME" placeholder must degrade exactly like null
 * rather than render an anchor that goes nowhere.
 */
function isUsableUrl(value: string | null): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return trimmed.startsWith("https://");
}

/**
 * Percentage for the BAR: always clamped to 0-100 so the fill can never
 * overflow its track when Rachel passes the goal.
 */
export function fundraiserProgressPercent(
  raised: number = nycFundraiser.progress.raised,
  goal: number = nycFundraiser.progress.goal,
): number {
  return Math.min(100, Math.max(0, fundraiserRawPercent(raised, goal)));
}

/**
 * Percentage for the LABEL: uncapped, so passing the goal reads as "127%"
 * rather than being silently flattened to 100%. Still floored at 0 and still
 * safe for a zero or nonsense goal.
 */
export function fundraiserRawPercent(
  raised: number = nycFundraiser.progress.raised,
  goal: number = nycFundraiser.progress.goal,
): number {
  if (!Number.isFinite(raised) || !Number.isFinite(goal) || goal <= 0) return 0;
  return Math.max(0, Math.round((raised / goal) * 100));
}

/** Dollars still to raise. Zero once the goal is met, never negative. */
export function fundraiserRemaining(
  raised: number = nycFundraiser.progress.raised,
  goal: number = nycFundraiser.progress.goal,
): number {
  if (!Number.isFinite(raised) || !Number.isFinite(goal)) return 0;
  return Math.max(0, goal - raised);
}
