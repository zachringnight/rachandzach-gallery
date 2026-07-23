/**
 * Legacy route redirects from the original rachandzach.com Wix site.
 *
 * INTEGRATE NOTE: packet 04 owns next.config.ts this wave, so packet 05 ships
 * these as data only. The Integrate agent merges `legacyRedirects` into the
 * next.config.ts `redirects()` function verbatim (each entry already matches
 * the Next.js redirect object shape). Until that merge lands, the routes 404;
 * tests assert against this map, not live routing.
 */

export interface LegacyRedirect {
  /** Old public path on the Wix site. */
  source: string;
  /** New destination, optionally with a legacy anchor. */
  destination: string;
  /** All legacy moves are permanent (308). */
  permanent: boolean;
}

export const legacyRedirects: LegacyRedirect[] = [
  { source: "/overview", destination: "/", permanent: true },
  { source: "/schedule-1", destination: "/weekend", permanent: true },
  { source: "/gallery", destination: "/photos", permanent: true },
  { source: "/faq-1", destination: "/weekend#faq", permanent: true },
  { source: "/travel", destination: "/weekend#travel", permanent: true },
];

/**
 * Canonical public origin, used only for crawler metadata (sitemap/robots)
 * that requires absolute URLs. This is the couple's existing domain; writing
 * it here connects nothing and deploys nothing.
 */
export const SITE_ORIGIN = "https://www.rachandzach.com";
