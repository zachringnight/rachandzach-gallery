import { describe, expect, it } from "vitest";
import {
  configureTransformersEnvironment,
  QUERY_EMBEDDING_VERCEL_CACHE_DIR,
} from "@/lib/search/transformers-environment";

describe("Moment Search Transformers environment", () => {
  it("uses the writable Vercel temp directory for the filesystem cache", () => {
    const runtimeEnv = {
      allowLocalModels: true,
      cacheDir: "/var/task/node_modules/@huggingface/transformers/.cache",
      useBrowserCache: true,
      useFSCache: false,
    };

    configureTransformersEnvironment(runtimeEnv, true);

    expect(runtimeEnv).toEqual({
      allowLocalModels: false,
      cacheDir: QUERY_EMBEDDING_VERCEL_CACHE_DIR,
      useBrowserCache: false,
      useFSCache: true,
    });
  });

  it("does not replace the normal local filesystem cache outside Vercel", () => {
    const runtimeEnv = {
      allowLocalModels: true,
      cacheDir: "/local/cache",
      useBrowserCache: true,
      useFSCache: true,
    };

    configureTransformersEnvironment(runtimeEnv, false);

    expect(runtimeEnv).toEqual({
      allowLocalModels: true,
      cacheDir: "/local/cache",
      useBrowserCache: false,
      useFSCache: true,
    });
  });
});
