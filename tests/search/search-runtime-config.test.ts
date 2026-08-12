import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Moment Search runtime packaging", () => {
  it("traces the current ONNX runtime directory and excludes local model caches", () => {
    expect(nextConfig.outputFileTracingIncludes?.["/api/search"]).toEqual([
      `./node_modules/onnxruntime-node/bin/napi-v6/${process.platform}/${process.arch}/**/*`,
    ]);
    expect(nextConfig.outputFileTracingExcludes?.["/api/search"]).toEqual([
      "./node_modules/@huggingface/transformers/.cache/**/*",
    ]);
  });
});
