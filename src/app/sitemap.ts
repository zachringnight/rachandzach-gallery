import type { MetadataRoute } from "next";

import { SITE_ORIGIN } from "@/lib/redirects";

/**
 * Only public pages. Protected routes (photos, my-weekend,
 * add-yours, admin) and disabled feature modules must never appear here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [
    {
      url: `${SITE_ORIGIN}/`,
      lastModified: new Date("2025-07-19"),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];

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
