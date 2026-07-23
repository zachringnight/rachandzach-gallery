import type { MetadataRoute } from "next";

import { SITE_ORIGIN } from "@/lib/redirects";

/**
 * Only public pages. Protected routes (photos, my-weekend,
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
    {
      url: `${SITE_ORIGIN}/nyc`,
      lastModified: new Date("2026-07-23"),
      changeFrequency: "weekly",
      priority: 0.9,
    },
  ];
}
