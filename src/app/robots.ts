import type { MetadataRoute } from "next";

import { SITE_ORIGIN } from "@/lib/redirects";

/**
 * Crawler policy: Disallow "/", with the fundraiser re-opened by the two
 * Allow lines above it. Every major crawler resolves the most specific
 * matching rule first, so /nyc and /marathon stay crawlable while / and
 * everything under it does not.
 *
 * DELIBERATELY UNCHANGED when the password gate was removed (2026-08-09).
 * The archive is now readable by anyone holding the URL, and this file is the
 * only thing still asking for it not to be indexed -- unlisted, not private.
 * Those are different properties and only one of them was given up: a wedding
 * archive that turns up in a search for a guest's name is a further step, and
 * a separate decision. A crawler that ignores robots.txt now reaches the
 * photos; nothing behind this file will stop it.
 *
 * The blanket rule is not an enumeration of protected paths on purpose --
 * "everything but the fundraiser" does not go stale when a route is added.
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
