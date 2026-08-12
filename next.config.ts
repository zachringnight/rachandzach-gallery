import type { NextConfig } from "next";
import { securityHeaderEntries } from "./src/lib/auth/security-headers";
import { legacyRedirects } from "./src/lib/redirects";

const onnxRuntimeTarget = `${process.platform}/${process.arch}`;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // onnxruntime-node loads its platform shared library from a computed path,
  // which static output tracing can miss even when it finds the native
  // binding. Keep the complete matching runtime directory with /api/search.
  outputFileTracingIncludes: {
    "/api/search": [
      `node_modules/onnxruntime-node/bin/napi-v6/${onnxRuntimeTarget}/**/*`,
    ],
  },
  // A developer's prewarmed fp32 model cache is local state, not a deploy
  // artifact. Production fetches it into its writable /tmp cache instead.
  outputFileTracingExcludes: {
    "/api/search": [
      "node_modules/@huggingface/transformers/.cache/**/*",
    ],
  },
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
