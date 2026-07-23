/**
 * FavoriteStore tests (packet 09): persistence, schema versioning, bad local
 * data, and storage-disabled browsers. Runs in vitest's "node" project (no
 * jsdom, no real window/localStorage), which is exactly why
 * createFavoriteStore() takes an injectable storage backend -- these tests
 * exercise the same code path a browser would use, via fakes.
 */
import { describe, expect, it } from "vitest";
import {
  FAVORITES_SCHEMA_VERSION,
  FAVORITES_STORAGE_KEY,
  createFavoriteStore,
  type FavoritesStorageLike,
} from "@/lib/favorites/store";

class MemoryStorage implements FavoritesStorageLike {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

/** Simulates Safari private browsing / storage blocked by policy: every
 *  call throws, exactly like the real API does in that mode. */
class ThrowingStorage implements FavoritesStorageLike {
  getItem(): string | null {
    throw new DOMException("Storage is not available.", "SecurityError");
  }
  setItem(): void {
    throw new DOMException("Storage is not available.", "SecurityError");
  }
  removeItem(): void {
    throw new DOMException("Storage is not available.", "SecurityError");
  }
}

describe("createFavoriteStore", () => {
  it("starts empty and toggles ids in insertion order", () => {
    const store = createFavoriteStore(new MemoryStorage());
    expect(store.list()).toEqual([]);
    expect(store.has("a")).toBe(false);

    store.toggle("a");
    store.toggle("b");
    expect(store.list()).toEqual(["a", "b"]);
    expect(store.has("a")).toBe(true);
    expect(store.has("z")).toBe(false);

    store.toggle("a"); // remove
    expect(store.list()).toEqual(["b"]);
    expect(store.has("a")).toBe(false);
  });

  it("toggle returns the resulting list", () => {
    const store = createFavoriteStore(new MemoryStorage());
    expect(store.toggle("a")).toEqual(["a"]);
    expect(store.toggle("b")).toEqual(["a", "b"]);
    expect(store.toggle("a")).toEqual(["b"]);
  });

  it("persists across independent store instances sharing the same storage", () => {
    const storage = new MemoryStorage();
    const first = createFavoriteStore(storage);
    first.toggle("photo-1");
    first.toggle("photo-2");

    const second = createFavoriteStore(storage);
    expect(second.list()).toEqual(["photo-1", "photo-2"]);
  });

  it("writes the namespaced key with the current schema version", () => {
    const storage = new MemoryStorage();
    const store = createFavoriteStore(storage);
    store.toggle("photo-1");

    const raw = storage.getItem(FAVORITES_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      v: FAVORITES_SCHEMA_VERSION,
      ids: ["photo-1"],
    });
  });

  it("clear empties the list and persists the empty state", () => {
    const storage = new MemoryStorage();
    const store = createFavoriteStore(storage);
    store.toggle("photo-1");
    store.toggle("photo-2");

    store.clear();
    expect(store.list()).toEqual([]);

    const second = createFavoriteStore(storage);
    expect(second.list()).toEqual([]);
  });

  it("clear on an already-empty store is a harmless no-op (does not notify)", () => {
    const store = createFavoriteStore(new MemoryStorage());
    const seen: string[][] = [];
    store.subscribe((ids) => seen.push(ids));
    store.clear();
    expect(seen).toEqual([]);
  });

  it("notifies subscribers on toggle and clear; unsubscribe stops updates", () => {
    const store = createFavoriteStore(new MemoryStorage());
    const seen: string[][] = [];
    const unsubscribe = store.subscribe((ids) => seen.push(ids));

    store.toggle("a");
    store.toggle("b");
    expect(seen).toEqual([["a"], ["a", "b"]]);

    unsubscribe();
    store.toggle("c");
    expect(seen).toEqual([["a"], ["a", "b"]]); // no further pushes
  });

  it("supports multiple independent subscribers", () => {
    const store = createFavoriteStore(new MemoryStorage());
    const seenA: string[][] = [];
    const seenB: string[][] = [];
    store.subscribe((ids) => seenA.push(ids));
    store.subscribe((ids) => seenB.push(ids));

    store.toggle("a");
    expect(seenA).toEqual([["a"]]);
    expect(seenB).toEqual([["a"]]);
  });

  it("ignores a mismatched schema version and starts fresh", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify({ v: FAVORITES_SCHEMA_VERSION + 1, ids: ["x", "y"] }),
    );
    const store = createFavoriteStore(storage);
    expect(store.list()).toEqual([]);
  });

  it("ignores malformed JSON and starts fresh", () => {
    const storage = new MemoryStorage();
    storage.setItem(FAVORITES_STORAGE_KEY, "{not valid json");
    const store = createFavoriteStore(storage);
    expect(store.list()).toEqual([]);
  });

  it("ignores a non-array ids field and starts fresh", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify({ v: FAVORITES_SCHEMA_VERSION, ids: "not-an-array" }),
    );
    const store = createFavoriteStore(storage);
    expect(store.list()).toEqual([]);
  });

  it("ignores a payload missing the version field entirely", () => {
    const storage = new MemoryStorage();
    storage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify({ ids: ["a"] }));
    const store = createFavoriteStore(storage);
    expect(store.list()).toEqual([]);
  });

  it("drops non-string, empty, and duplicate entries from stored data", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify({
        v: FAVORITES_SCHEMA_VERSION,
        ids: ["a", 42, "a", "", null, "b", "b"],
      }),
    );
    const store = createFavoriteStore(storage);
    expect(store.list()).toEqual(["a", "b"]);
  });

  it("works in-memory for the session when storage is null (unsupported)", () => {
    const store = createFavoriteStore(null);
    store.toggle("a");
    store.toggle("b");
    expect(store.list()).toEqual(["a", "b"]);
    expect(store.has("a")).toBe(true);
  });

  it("degrades to in-memory-only when the storage backend throws (private browsing)", () => {
    const store = createFavoriteStore(new ThrowingStorage());
    expect(() => store.toggle("a")).not.toThrow();
    expect(store.list()).toEqual(["a"]);

    // A fresh store over a (still-broken) storage cannot see it: there is
    // nothing durable, by design, not a bug.
    const second = createFavoriteStore(new ThrowingStorage());
    expect(second.list()).toEqual([]);
  });

  it("survives a storage backend whose getItem throws but whose write path does not exist yet", () => {
    // Constructing the store reads storage once; that read itself throwing
    // must not crash construction.
    expect(() => createFavoriteStore(new ThrowingStorage())).not.toThrow();
  });
});
