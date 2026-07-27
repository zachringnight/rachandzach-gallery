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
 * insert, upsert-on-person_slug, delete/eq, and the
 * rachandzach_remove_added_person RPC (whose reference-checking semantics
 * the fake mirrors; the REAL atomicity lives in the migration and is pinned
 * by tests/database/schema.test.ts plus the live suite in
 * tests/admin/remove-person-live.test.ts). The point of these tests is the
 * REMOVE SEMANTICS -- an added person with photo links OR person-keyed
 * favorites must degrade to a soft hide, never a cascade delete or a
 * stranded shortlist -- plus the add-order invariant (catalog row first)
 * and the design rule that removePerson itself never deletes from
 * rachandzach_people (only the atomic RPC may).
 */
type Row = Record<string, unknown>;

interface FakeStore {
  tables: Map<string, Row[]>;
  failNextInsert: string | null;
  /** Tables that a FakeQuery delete (NOT the rpc) actually ran against. */
  clientDeletes: string[];
}

function makeStore(seed: Record<string, Row[]>): FakeStore {
  return {
    tables: new Map(Object.entries(seed).map(([k, v]) => [k, [...v]])),
    failNextInsert: null,
    clientDeletes: [],
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
      this.store.clientDeletes.push(this.table);
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

/**
 * Fake of the rachandzach_remove_added_person RPC with the same observable
 * semantics as the migration: delete both rows only when the person is
 * added AND has zero photo links AND zero person-keyed favorites; report
 * 'kept' otherwise, 'missing' when there is no catalog row. Atomicity
 * cannot be faked here; it is proven against the real database instead.
 */
function fakeRemoveAddedPersonRpc(
  store: FakeStore,
  slug: string,
): { data: string | null; error: { message: string } | null } {
  const people = store.tables.get("rachandzach_people") ?? [];
  const person = people.find((row) => row.slug === slug);
  if (!person) return { data: "missing", error: null };
  const overrides = store.tables.get("rachandzach_person_overrides") ?? [];
  const added = overrides.some(
    (row) => row.person_slug === slug && row.added === true,
  );
  const linked = (store.tables.get("rachandzach_photo_people") ?? []).some(
    (row) => row.person_id === person.id,
  );
  const favorited = (
    store.tables.get("rachandzach_guest_favorites") ?? []
  ).some((row) => row.owner_kind === "person" && row.owner_key === slug);
  if (!added || linked || favorited) return { data: "kept", error: null };
  store.tables.set(
    "rachandzach_person_overrides",
    overrides.filter((row) => row.person_slug !== slug),
  );
  store.tables.set(
    "rachandzach_people",
    people.filter((row) => row.slug !== slug),
  );
  return { data: "deleted", error: null };
}

function fakeClient(store: FakeStore) {
  return {
    from: (table: string) => new FakeQuery(store, table),
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name !== "rachandzach_remove_added_person") {
        return Promise.resolve({
          data: null,
          error: { message: `unknown rpc: ${name}` },
        });
      }
      return Promise.resolve(
        fakeRemoveAddedPersonRpc(store, String(args.p_slug)),
      );
    },
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
  function addedPersonStore(links: Row[], favorites: Row[] = []): FakeStore {
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
      rachandzach_guest_favorites: favorites,
    });
  }

  it("deletes an added person nothing references (both rows)", async () => {
    const store = addedPersonStore([]);
    const outcome = await removePerson("aunt-carol", ACTOR, fakeClient(store));
    expect(outcome).toBe("deleted");
    expect(store.tables.get("rachandzach_people")).toHaveLength(0);
    expect(store.tables.get("rachandzach_person_overrides")).toHaveLength(0);
    // Design rule: the catalog row may only ever be deleted inside the
    // atomic RPC, never by a client-side statement that raced a check.
    expect(store.clientDeletes).not.toContain("rachandzach_people");
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
    expect(store.clientDeletes).not.toContain("rachandzach_people");
  });

  it("hides an added person whose slug holds guest favorites, keeping the shortlist reachable", async () => {
    // Zero photo tags is NOT enough to delete: a guest who claimed this
    // person on Find me stores their favorites under the slug, and deleting
    // the catalog row would strand that shortlist forever.
    const store = addedPersonStore(
      [],
      [
        {
          owner_kind: "person",
          owner_key: "aunt-carol",
          photo_id: "photo-9",
          created_at: "2026-07-26T00:00:00.000Z",
        },
      ],
    );
    const outcome = await removePerson("aunt-carol", ACTOR, fakeClient(store));
    expect(outcome).toBe("hidden");
    expect(store.tables.get("rachandzach_people")).toHaveLength(1);
    expect(store.tables.get("rachandzach_guest_favorites")).toHaveLength(1);
    const override = store.tables.get("rachandzach_person_overrides")![0];
    expect(override).toMatchObject({ person_slug: "aunt-carol", hidden: true });
    expect(store.clientDeletes).not.toContain("rachandzach_people");
  });

  it("ignores session-keyed favorites that merely share the slug string", async () => {
    // Only owner_kind = 'person' rows gate deletion; a session key equal to
    // the slug is a different owner space.
    const store = addedPersonStore(
      [],
      [
        {
          owner_kind: "session",
          owner_key: "aunt-carol",
          photo_id: "photo-9",
          created_at: "2026-07-26T00:00:00.000Z",
        },
      ],
    );
    const outcome = await removePerson("aunt-carol", ACTOR, fakeClient(store));
    expect(outcome).toBe("deleted");
    expect(store.tables.get("rachandzach_people")).toHaveLength(0);
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
