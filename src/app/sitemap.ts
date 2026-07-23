import type { MetadataRoute } from "next";

import { SITE_ORIGIN } from "@/lib/redirects";

/**
 * Only the two public pages. Protected routes (photos, my-weekend,
 * add-yours, admin) and disabled feature modules must never appear here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_ORIGIN}/`,
      lastModified: new Date("2025-07-19"),
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${SITE_ORIGIN}/weekend`,
      lastModified: new Date("2025-07-19"),
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];
}
