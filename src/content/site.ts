import type { FeatureFlagName } from "@/content/features";

/**
 * Editorial and structural content for the 0719 + co. digital wedding home.
 *
 * Facts and voice come from the original rachandzach.com copy. This module is
 * the single source of truth for names, dates, navigation, and the weekend
 * story. Do not add URLs, vendors, playlist names, marathon details, or
 * donation totals here; those arrive with their own packets.
 */

export interface NavigationItem {
  /** Visible label in the site navigation. */
  label: string;
  /** Internal route. Always a real path, never a placeholder, even when disabled. */
  href: string;
  /** Whether the item renders in navigation today. */
  enabled: boolean;
  /**
   * Feature flag that owns a disabled item. Components must hide flagged
   * items entirely while the flag is off; never render a placeholder link.
   */
  flag?: FeatureFlagName;
}

export interface WeekendEventContent {
  /** Stable identifier for anchors and keys. */
  id: string;
  /** Event title as guests knew it. */
  title: string;
  /** Human-readable date, e.g. "Friday, July 18, 2025". */
  dateLabel: string;
  /** ISO date for sorting and grouping. */
  dateISO: string;
  /** Human-readable time span. Empty string when the timeline covers it. */
  timeLabel: string;
  /** Venue name. */
  venue: string;
  /** Street address lines, when known. */
  addressLines?: string[];
  /** One warm sentence or two telling this part of the weekend story. */
  description: string;
}

export interface SiteVoice {
  /** Small line above the hero title. */
  eyebrow: string;
  /** The hero headline. Leads with Rachel and Zach. */
  heroTitle: string;
  /** The hero body copy. */
  heroBody: string;
  /** Introduction for the photo gallery. */
  galleryIntro: string;
  /** Introduction for the guest upload (Add Yours) flow. */
  uploadIntro: string;
}

export interface PhotographerCredit {
  name: string;
  /** null until Zach supplies the exact URL. Never guess one. */
  instagramUrl: string | null;
  websiteUrl: string | null;
}

export interface SiteConfig {
  names: { primary: string; secondary: string };
  /** Wedding date, ISO. */
  date: string;
  location: string;
  navigation: NavigationItem[];
  weekend: WeekendEventContent[];
  voice: SiteVoice;
  photographer: PhotographerCredit;
}

export const siteConfig: SiteConfig = {
  names: { primary: "Rachel", secondary: "Zach" },
  date: "2025-07-19",
  location: "Santa Barbara, CA",
  photographer: {
    name: "Ali Beck Photo",
    // URLs confirmed by Zach 2026-07-22.
    instagramUrl: "https://www.instagram.com/alibeckphoto/?hl=en",
    websiteUrl: "https://www.alibeck.co/",
  },
  navigation: [
    { label: "Home", href: "/", enabled: true },
    { label: "The Weekend", href: "/weekend", enabled: true },
    { label: "Photos", href: "/photos", enabled: true },
    { label: "My Weekend", href: "/my-weekend", enabled: true },
    { label: "Add Yours", href: "/add-yours", enabled: true },
    { label: "Playlists", href: "/playlists", enabled: false, flag: "playlists" },
    { label: "The Marathon", href: "/marathon", enabled: false, flag: "marathon" },
  ],
  weekend: [
    {
      id: "welcome-party",
      title: "Welcome Party",
      dateLabel: "Friday, July 18, 2025",
      dateISO: "2025-07-18",
      timeLabel: "6:00-9:00 PM",
      venue: "Hotel Californian",
      addressLines: ["36 State St.", "Santa Barbara, CA"],
      description:
        "We eased into the weekend by the water at Hotel Californian. Everyone came hungry and thirsty, dinner and drinks were served, and nobody treated it like a formal sit-down dinner.",
    },
    {
      id: "wedding",
      title: "The Wedding",
      dateLabel: "Saturday, July 19, 2025",
      dateISO: "2025-07-19",
      timeLabel: "Shuttles at 3:30 PM, ceremony at 4:30 PM",
      venue: "Rincon Pergola",
      description:
        "Shuttles rolled out at 3:30 PM, and everyone rode them. Yes, even you. The ceremony began at 4:30 PM outdoors with Santa Barbara views, then cocktail hour, dinner, and dancing carried us to 10:00 PM.",
    },
    {
      id: "after-party",
      title: "After Party",
      dateLabel: "Saturday, July 19, 2025",
      dateISO: "2025-07-19",
      timeLabel: "10:30 PM-12:45 AM, give or take",
      venue: "Studio Sound Room",
      addressLines: ["28 Anacapa St, Unit C", "Santa Barbara, CA 93109"],
      description:
        "When Santa Barbara's sound ordinances kicked in at 10 PM, the celebration moved to Studio Sound Room, a beach bungalow bar in the Funk Zone, with more BPM and less personal space than the reception.",
    },
    {
      id: "sunday-hang",
      title: "Sunday Hang",
      dateLabel: "Sunday, July 20, 2025",
      dateISO: "2025-07-20",
      timeLabel: "9:00-11:00 AM",
      venue: "Municipal Winemakers",
      addressLines: ["22 Anacapa Street", "Santa Barbara, CA 93101"],
      description:
        "Breakfast burritos, acai bowls, coffee, and wine at one of our favorite spots as we shared one last laugh, hug, and kiss before the weekend ended.",
    },
  ],
  voice: {
    eyebrow: "July 19, 2025 · Santa Barbara, CA",
    heroTitle: "Rachel & Zach",
    heroBody:
      "We got married in Santa Barbara, surrounded by all of our favorite people in one of our favorite places. We are still not over it.",
    galleryIntro:
      "Every photo from the weekend, from the coast to the dance floor, with happy tears and plenty of evidence in between.",
    uploadIntro:
      "We want the weekend the way you saw it. If your camera roll survived the dance floor, add your photos here and we will fold them into the collection.",
  },
};
