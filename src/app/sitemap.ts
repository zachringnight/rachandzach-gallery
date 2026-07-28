import type { MetadataRoute } from "next";

import { hasSupporters } from "@/content/nyc";
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
   * /nyc drops out of the sitemap exactly when it goes noindex.
   *
   * Turning the supporters wall on publishes ~46 named donors and their
   * personal messages on a public route, so the page switches to noindex at
   * the same moment. Listing a noindex page in the sitemap sends crawlers two
   * contradicting signals, which is the kind of thing that resolves in
   * whichever direction you did not want. Both decisions read hasSupporters()
   * -- the same function the page's robots metadata and the section itself
   * read -- so they cannot drift apart.
   */
  if (!hasSupporters()) {
    entries.push({
      url: `${SITE_ORIGIN}/nyc`,
      lastModified: new Date("2026-07-27"),
      changeFrequency: "weekly",
      priority: 0.9,
    });
  }

  return entries;
}
