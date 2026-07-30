import type { MetadataRoute } from "next";

import { SITE_ORIGIN } from "@/lib/redirects";

/**
 * Crawler policy, rewritten for the whole-site password gate (2026-07-30).
 *
 * The blanket rule is now Disallow: "/" -- not a list of the protected paths,
 * because after the gate went up the protected set is "everything", and an
 * enumeration would go stale the first time a route is added. The fundraiser
 * is re-opened by the two Allow lines above it. Every major crawler resolves
 * the most specific matching rule first, so /nyc and /marathon stay
 * crawlable while / and everything under it does not.
 *
 * This is a crawler instruction, not access control: src/lib/auth/
 * guest-session.ts is what actually keeps the archive shut, and a crawler
 * that ignores robots.txt still lands on /enter.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/nyc", "/marathon"],
        disallow: ["/"],
      },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
