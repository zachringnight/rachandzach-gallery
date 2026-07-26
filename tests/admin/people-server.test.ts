import { describe, expect, it, vi } from "vitest";

// people-server.ts is a server-only module; mock the marker exactly as
// tests/people/overrides.test.ts does.
vi.mock("server-only", () => ({}));

import {
  PersonAdminError,
  addPerson,
  removePerson,
} from "@/lib/admin/people-server";

/**
 * Minimal in-memory stand-in for the Supabase query builder, covering only
 * the chains addPerson/removePerson/patchPerson use: select/eq/maybeSingle,
 * head counts, insert, upsert-on-person_slug, and delete/eq. The point of
 * these tests is the REMOVE SEMANTICS -- an added person with photo links
 * must degrade to a soft hide, never a cascade delete -- and the add-order
 * invariant (catalog row first).
 */
type Row = Record<string, unknown>;

interface FakeStore {
  tables: Map<string, Row[]>;
  failNextInsert: string | null;
}

function makeStore(seed: Record<string, Row[]>): FakeStore {
  return {
    tables: new Map(Object.entries(seed).map(([k, v]) => [k, [...v]])),
    failNextInsert: null,
  };
}

const OVERRIDE_DEFAULTS: Row = {
  display_name: null,
  hidden: false,
  added: false,
  face_photo_id: null,
  face_crop_x: null,
  face_crop_y: null,
  face_crop_size: null,
  created_at: "2026-07-26T00:00:00.000Z",
  updated_at: "2026-07-26T00:00:00.000Z",
};

function defaultsFor(table: string): Row {
  return table === "rachandzach_person_overrides"
    ? { ...OVERRIDE_DEFAULTS }
    : {};
}

class FakeQuery {
  private filters: Array<[string, unknown]> = [];
  private mode: "select" | "delete" = "select";
  private result: { error: { code?: string; message: string } | null } | null =
    null;

  constructor(
    private store: FakeStore,
    private table: string,
  ) {}

  private rows(): Row[] {
    const rows = this.store.tables.get(this.table);
    if (!rows) throw new Error(`fake table missing: ${this.table}`);
    return rows;
  }

  private matching(): Row[] {
    return this.rows().filter((row) =>
      this.filters.every(([col, val]) => row[col] === val),
    );
  }

  // Accepts (columns, { count, head }) at runtime; nothing here needs them.
  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  maybeSingle() {
    const match = this.matching();
    return Promise.resolve({ data: match[0] ?? null, error: null });
  }

  insert(values: Row | Row[]) {
    if (this.store.failNextInsert === this.table) {
      this.store.failNextInsert = null;
      this.result = { error: { message: "injected insert failure" } };
      return this;
    }
    const list = Array.isArray(values) ? values : [values];
    for (const value of list) {
      if (
        this.table === "rachandzach_people" &&
        this.rows().some((row) => row.slug === value.slug)
      ) {
        this.result = { error: { code: "23505", message: "duplicate slug" } };
        return this;
      }
      this.rows().push({
        ...defaultsFor(this.table),
        id: `id-${this.table}-${this.rows().length}`,
        ...value,
      });
    }
    this.result = { error: null };
    return this;
  }

  upsert(values: Row, options?: { onConflict?: string }) {
    const key = options?.onConflict ?? "id";
    const existing = this.rows().find((row) => row[key] === values[key]);
    if (existing) Object.assign(existing, values);
    else this.rows().push({ ...defaultsFor(this.table), ...values });
    this.result = { error: null };
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  // Awaiting the chain resolves it: deletes apply, selects return rows and a
  // count (countPersonPhotoLinks awaits select().eq() directly).
  then<T>(
    resolve: (value: {
      data: Row[] | null;
      count: number;
      error: { code?: string; message: string } | null;
    }) => T,
  ) {
    if (this.result) {
      return Promise.resolve(
        resolve({ data: null, count: 0, error: this.result.error }),
      );
    }
    if (this.mode === "delete") {
      const keep = this.rows().filter(
        (row) => !this.filters.every(([col, val]) => row[col] === val),
      );
      this.store.tables.set(this.table, keep);
      return Promise.resolve(resolve({ data: null, count: 0, error: null }));
    }
    const match = this.matching();
    return Promise.resolve(
      resolve({ data: match, count: match.length, error: null }),
    );
  }
}

function fakeClient(store: FakeStore) {
  return {
    from: (table: string) => new FakeQuery(store, table),
  } as unknown as Parameters<typeof addPerson>[3];
}

const ACTOR = "wedding@rachandzach.com";

describe("addPerson", () => {
  it("creates the catalog row and the added-provenance override row", async () => {
    const store = makeStore({
      rachandzach_people: [],
      rachandzach_person_overrides: [],
    });
    await addPerson("aunt-carol", "Aunt Carol", ACTOR, fakeClient(store));

    const person = store.tables.get("rachandzach_people")![0];
    expect(person).toMatchObject({
      slug: "aunt-carol",
      display_name: "Aunt Carol",
    });
    const override = store.tables.get("rachandzach_person_overrides")![0];
    expect(override).toMatchObject({
      person_slug: "aunt-carol",
      display_name: "Aunt Carol",
      added: true,
      updated_by: ACTOR,
    });
  });

  it("rejects a slug already in the catalog with a 409", async () => {
    const store = makeStore({
      rachandzach_people: [
        { id: "p1", slug: "cousin-eddie", display_name: "Cousin Eddie" },
      ],
      rachandzach_person_overrides: [],
    });
    await expect(
      addPerson("cousin-eddie", "Eddie", ACTOR, fakeClient(store)),
    ).rejects.toMatchObject({ name: "PersonAdminError", status: 409 });
  });

  it("removes the catalog row again when the override insert fails", async () => {
    // The one order that must never survive a partial failure is an added
    // override without a catalog row; the compensation path guarantees the
    // leftover is at worst a plain catalog person.
    const store = makeStore({
      rachandzach_people: [],
      rachandzach_person_overrides: [],
    });
    store.failNextInsert = "rachandzach_person_overrides";
    await expect(
      addPerson("aunt-carol", "Aunt Carol", ACTOR, fakeClient(store)),
    ).rejects.toThrow(/Person add failed/);
    expect(store.tables.get("rachandzach_people")).toHaveLength(0);
    expect(store.tables.get("rachandzach_person_overrides")).toHaveLength(0);
  });
});

describe("removePerson", () => {
  function addedPersonStore(links: Row[]): FakeStore {
    return makeStore({
      rachandzach_people: [
        { id: "p1", slug: "aunt-carol", display_name: "Aunt Carol" },
      ],
      rachandzach_person_overrides: [
        {
          ...OVERRIDE_DEFAULTS,
          person_slug: "aunt-carol",
          display_name: "Aunt Carol",
          added: true,
          updated_by: ACTOR,
        },
      ],
      rachandzach_photo_people: links,
    });
  }

  it("deletes an added person nothing is tagged with (both rows)", async () => {
    const store = addedPersonStore([]);
    const outcome = await removePerson("aunt-carol", ACTOR, fakeClient(store));
    expect(outcome).toBe("deleted");
    expect(store.tables.get("rachandzach_people")).toHaveLength(0);
    expect(store.tables.get("rachandzach_person_overrides")).toHaveLength(0);
  });

  it("hides an added person with photo links and touches no tags", async () => {
    // Deleting the catalog row would cascade into rachandzach_photo_people;
    // any link of any confidence must force the soft path.
    const store = addedPersonStore([
      { photo_id: "photo-1", person_id: "p1", confidence: "uncertain" },
    ]);
    const outcome = await removePerson("aunt-carol", ACTOR, fakeClient(store));
    expect(outcome).toBe("hidden");
    expect(store.tables.get("rachandzach_people")).toHaveLength(1);
    expect(store.tables.get("rachandzach_photo_people")).toEqual([
      { photo_id: "photo-1", person_id: "p1", confidence: "uncertain" },
    ]);
    const override = store.tables.get("rachandzach_person_overrides")![0];
    expect(override).toMatchObject({ person_slug: "aunt-carol", hidden: true });
  });

  it("always hides, never deletes, a person the pipeline matched", async () => {
    const store = makeStore({
      rachandzach_people: [
        { id: "p2", slug: "cousin-eddie", display_name: "Cousin Eddie" },
      ],
      rachandzach_person_overrides: [],
      rachandzach_photo_people: [],
    });
    const outcome = await removePerson(
      "cousin-eddie",
      ACTOR,
      fakeClient(store),
    );
    expect(outcome).toBe("hidden");
    expect(store.tables.get("rachandzach_people")).toHaveLength(1);
    const override = store.tables.get("rachandzach_person_overrides")![0];
    expect(override).toMatchObject({
      person_slug: "cousin-eddie",
      hidden: true,
    });
  });

  it("404s for a slug that exists nowhere", async () => {
    const store = makeStore({
      rachandzach_people: [],
      rachandzach_person_overrides: [],
      rachandzach_photo_people: [],
    });
    await expect(
      removePerson("nobody", ACTOR, fakeClient(store)),
    ).rejects.toBeInstanceOf(PersonAdminError);
  });
});
