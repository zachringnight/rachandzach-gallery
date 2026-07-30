import type { MetadataRoute } from "next";

import { SITE_ORIGIN } from "@/lib/redirects";

/**
 * Only public pages. Protected routes and disabled feature modules must never
 * appear here.
 *
 * Since the whole-site password gate (2026-07-30) that leaves exactly one
 * entry. The archive home used to lead this list; it now redirects anonymous
 * visitors to /enter, and a sitemap entry for a page a crawler cannot read is
 * a broken promise, so it was dropped in the same change. /marathon is public
 * too but is a 308 alias for /nyc, and redirects do not belong in a sitemap.
 *
 * If this file is ever empty, delete the sitemap and the robots.txt reference
 * to it rather than shipping an empty one.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  /*
   * /nyc is listed unconditionally, matching its `robots: index` metadata.
   *
   * This was briefly conditional on the supporters wall, back when approving
   * the wall also flipped the page to noindex. That coupling was dropped
   * (2026-07-27): it is a fundraiser with a deadline, and a page search
   * engines are told to ignore raises nothing. The donor names are handled
   * with data-nosnippet at the section instead. If the page is ever set back
   * to noindex, drop it from here in the same change -- a noindex URL in a
   * sitemap is two contradicting signals.
   */
  entries.push({
    url: `${SITE_ORIGIN}/nyc`,
    lastModified: new Date("2026-07-27"),
    changeFrequency: "weekly",
    priority: 0.9,
  });

  return entries;
}
