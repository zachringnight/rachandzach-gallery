import type { NextConfig } from "next";
import { securityHeaderEntries } from "./src/lib/auth/security-headers";
import { legacyRedirects } from "./src/lib/redirects";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: process.cwd()
  },
  // Security headers for every response, including the static assets the
  // proxy matcher skips. proxy.ts applies the identical set to proxied
  // responses; both read src/lib/auth/security-headers.ts so they cannot
  // drift (tests/auth/route-protection.test.ts asserts the parity).
  // Legacy Wix-era routes, merged from packet 05's data module
  // (src/lib/redirects.ts) by the wave 2 Integrate agent.
  async redirects() {
    return legacyRedirects;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaderEntries()
      }
    ];
  }
};

export default nextConfig;
