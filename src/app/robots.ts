import type { MetadataRoute } from "next";

import { SITE_ORIGIN } from "@/lib/redirects";

/**
 * Crawler policy: the public story pages may be indexed; every guest-gated or
 * admin surface is disallowed and never appears in the sitemap either.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/photos", "/my-weekend", "/add-yours", "/admin", "/api"],
      },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
