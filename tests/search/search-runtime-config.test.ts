import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Moment Search runtime packaging", () => {
  it("traces the Linux ONNX native binding and its adjacent shared library", () => {
    expect(nextConfig.outputFileTracingIncludes?.["/api/search"]).toEqual([
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1",
    ]);
  });
});
