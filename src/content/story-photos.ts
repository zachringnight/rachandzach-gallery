/**
 * Development photo picks for the public site (packet 05).
 *
 * Every pick was chosen from _Metadata/photo-manifest.csv metadata only
 * (event, orientation) plus the three pre-flagged references. Nobody has
 * visually reviewed these composites; treat each one as a stand-in until
 * Zach's end review swaps in or confirms the real hero selects.
 *
 * sourcePath is the output_path inside the read-only wedding master
 * (/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean). The
 * originals are never modified; the src files under public/story/ are small
 * sRGB web derivatives generated with sharp, named with the first 8 chars of
 * the manifest image_data_hash so a swapped pick can never silently reuse a
 * stale derivative.
 *
 * Focal points are the exception to the metadata-only rule: each focal was
 * chosen by eye from the web derivative (design overhaul task 01), sits on
 * the faces or the emotional anchor, and names its anchor in a comment. If a
 * pick is swapped, re-pick its focal by eye too.
 */

export const STORY_PHOTO_APPROVAL = "dev placeholder, pending Zach's visual approval" as const;

export type StoryChapterId = "coast" | "ceremony" | "dinner" | "dancing" | "after-party";

export interface StoryPhotoContent {
  /** Stable identifier, matches the chapter id where applicable. */
  id: string;
  /** output_path in the read-only master manifest. Never a file this app writes. */
  sourcePath: string;
  /** First 8 hex chars of the manifest image_data_hash for this source. */
  imageDataHash: string;
  /** Public web derivative path served by Next. */
  src: string;
  /** Derivative pixel dimensions. */
  width: number;
  height: number;
  /**
   * Event-derived description. Written from manifest metadata, not from
   * looking at the image, so it names the moment rather than its contents.
   */
  alt: string;
  /**
   * Visual anchor as fractions of image width/height, each in [0, 1],
   * chosen by eye on the derivative. Feed to focalObjectPosition so
   * object-cover crops keep the anchor in frame at every viewport.
   */
  focal: { x: number; y: number };
  approval: typeof STORY_PHOTO_APPROVAL;
}

export const storyPhotos: {
  hero: StoryPhotoContent;
  chapters: Record<StoryChapterId, StoryPhotoContent>;
} = {
  hero: {
    id: "hero-sunset",
    sourcePath: "11 Sunset/rachelzach-768.jpg",
    imageDataHash: "a6fa78bb",
    src: "/story/hero-sunset-a6fa78bb.jpg",
    width: 2000,
    height: 1500,
    alt: "Rachel and Zach at sunset on their wedding day in Santa Barbara",
    // Focal: Rachel and Zach's faces, smiling at each other in the upper middle of the frame.
    focal: { x: 0.48, y: 0.21 },
    approval: STORY_PHOTO_APPROVAL,
  },
  chapters: {
    coast: {
      id: "coast",
      sourcePath: "01 Day 1/rachelzachday1-10.jpg",
      imageDataHash: "1dc07dd8",
      src: "/story/coast-1dc07dd8.jpg",
      width: 1600,
      height: 1200,
      alt: "The welcome party by the water at Hotel Californian",
      // Focal: Rachel's face, laughing in white at the center of the group.
      focal: { x: 0.55, y: 0.39 },
      approval: STORY_PHOTO_APPROVAL,
    },
    ceremony: {
      id: "ceremony",
      sourcePath: "05 Ceremony/rachelzach-212.jpg",
      imageDataHash: "b31285ca",
      src: "/story/ceremony-b31285ca.jpg",
      width: 1600,
      height: 1200,
      alt: "The outdoor ceremony at Rincon Pergola",
      // Focal: the guests' faces strung along the bluff at the bottom edge, under the wide sky.
      focal: { x: 0.51, y: 0.89 },
      approval: STORY_PHOTO_APPROVAL,
    },
    dinner: {
      id: "dinner",
      sourcePath: "09 Reception/rachelzach-654.jpg",
      imageDataHash: "32b4c391",
      src: "/story/dinner-32b4c391.jpg",
      width: 1600,
      height: 1067,
      alt: "Dinner at the reception",
      // Focal: Rachel and Zach's faces as they walk hand in hand across the lawn.
      focal: { x: 0.48, y: 0.37 },
      approval: STORY_PHOTO_APPROVAL,
    },
    dancing: {
      id: "dancing",
      sourcePath: "10 Dancing/rachelzach-941.jpg",
      imageDataHash: "57fd10e8",
      src: "/story/dancing-57fd10e8.jpg",
      width: 1067,
      height: 1600,
      alt: "The dance floor in full swing",
      // Focal: the slow-dancing couple's faces, cheek to cheek under the string lights.
      focal: { x: 0.52, y: 0.31 },
      approval: STORY_PHOTO_APPROVAL,
    },
    "after-party": {
      id: "after-party",
      sourcePath: "12 After Party/rachelzach-1164.jpg",
      imageDataHash: "e8e24926",
      src: "/story/after-party-e8e24926.jpg",
      width: 1067,
      height: 1600,
      alt: "The after party at Studio Sound Room in the Funk Zone",
      // Focal: the two friends' faces, arm in arm and beaming.
      focal: { x: 0.47, y: 0.23 },
      approval: STORY_PHOTO_APPROVAL,
    },
  },
};

/**
 * CSS object-position value for a photo's focal point: {x: 0.5, y: 0.32}
 * becomes "50% 32%". Pair with object-cover so any crop stays anchored on
 * the focal point instead of the geometric center.
 */
export function focalObjectPosition(photo: { focal: { x: number; y: number } }): string {
  return `${Math.round(photo.focal.x * 100)}% ${Math.round(photo.focal.y * 100)}%`;
}
