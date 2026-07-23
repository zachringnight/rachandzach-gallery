/**
 * Device-local favorites (packet 09).
 *
 * Favorites live only on the guest's device: no account, no server row, no
 * cross-device sync. State is namespaced under FAVORITES_STORAGE_KEY with a
 * schema version, so a future shape change can detect and discard old data
 * instead of crashing on it. Every storage read/write is wrapped: a browser
 * with storage disabled (private browsing, quota exhausted, blocked by
 * policy) falls back to an in-memory list that lasts for the page session
 * only -- list/has/toggle/clear/subscribe all keep working either way.
 *
 * This file has no "use client" pragma and no DOM-only top-level code, so it
 * is safe to import from a Node test (see tests/favorites/store.test.ts,
 * which runs in vitest's "node" project, not jsdom) and from the server
 * bundle; only getFavoriteStore()/favoriteStore's browser storage probe ever
 * touches `window`, and it does so defensively.
 */

export interface FavoriteStore {
  list(): string[];
  has(photoId: string): boolean;
  toggle(photoId: string): string[];
  clear(): void;
  subscribe(listener: (ids: string[]) => void): () => void;
}

/** Minimal Web Storage-shaped seam so tests can inject a fake or a
 *  throwing implementation without a real browser. */
export interface FavoritesStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const FAVORITES_STORAGE_KEY = "rz_gallery_favorites";
export const FAVORITES_SCHEMA_VERSION = 1;

interface FavoritesPayload {
  v: number;
  ids: unknown;
}

function isFavoritesPayload(value: unknown): value is FavoritesPayload {
  return typeof value === "object" && value !== null && "v" in value;
}

/** Parses and validates persisted JSON, returning [] for anything that is
 *  not exactly today's schema: wrong/missing version, malformed JSON, a
 *  non-array ids field, or non-string/empty/duplicate entries within it. */
function loadIds(storage: FavoritesStorageLike | null): string[] {
  if (!storage) return [];

  let raw: string | null;
  try {
    raw = storage.getItem(FAVORITES_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (
    !isFavoritesPayload(parsed) ||
    parsed.v !== FAVORITES_SCHEMA_VERSION ||
    !Array.isArray(parsed.ids)
  ) {
    return [];
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of parsed.ids) {
    if (typeof id === "string" && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Builds an independent FavoriteStore over the given storage backend, or a
 * pure in-memory list when `storage` is null (unsupported/disabled). Tests
 * use this factory directly with a fake/throwing storage; the app uses the
 * lazily-resolved singleton below.
 */
export function createFavoriteStore(
  storage: FavoritesStorageLike | null,
): FavoriteStore {
  let ids: string[] = loadIds(storage);
  const listeners = new Set<(ids: string[]) => void>();

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(
        FAVORITES_STORAGE_KEY,
        JSON.stringify({ v: FAVORITES_SCHEMA_VERSION, ids }),
      );
    } catch {
      // Storage became unavailable mid-session (quota exceeded, private-mode
      // toggle, policy change). Keep serving the in-memory list; there is
      // simply nothing durable to write it to right now.
    }
  }

  function notify(): void {
    const snapshot = [...ids];
    for (const listener of listeners) listener(snapshot);
  }

  return {
    list() {
      return [...ids];
    },
    has(photoId) {
      return ids.includes(photoId);
    },
    toggle(photoId) {
      ids = ids.includes(photoId)
        ? ids.filter((id) => id !== photoId)
        : [...ids, photoId];
      persist();
      notify();
      return [...ids];
    },
    clear() {
      if (ids.length === 0) return;
      ids = [];
      persist();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Probes window.localStorage and returns it only if a real read/write
 * round-trip succeeds. Safari private browsing (older versions), storage
 * blocked by policy, and quota-exhausted browsers all throw here rather than
 * on first use, so probing up front is what makes the in-memory fallback
 * reliable instead of surprising the guest mid-session.
 */
function resolveBrowserStorage(): FavoritesStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    const probeKey = "__rz_favorites_probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The app-wide favorite store. Every "use client" component should import
 * and use this directly (FavoriteButton, FavoritesGallery, Slideshow); tests
 * should use createFavoriteStore() instead so each test gets an isolated
 * store. Safe to import anywhere: on the server, resolveBrowserStorage()
 * short-circuits to null (typeof window === "undefined") and the store just
 * behaves as in-memory-only for that render.
 */
export const favoriteStore: FavoriteStore = createFavoriteStore(
  resolveBrowserStorage(),
);
