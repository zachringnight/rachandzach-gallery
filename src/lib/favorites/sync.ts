/**
 * Client sync layer for favorites (Favorites v2). The device-local
 * FavoriteStore (store.ts, untouched) remains the source of immediate truth;
 * this module keeps a server copy in step with it via /api/favorites:
 *
 *   * on load: fetch the caller's server favorites and union them into the
 *     local store (never removing local hearts), then push local-only ids up;
 *   * on toggle: the store already updated optimistically; a subscriber here
 *     fires a background PUT (full local list, replace semantics) with one
 *     retry, coalescing rapid toggles into sequential pushes;
 *   * on My Weekend person selection: a PUT with migrateFromSession unions
 *     the session-keyed rows into the person key server-side and the merged
 *     result is unioned back into the local store.
 *
 * Failure policy is strictly silent: offline or erroring APIs leave the
 * local store fully functional and the server copy catches up on the next
 * load. Nothing here throws toward the UI and nothing renders an error.
 *
 * Like store.ts, this file has no "use client" pragma and no DOM-only
 * top-level code: createFavoritesSync() is pure dependency injection
 * (mockable store + fetch + person-slug reader) for the node test project,
 * and only the ensureFavoritesSync()/migrateFavoritesToPerson() app
 * singletons touch browser globals, defensively.
 */
import { favoriteStore, type FavoriteStore } from "./store";
import { getMyWeekendPreference } from "@/lib/personalization/my-weekend";

export const FAVORITES_API_PATH = "/api/favorites";

interface FavoritesApiResponse {
  photoIds: string[];
}

export interface FavoritesSyncOptions {
  store: FavoriteStore;
  /** Injectable for tests. Defaults to the global fetch. */
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Injectable for tests. Defaults to the stored My Weekend preference. */
  getPersonSlug?: () => string | null;
}

export interface FavoritesSync {
  /** GET server favorites, union into the store, push local-only ids up. */
  load(): Promise<void>;
  /** PUT the full local list (replace semantics on the server). */
  push(): Promise<void>;
  /** PUT with migrateFromSession: session rows union into the person key. */
  migrateToPerson(personSlug: string): Promise<void>;
  /** Begin syncing: subscribes to the store and runs an initial load().
   *  Returns an unsubscribe function. */
  start(): () => void;
}

function parseApiResponse(value: unknown): FavoritesApiResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { photoIds?: unknown };
  if (!Array.isArray(candidate.photoIds)) return null;
  return {
    photoIds: candidate.photoIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    ),
  };
}

export function createFavoritesSync(
  options: FavoritesSyncOptions,
): FavoritesSync {
  const { store } = options;
  const fetchFn =
    options.fetchFn ??
    ((input: string, init?: RequestInit) => fetch(input, init));
  const getPersonSlug =
    options.getPersonSlug ??
    (() => getMyWeekendPreference()?.personSlug ?? null);

  /** True while server ids are being toggled into the store, so the store
   *  subscription does not mistake them for guest edits and push them back. */
  let applyingRemote = false;
  let pushing = false;
  let pushQueued = false;

  /** One request with one retry (network failure or non-ok response alike).
   *  Anything still failing resolves to null; callers move on silently. */
  async function request(
    input: string,
    init?: RequestInit,
  ): Promise<FavoritesApiResponse | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchFn(input, init);
        if (!response.ok) continue;
        return parseApiResponse(await response.json());
      } catch {
        // Offline, aborted, or malformed JSON: fall through to the retry.
      }
    }
    return null;
  }

  function unionIntoStore(ids: string[]): void {
    applyingRemote = true;
    try {
      for (const id of ids) {
        if (!store.has(id)) store.toggle(id);
      }
    } finally {
      applyingRemote = false;
    }
  }

  async function putList(body: {
    photoIds: string[];
    person?: string;
    migrateFromSession?: boolean;
  }): Promise<FavoritesApiResponse | null> {
    return request(FAVORITES_API_PATH, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function push(): Promise<void> {
    // Coalesce: one PUT in flight at a time; toggles during a push mark it
    // dirty and the loop sends one more with the then-current list.
    if (pushing) {
      pushQueued = true;
      return;
    }
    pushing = true;
    try {
      do {
        pushQueued = false;
        const person = getPersonSlug();
        await putList({
          photoIds: store.list(),
          ...(person ? { person } : {}),
        });
      } while (pushQueued);
    } finally {
      pushing = false;
    }
  }

  async function load(): Promise<void> {
    const person = getPersonSlug();
    const query = person ? `?person=${encodeURIComponent(person)}` : "";
    const result = await request(`${FAVORITES_API_PATH}${query}`);
    if (!result) return;
    const serverIds = new Set(result.photoIds);
    const hasLocalOnly = store.list().some((id) => !serverIds.has(id));
    unionIntoStore(result.photoIds);
    // Ids hearted before this device ever synced (or while offline) exist
    // locally but not on the server; one push reconciles them.
    if (hasLocalOnly) await push();
  }

  async function migrateToPerson(personSlug: string): Promise<void> {
    const result = await putList({
      photoIds: store.list(),
      person: personSlug,
      migrateFromSession: true,
    });
    if (result) unionIntoStore(result.photoIds);
  }

  function start(): () => void {
    const unsubscribe = store.subscribe(() => {
      if (applyingRemote) return;
      void push();
    });
    void load();
    return unsubscribe;
  }

  return { load, push, migrateToPerson, start };
}

// ---------------------------------------------------------------------------
// App-wide singleton over the app-wide favoriteStore. Client components call
// ensureFavoritesSync() from an effect (FavoriteButton, FavoritesGallery), so
// every surface that renders favorite state -- cards, lightbox, slideshow,
// favorites page -- shares one sync loop. Safe to call anywhere: on the
// server both helpers no-op.
// ---------------------------------------------------------------------------

let appSync: FavoritesSync | null = null;

export function ensureFavoritesSync(): void {
  if (typeof window === "undefined") return;
  if (appSync) return;
  appSync = createFavoritesSync({ store: favoriteStore });
  appSync.start();
}

/**
 * Hook point for My Weekend person selection (MyWeekendClient.handleSelect):
 * fire-and-forget merge of this guest's session-keyed server favorites into
 * their chosen person key.
 */
export function migrateFavoritesToPerson(personSlug: string): void {
  if (typeof window === "undefined") return;
  ensureFavoritesSync();
  void appSync?.migrateToPerson(personSlug);
}
