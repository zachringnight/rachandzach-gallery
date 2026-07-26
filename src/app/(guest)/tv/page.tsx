import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import { serializeGalleryPage } from "@/lib/gallery/serialize";
import { previewExpiresAt } from "@/lib/gallery/signed-previews";
import { fetchApprovedPool, orderForTv } from "./pool";
import { TvClient } from "./TvClient";

/**
 * /tv (Round Two: "full-screen auto-looping slideshow for gatherings").
 * Access is enforced automatically by the (guest) layout's default-deny
 * guest-session check; this page adds no check of its own (matching
 * /photos, /favorites, /my-weekend -- see src/app/(guest)/layout.tsx).
 *
 * Reads live every request: a guest at a gathering should see whatever is
 * newly approved, and the shuffled order is meant to be different each time
 * the screen is opened.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TV Mode | Rach & Zach",
  description:
    "A full-screen slideshow of the private archive, made for a big screen.",
  // Belt-and-suspenders alongside the crawler policy in src/app/robots.ts
  // (not owned by this route; see this packet's report for the disallow-
  // list addition an integrate pass should make there).
  robots: { index: false, follow: false },
};

export default async function TvPage() {
  const client = createAdminClient();
  const source = createSupabaseGalleryDataSource(client);

  const pool = await fetchApprovedPool(source);
  const serialized = await serializeGalleryPage(
    {
      photos: pool,
      nextCursor: null,
      total: pool.length,
      signedUrlExpiresAt: previewExpiresAt(),
    },
    client,
  );

  return <TvClient photos={orderForTv(serialized.photos)} />;
}
