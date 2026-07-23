/**
 * TV mode's candidate pool (Round Two, docs/0719_Round_Two_Features_v1.md:
 * "/tv full-screen auto-looping slideshow for gatherings").
 *
 * Two pure, injectable pieces, split out of page.tsx so each is directly
 * testable without a live Supabase client (tests/modules/tv.test.tsx):
 *
 *  - fetchApprovedPool walks getGalleryPage's cursor to assemble the WHOLE
 *    approved catalog, not just one bounded page. A single getGalleryPage
 *    call always caps out at MAX_GALLERY_LIMIT (100) photos -- fine for the
 *    paged gallery grid, but wrong here: with photos spread across ~14
 *    events, the first 100 in "weekend" order can easily be only the first
 *    event or two, which would make TV mode silently skip every later event
 *    for the whole session. Walking every page (the same technique
 *    tests/gallery/query.test.ts's own pageAll helper uses to prove cursor
 *    stability) is the only way through the public query API to get every
 *    approved photo, which event diversity below needs.
 *  - orderForTv reuses Shuffle the Weekend's own diversity algorithm
 *    (buildShuffleSequence, src/lib/modules/contracts.ts) to turn that pool
 *    into one full event-diverse permutation, so consecutive photos spread
 *    across the weekend instead of clustering in whichever event sorts
 *    first.
 */
import {
  getGalleryPage,
  MAX_GALLERY_LIMIT,
  type GalleryDataSource,
  type GalleryPhotoView,
} from "@/lib/gallery/query";
import {
  buildShuffleSequence,
  type ShuffleCandidate,
} from "@/lib/modules/contracts";
import type { ClientPhoto } from "@/lib/gallery/client-types";

/**
 * Safety valve only, mirroring tests/gallery/query.test.ts's pageAll guard:
 * protects against an infinite loop if a future bug ever left nextCursor
 * non-null forever. The real catalog (1,721 photos at last count) needs
 * ~18 pages at MAX_GALLERY_LIMIT; this leaves generous headroom for guest
 * uploads to keep growing the catalog for years without ever being cut off.
 */
const MAX_POOL_PAGES = 500;

/**
 * Every approved photo, in "weekend" order, fetched a full page at a time
 * until getGalleryPage reports no next cursor. Status isolation, confirmed-
 * people-only, and every other invariant getGalleryPage enforces apply here
 * unchanged -- this is the same public entry point every other gallery
 * surface uses, just called in a loop.
 */
export async function fetchApprovedPool(
  dataSource: GalleryDataSource,
): Promise<GalleryPhotoView[]> {
  const pool: GalleryPhotoView[] = [];
  let cursor: string | null = null;
  let pages = 0;

  do {
    const page = await getGalleryPage(
      { limit: MAX_GALLERY_LIMIT, cursor, sort: "weekend" },
      dataSource,
    );
    pool.push(...page.photos);
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor !== null && pages < MAX_POOL_PAGES);

  return pool;
}

/**
 * One full event-diverse pass over `photos` (a permutation, no duplicates
 * or drops), via the same pickShufflePhoto/buildShuffleSequence rules
 * Shuffle the Weekend uses for its "continue as a slideshow" ordering.
 * `random` is injectable so this is deterministic in tests; production
 * leaves it defaulted to Math.random via buildShuffleSequence.
 */
export function orderForTv(
  photos: ClientPhoto[],
  random?: () => number,
): ClientPhoto[] {
  const candidates: ShuffleCandidate[] = photos.map((photo) => ({
    id: photo.id,
    eventSlug: photo.eventSlug,
  }));
  const order =
    random === undefined
      ? buildShuffleSequence(candidates, null)
      : buildShuffleSequence(candidates, null, random);

  const byId = new Map(photos.map((photo) => [photo.id, photo] as const));
  return order
    .map((id) => byId.get(id))
    .filter((photo): photo is ClientPhoto => Boolean(photo));
}
