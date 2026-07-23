/**
 * My Weekend preference (packet 07). CLIENT-ONLY: no server import, no
 * cookie, no database row. The guest's chosen person stays on their own
 * device in localStorage; nothing here ever calls an API, and no name or
 * slug is ever logged.
 *
 * Storage access goes through `globalThis.localStorage` (never `window.*`)
 * so this module has no DOM dependency: it works unmodified in a browser, is
 * a safe no-op during SSR (no `localStorage` global), and is directly
 * testable under Vitest's plain "node" test project (tests/**\/*.test.ts,
 * per vitest.config.ts) by assigning a small in-memory Storage mock to
 * `globalThis.localStorage` before each test -- no jsdom required.
 */

export const MY_WEEKEND_PREFERENCE_VERSION = 1 as const;

export interface MyWeekendPreference {
  personSlug: string;
  setAt: string;
  version: 1;
}

const STORAGE_KEY = "rz_my_weekend_v1";
/** Same slug shape as rachandzach_people.slug (supabase/migrations/202607220001_gallery_core.sql). */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MAX_SLUG_LENGTH = 120;

/** A caller tried to persist a slug that cannot be a real person slug. */
export class MyWeekendPreferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MyWeekendPreferenceError";
  }
}

function storage(): Storage | null {
  const candidate = (globalThis as { localStorage?: Storage }).localStorage;
  return candidate ?? null;
}

export function isValidPersonSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SLUG_LENGTH &&
    SLUG_PATTERN.test(value)
  );
}

function parsePreference(raw: string): MyWeekendPreference | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== MY_WEEKEND_PREFERENCE_VERSION) return null;
  if (!isValidPersonSlug(candidate.personSlug)) return null;
  if (typeof candidate.setAt !== "string") return null;
  return {
    personSlug: candidate.personSlug,
    setAt: candidate.setAt,
    version: MY_WEEKEND_PREFERENCE_VERSION,
  };
}

/**
 * Reads the stored preference. Returns null when nothing was ever set, the
 * entry was cleared, the data is malformed or from a future/incompatible
 * version, or no storage surface is available at all (SSR, private-mode
 * browsers that throw on access). Never throws.
 */
export function getMyWeekendPreference(): MyWeekendPreference | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  return parsePreference(raw);
}

/**
 * Persists the chosen person slug on this device only. Throws
 * MyWeekendPreferenceError for a malformed slug -- it never silently
 * persists something that could not be a real person slug. When no storage
 * surface exists, it no-ops rather than erroring (the guest is simply asked
 * to choose again next visit).
 */
export function setMyWeekendPreference(personSlug: string): void {
  if (!isValidPersonSlug(personSlug)) {
    throw new MyWeekendPreferenceError(
      `"${String(personSlug)}" is not a valid person slug.`,
    );
  }
  const store = storage();
  if (!store) return;
  const preference: MyWeekendPreference = {
    personSlug,
    setAt: new Date().toISOString(),
    version: MY_WEEKEND_PREFERENCE_VERSION,
  };
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // Quota exceeded or storage disabled mid-session: degrade silently.
  }
}

/** Clears the stored preference ("not you? change person"). */
export function clearMyWeekendPreference(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Grouping -- pure, no storage dependency. Shared by the server page (for a
// stable read of event order) and MyWeekendGallery (grouping the client-
// fetched, already-weekend-sorted photo list).
// ---------------------------------------------------------------------------

export interface EventGroupable {
  eventSlug: string;
  eventName: string;
}

export interface MyWeekendGroup<T extends EventGroupable> {
  eventSlug: string;
  eventName: string;
  photos: T[];
}

/**
 * Groups photos by event, preserving each event's first-appearance order in
 * the input list. Fed a "weekend"-sorted photo list (task 06's default
 * sort), first-appearance order IS weekend order, so no separate event
 * ordering metadata is needed here.
 */
export function groupByEvent<T extends EventGroupable>(
  photos: T[],
): MyWeekendGroup<T>[] {
  const order: string[] = [];
  const groups = new Map<string, { eventName: string; photos: T[] }>();
  for (const photo of photos) {
    let group = groups.get(photo.eventSlug);
    if (!group) {
      group = { eventName: photo.eventName, photos: [] };
      groups.set(photo.eventSlug, group);
      order.push(photo.eventSlug);
    }
    group.photos.push(photo);
  }
  return order.map((eventSlug) => {
    const group = groups.get(eventSlug)!;
    return { eventSlug, eventName: group.eventName, photos: group.photos };
  });
}
