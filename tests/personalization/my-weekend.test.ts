import { beforeEach, describe, expect, it } from "vitest";
import {
  MY_WEEKEND_PREFERENCE_VERSION,
  MyWeekendPreferenceError,
  clearMyWeekendPreference,
  getMyWeekendPreference,
  groupByEvent,
  isValidPersonSlug,
  setMyWeekendPreference,
  type EventGroupable,
} from "@/lib/personalization/my-weekend";

/**
 * Minimal in-memory Storage implementation. Vitest routes tests/**\/*.test.ts
 * to the "node" project (vitest.config.ts), which has no DOM and no
 * `localStorage` global, so every test assigns one of these to
 * `globalThis.localStorage` before exercising the module under test -- the
 * same seam a real browser's localStorage fills in production.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

/** Storage that throws on every access, modeling a private-mode browser. */
class ThrowingStorage implements Storage {
  get length(): number {
    throw new Error("storage disabled");
  }
  clear(): void {
    throw new Error("storage disabled");
  }
  getItem(): string | null {
    throw new Error("storage disabled");
  }
  key(): string | null {
    throw new Error("storage disabled");
  }
  removeItem(): void {
    throw new Error("storage disabled");
  }
  setItem(): void {
    throw new Error("storage disabled");
  }
}

function installStorage(store: Storage | undefined): void {
  (globalThis as { localStorage?: Storage }).localStorage = store;
}

beforeEach(() => {
  installStorage(new MemoryStorage());
});

describe("isValidPersonSlug", () => {
  it("accepts lowercase alphanumeric-and-hyphen slugs", () => {
    expect(isValidPersonSlug("rachel")).toBe(true);
    expect(isValidPersonSlug("best-man-dave")).toBe(true);
    expect(isValidPersonSlug("guest-2")).toBe(true);
  });

  it("rejects empty, uppercase, spaced, or symbol-bearing values", () => {
    expect(isValidPersonSlug("")).toBe(false);
    expect(isValidPersonSlug("Rachel")).toBe(false);
    expect(isValidPersonSlug("rachel zach")).toBe(false);
    expect(isValidPersonSlug("rachel_zach")).toBe(false);
    expect(isValidPersonSlug("<script>")).toBe(false);
    expect(isValidPersonSlug("-leading-hyphen")).toBe(false);
  });

  it("rejects non-string values and oversized slugs", () => {
    expect(isValidPersonSlug(null)).toBe(false);
    expect(isValidPersonSlug(undefined)).toBe(false);
    expect(isValidPersonSlug(42)).toBe(false);
    expect(isValidPersonSlug("a".repeat(121))).toBe(false);
    expect(isValidPersonSlug("a".repeat(120))).toBe(true);
  });
});

describe("select and persist", () => {
  it("returns null before anything is selected", () => {
    expect(getMyWeekendPreference()).toBeNull();
  });

  it("persists the selected person and reads it back with version 1", () => {
    setMyWeekendPreference("rachel");
    const stored = getMyWeekendPreference();
    expect(stored).not.toBeNull();
    expect(stored!.personSlug).toBe("rachel");
    expect(stored!.version).toBe(MY_WEEKEND_PREFERENCE_VERSION);
    expect(typeof stored!.setAt).toBe("string");
    expect(Number.isNaN(Date.parse(stored!.setAt))).toBe(false);
  });

  it("persists across independent reads (survives re-parsing from the raw string)", () => {
    setMyWeekendPreference("best-man-dave");
    expect(getMyWeekendPreference()?.personSlug).toBe("best-man-dave");
    expect(getMyWeekendPreference()?.personSlug).toBe("best-man-dave");
  });
});

describe("change person", () => {
  it("overwrites a previous selection with a new one", () => {
    setMyWeekendPreference("rachel");
    expect(getMyWeekendPreference()?.personSlug).toBe("rachel");

    setMyWeekendPreference("zach");
    expect(getMyWeekendPreference()?.personSlug).toBe("zach");
  });

  it("clearMyWeekendPreference removes the stored selection entirely", () => {
    setMyWeekendPreference("rachel");
    expect(getMyWeekendPreference()).not.toBeNull();

    clearMyWeekendPreference();
    expect(getMyWeekendPreference()).toBeNull();
  });

  it("clearing then selecting a different person works cleanly", () => {
    setMyWeekendPreference("rachel");
    clearMyWeekendPreference();
    setMyWeekendPreference("zach");
    expect(getMyWeekendPreference()?.personSlug).toBe("zach");
  });
});

describe("invalid slug", () => {
  it("throws MyWeekendPreferenceError and does not persist anything", () => {
    expect(() => setMyWeekendPreference("Not A Slug")).toThrow(MyWeekendPreferenceError);
    expect(getMyWeekendPreference()).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(() => setMyWeekendPreference("")).toThrow(MyWeekendPreferenceError);
  });

  it("rejects script-injection-shaped input", () => {
    expect(() => setMyWeekendPreference("<script>alert(1)</script>")).toThrow(
      MyWeekendPreferenceError,
    );
    expect(getMyWeekendPreference()).toBeNull();
  });

  it("a rejected update leaves a prior valid selection untouched", () => {
    setMyWeekendPreference("rachel");
    expect(() => setMyWeekendPreference("bad slug!")).toThrow(MyWeekendPreferenceError);
    expect(getMyWeekendPreference()?.personSlug).toBe("rachel");
  });
});

describe("cleared local storage", () => {
  it("getMyWeekendPreference returns null when storage.clear() wipes everything", () => {
    setMyWeekendPreference("rachel");
    (globalThis.localStorage as Storage).clear();
    expect(getMyWeekendPreference()).toBeNull();
  });

  it("returns null (not a throw) for malformed JSON left in storage", () => {
    globalThis.localStorage!.setItem("rz_my_weekend_v1", "{not json");
    expect(getMyWeekendPreference()).toBeNull();
  });

  it("returns null for a well-formed but wrong-version payload", () => {
    globalThis.localStorage!.setItem(
      "rz_my_weekend_v1",
      JSON.stringify({ personSlug: "rachel", setAt: new Date().toISOString(), version: 2 }),
    );
    expect(getMyWeekendPreference()).toBeNull();
  });

  it("returns null for a payload with an invalid stored slug", () => {
    globalThis.localStorage!.setItem(
      "rz_my_weekend_v1",
      JSON.stringify({ personSlug: "Not Valid", setAt: new Date().toISOString(), version: 1 }),
    );
    expect(getMyWeekendPreference()).toBeNull();
  });

  it("degrades to null, never throws, when no storage surface exists at all (SSR)", () => {
    installStorage(undefined);
    expect(() => getMyWeekendPreference()).not.toThrow();
    expect(getMyWeekendPreference()).toBeNull();
  });

  it("setMyWeekendPreference no-ops (does not throw) with no storage surface", () => {
    installStorage(undefined);
    expect(() => setMyWeekendPreference("rachel")).not.toThrow();
  });

  it("degrades to null, never throws, when storage access itself throws (private mode)", () => {
    installStorage(new ThrowingStorage());
    expect(() => getMyWeekendPreference()).not.toThrow();
    expect(getMyWeekendPreference()).toBeNull();
    expect(() => setMyWeekendPreference("rachel")).not.toThrow();
  });
});

describe("groupByEvent", () => {
  interface Photo extends EventGroupable {
    id: string;
  }

  it("groups photos under their event, preserving first-appearance order", () => {
    const photos: Photo[] = [
      { id: "p1", eventSlug: "ceremony", eventName: "Ceremony" },
      { id: "p2", eventSlug: "reception", eventName: "Reception" },
      { id: "p3", eventSlug: "ceremony", eventName: "Ceremony" },
      { id: "p4", eventSlug: "rehearsal-dinner", eventName: "Rehearsal Dinner" },
      { id: "p5", eventSlug: "reception", eventName: "Reception" },
    ];
    const groups = groupByEvent(photos);
    expect(groups.map((g) => g.eventSlug)).toEqual([
      "ceremony",
      "reception",
      "rehearsal-dinner",
    ]);
    expect(groups[0].photos.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(groups[1].photos.map((p) => p.id)).toEqual(["p2", "p5"]);
    expect(groups[2].photos.map((p) => p.id)).toEqual(["p4"]);
  });

  it("returns an empty array for an empty photo list", () => {
    expect(groupByEvent<Photo>([])).toEqual([]);
  });

  it("carries the event name from the first photo seen for that event", () => {
    const photos: Photo[] = [
      { id: "p1", eventSlug: "ceremony", eventName: "Ceremony" },
      { id: "p2", eventSlug: "ceremony", eventName: "Ceremony (stale label)" },
    ];
    const groups = groupByEvent(photos);
    expect(groups).toHaveLength(1);
    expect(groups[0].eventName).toBe("Ceremony");
  });
});
