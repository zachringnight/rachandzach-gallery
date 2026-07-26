import type { ClientPhoto } from "@/lib/gallery/client-types";

/**
 * Contact-sheet display model (design upgrade P4).
 *
 * The server assigns burst membership over the full sorted result set; this
 * module folds the loaded, contiguous prefix of that order into the list of
 * cards the grid actually renders. Pure and deterministic so it can be unit
 * tested without a DOM.
 *
 * - A collapsed burst renders as ONE stack card (its first loaded frame is
 *   the face) with the burst's full frame count.
 * - An expanded burst renders every loaded frame as its own card, flagged
 *   so the grid can draw the contact-sheet edge treatment.
 * - Singleton photos pass straight through.
 */

export type DisplayItem =
  | {
      kind: "photo";
      key: string;
      photo: ClientPhoto;
      /** Index into the loaded photos array. */
      photoIndex: number;
    }
  | {
      kind: "stack";
      key: string;
      burstId: string;
      /** Loaded frames, in archive order; the first is the card face. */
      photos: ClientPhoto[];
      /** Index of the first loaded frame in the photos array. */
      photoIndex: number;
      /** Full burst size within the result set (may exceed loaded frames). */
      size: number;
    }
  | {
      kind: "burst-frame";
      key: string;
      photo: ClientPhoto;
      photoIndex: number;
      burstId: string;
      /** True for the first loaded frame: it carries the collapse control. */
      leader: boolean;
    };

export function buildDisplayList(
  photos: readonly ClientPhoto[],
  expanded: ReadonlySet<string>,
): DisplayItem[] {
  const items: DisplayItem[] = [];
  let index = 0;
  while (index < photos.length) {
    const photo = photos[index];
    const burst = photo.burst;
    if (!burst || burst.size < 2) {
      items.push({
        kind: "photo",
        key: photo.id,
        photo,
        photoIndex: index,
      });
      index += 1;
      continue;
    }
    // Collect the burst's contiguous loaded frames.
    const frames: ClientPhoto[] = [];
    const start = index;
    while (
      index < photos.length &&
      photos[index].burst?.id === burst.id
    ) {
      frames.push(photos[index]);
      index += 1;
    }
    if (expanded.has(burst.id)) {
      frames.forEach((frame, offset) => {
        items.push({
          kind: "burst-frame",
          key: frame.id,
          photo: frame,
          photoIndex: start + offset,
          burstId: burst.id,
          leader: offset === 0,
        });
      });
    } else {
      items.push({
        kind: "stack",
        key: `stack:${burst.id}`,
        burstId: burst.id,
        photos: frames,
        photoIndex: start,
        size: burst.size,
      });
    }
  }
  return items;
}

/** Ids of every loaded frame in a display item (selection semantics). */
export function displayItemPhotoIds(item: DisplayItem): string[] {
  if (item.kind === "stack") return item.photos.map((photo) => photo.id);
  return [item.photo.id];
}

/**
 * The display item that shows a given photo index: an exact card, or the
 * stack that folds it away. Used to map scroll targets both ways.
 */
export function displayIndexForPhotoIndex(
  items: readonly DisplayItem[],
  photoIndex: number,
): number {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const size =
      item.kind === "stack" ? item.photos.length : 1;
    if (photoIndex >= item.photoIndex && photoIndex < item.photoIndex + size) {
      return i;
    }
  }
  return items.length > 0 ? items.length - 1 : -1;
}
