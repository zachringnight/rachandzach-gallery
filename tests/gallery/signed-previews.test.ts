import { describe, expect, it, vi } from "vitest";
import {
  MAX_PATHS_PER_SIGN_REQUEST,
  PREVIEW_URL_TTL_SECONDS,
  previewExpiresAt,
  signPreviewUrls,
  type SignablePreview,
} from "@/lib/gallery/signed-previews";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * A storage double that records what TTL each createSignedUrls call received,
 * because the TTL the URL is actually signed with is the thing that used to
 * disagree with the expiry reported alongside it.
 */
function storageStub(
  behavior: (paths: string[]) => { path: string; signedUrl: string | null }[],
) {
  const ttlCalls: number[] = [];
  const bucketCalls: string[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        bucketCalls.push(bucket);
        return {
          createSignedUrls(paths: string[], expiresIn: number) {
            ttlCalls.push(expiresIn);
            return Promise.resolve({ data: behavior(paths), error: null });
          },
        };
      },
    },
  } as unknown as SupabaseClient<Database>;
  return { client, ttlCalls, bucketCalls };
}

const signsEverything = (paths: string[]) =>
  paths.map((path) => ({ path, signedUrl: `https://signed.test/${path}` }));

function previews(...paths: string[]): SignablePreview[] {
  return paths.map((objectPath) => ({ bucket: "previews", objectPath }));
}

describe("preview TTL", () => {
  it("defaults to eight hours, the value the module documents", () => {
    expect(PREVIEW_URL_TTL_SECONDS).toBe(8 * 60 * 60);
  });

  it("signs with the same TTL it reports as the expiry", async () => {
    const now = Date.UTC(2026, 0, 1);
    const { client, ttlCalls } = storageStub(signsEverything);

    const batch = await signPreviewUrls(client, previews("a.avif"), 900, now);

    expect(ttlCalls).toEqual([900]);
    expect(batch.expiresAt).toBe(new Date(now + 900_000).toISOString());
  });

  it("raises a below-floor TTL for the signed URL, not only for the expiry", async () => {
    // The bug this pins: previewExpiresAt clamped to the 60s floor while the
    // signing call got the raw value, so a caller passing 10 received URLs
    // that died in ten seconds and a promise they were good for sixty. The
    // renewal timer then fired long after every tile had 403'd.
    const now = Date.UTC(2026, 0, 1);
    const { client, ttlCalls } = storageStub(signsEverything);

    const batch = await signPreviewUrls(client, previews("a.avif"), 10, now);

    expect(ttlCalls).toEqual([60]);
    expect(batch.expiresAt).toBe(new Date(now + 60_000).toISOString());
  });

  it("falls back to the default when the TTL is not a finite number", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(previewExpiresAt(Number.NaN, now)).toBe(
      new Date(now + PREVIEW_URL_TTL_SECONDS * 1000).toISOString(),
    );
  });

  it("truncates a fractional TTL rather than passing it through", async () => {
    const { client, ttlCalls } = storageStub(signsEverything);
    await signPreviewUrls(client, previews("a.avif"), 90.7, Date.UTC(2026, 0, 1));
    expect(ttlCalls).toEqual([90]);
  });
});

describe("signPreviewUrls batching", () => {
  it("de-duplicates repeated object paths", async () => {
    const { client } = storageStub(signsEverything);
    const batch = await signPreviewUrls(
      client,
      previews("a.avif", "a.avif", "b.avif"),
      600,
    );
    expect([...batch.urls.keys()].sort()).toEqual(["a.avif", "b.avif"]);
  });

  it("chunks under the per-request ceiling", async () => {
    const paths = Array.from(
      { length: MAX_PATHS_PER_SIGN_REQUEST + 5 },
      (_, i) => `p${i}.avif`,
    );
    const { client, ttlCalls } = storageStub(signsEverything);

    const batch = await signPreviewUrls(client, previews(...paths), 600);

    expect(ttlCalls).toHaveLength(2);
    expect(batch.urls.size).toBe(paths.length);
  });

  it("reports a per-item failure without dropping the rest of the page", async () => {
    // Supabase signals partial failure per item: signedUrl null. A null must
    // never reach an <img src>, so it belongs in failures, not urls.
    const { client } = storageStub((paths) =>
      paths.map((path) => ({
        path,
        signedUrl: path === "bad.avif" ? null : `https://signed.test/${path}`,
      })),
    );

    const batch = await signPreviewUrls(
      client,
      previews("good.avif", "bad.avif"),
      600,
    );

    expect(batch.urls.get("good.avif")).toBe("https://signed.test/good.avif");
    expect(batch.urls.has("bad.avif")).toBe(false);
    expect(batch.failures).toContain("bad.avif");
  });

  it("marks a whole chunk failed when the storage call throws", async () => {
    const client = {
      storage: {
        from: () => ({
          createSignedUrls: () => Promise.reject(new Error("network down")),
        }),
      },
    } as unknown as SupabaseClient<Database>;

    const batch = await signPreviewUrls(client, previews("a.avif"), 600);

    expect(batch.urls.size).toBe(0);
    expect(batch.failures).toEqual(["a.avif"]);
  });

  it("signs an empty request without calling storage", async () => {
    const from = vi.fn();
    const client = { storage: { from } } as unknown as SupabaseClient<Database>;
    const batch = await signPreviewUrls(client, [], 600);
    expect(from).not.toHaveBeenCalled();
    expect(batch.urls.size).toBe(0);
  });
});
