import type { NextConfig } from "next";
import { securityHeaderEntries } from "./src/lib/auth/security-headers";
import { legacyRedirects } from "./src/lib/redirects";

const onnxRuntimeTarget = `${process.platform}/${process.arch}`;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: process.cwd()
  },
  // onnxruntime-node resolves its native binding dynamically. Next's normal
  // file trace found the .node binding but omitted the adjacent shared
  // library, so Vercel failed to import @huggingface/transformers at runtime
  // with `libonnxruntime.so.1: cannot open shared object file`. Keep this
  // scoped to Moment Search and the current build target so no unrelated
  // function or foreign platform runtime carries the native payload.
  outputFileTracingIncludes: {
    "/api/search": [
      `./node_modules/onnxruntime-node/bin/napi-v6/${onnxRuntimeTarget}/**/*`,
    ],
  },
  // A developer's prewarmed fp32 model cache is local state, not a deploy
  // artifact. Production fetches the model into its writable /tmp cache.
  outputFileTracingExcludes: {
    "/api/search": [
      "./node_modules/@huggingface/transformers/.cache/**/*",
    ]
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
