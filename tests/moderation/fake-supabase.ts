/**
 * Minimal in-memory stand-in for SupabaseClient<Database>, covering exactly
 * the query and storage shapes used by src/lib/moderation/*.ts:
 *
 *   .from(table).select(cols).eq(col, val).maybeSingle()/.single()
 *   .from(table).select(cols).eq(col, val)               (awaited directly -> list)
 *   .from(table).update(patch).eq(col, val).eq(col, val).select().maybeSingle()
 *   .from(table).insert(row)                              (awaited directly)
 *   .from(table).insert(row).select("id").single()
 *   .storage.from(bucket).download(path) / .upload(path, bytes, opts)
 *
 * Deliberately NOT a general Postgrest emulator: every method here mirrors a
 * call shape actually made by the moderation modules, so a mismatch there is
 * a signal the production code changed shape, not a gap in the mock.
 */
import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type Row = Record<string, unknown>;

export interface StorageObject {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * The mock's query-builder chain, typed explicitly (rather than left to
 * inference) so the self-referential "every method returns the builder"
 * shape doesn't need `any` to type-check.
 */
export interface FakeQueryBuilder {
  select(cols?: string): FakeQueryBuilder;
  eq(col: string, val: unknown): FakeQueryBuilder;
  update(patch: Row): FakeQueryBuilder;
  insert(row: Row): FakeQueryBuilder;
  single(): Promise<{ data: Row | null; error: { code: string; message: string } | null }>;
  maybeSingle(): Promise<{ data: Row | null; error: { code: string; message: string } | null }>;
  then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown): Promise<unknown>;
}

export interface FakeDbHandle {
  /** Structurally mimics exactly the SupabaseClient surface the moderation
   * modules call; cast once at construction rather than sprinkling `any`. */
  client: SupabaseClient<Database>;
  tables: Map<string, Row[]>;
  storage: Map<string, Map<string, StorageObject>>;
  inserts: Array<{ table: string; row: Row }>;
  /** Ordered log of insert/upload calls, for asserting "X happened before Y". */
  ops: string[];
  insertHook: (table: string, row: Row) => void | Promise<void>;
  insertErrorHook: (
    table: string,
    row: Row,
  ) =>
    | { code: string; message: string }
    | null
    | Promise<{ code: string; message: string } | null>;
  uploadHook: (bucket: string, path: string) => void | Promise<void>;
}

export interface FakeDbOptions {
  /**
   * table -> list of column-sets that must be unique, mirroring a real
   * Postgres unique index (e.g. rachandzach_notification_log's UNIQUE
   * idempotency_key). A conflicting insert returns a Postgrest-shaped error
   * with code "23505" instead of writing the row, exactly like a live
   * unique-constraint violation.
   */
  unique?: Record<string, string[][]>;
}

function matches(row: Row, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([key, value]) => row[key] === value);
}

let counter = 0;
function generateId(): string {
  counter += 1;
  return `generated-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createFakeDb(
  seed: Record<string, Row[]> = {},
  options: FakeDbOptions = {},
): FakeDbHandle {
  const tables = new Map<string, Row[]>();
  for (const [name, rows] of Object.entries(seed)) {
    tables.set(
      name,
      rows.map((row) => ({ ...row })),
    );
  }
  const storage = new Map<string, Map<string, StorageObject>>();
  const inserts: Array<{ table: string; row: Row }> = [];
  const ops: string[] = [];
  const uniqueConstraints = options.unique ?? {};
  const handle: FakeDbHandle = {
    client: null as unknown as SupabaseClient<Database>,
    tables,
    storage,
    inserts,
    ops,
    insertHook: () => {},
    insertErrorHook: () => null,
    uploadHook: () => {},
  };

  function from(table: string) {
    const filters: Record<string, unknown> = {};
    let mode: "select" | "update" | "insert" = "select";
    let patch: Row = {};
    let insertRow: Row | null = null;

    function currentRows(): Row[] {
      const existing = tables.get(table);
      if (existing) return existing;

      // Keep one canonical array per table. Insert hooks can yield to model
      // genuine concurrent requests; without registering the empty array
      // before that yield, both requests could claim separate arrays and
      // bypass the fake's unique-constraint check.
      const rows: Row[] = [];
      tables.set(table, rows);
      return rows;
    }

    function findUniqueConflict(rows: Row[], candidate: Row): Row | null {
      const constraints = uniqueConstraints[table] ?? [];
      for (const cols of constraints) {
        const conflict = rows.find((row) =>
          cols.every((col) => row[col] === candidate[col]),
        );
        if (conflict) return conflict;
      }
      return null;
    }

    async function resolveOne(): Promise<{
      data: Row | null;
      error: { code: string; message: string } | null;
    }> {
      const rows = currentRows();
      if (mode === "insert" && insertRow) {
        await handle.insertHook(table, insertRow);
        const injectedError = await handle.insertErrorHook(table, insertRow);
        if (injectedError) {
          return { data: null, error: injectedError };
        }
        const conflict = findUniqueConflict(rows, insertRow);
        if (conflict) {
          return {
            data: null,
            error: {
              code: "23505",
              message: `duplicate key value violates unique constraint on ${table}`,
            },
          };
        }
        rows.push(insertRow);
        tables.set(table, rows);
        inserts.push({ table, row: insertRow });
        ops.push(`insert:${table}`);
        return { data: insertRow, error: null };
      }
      if (mode === "update") {
        const idx = rows.findIndex((row) => matches(row, filters));
        if (idx === -1) return { data: null, error: null };
        rows[idx] = { ...rows[idx], ...patch };
        return { data: rows[idx], error: null };
      }
      const found = rows.find((row) => matches(row, filters)) ?? null;
      return { data: found, error: null };
    }

    const api: FakeQueryBuilder = {
      select() {
        return api;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        return api;
      },
      update(p: Row) {
        mode = "update";
        patch = p;
        return api;
      },
      insert(row: Row) {
        mode = "insert";
        insertRow = { id: row.id ?? generateId(), ...row };
        return api;
      },
      single: async () => {
        const result = await resolveOne();
        if (!result.data && !result.error) {
          return { data: null, error: { message: "not found", code: "PGRST116" } };
        }
        return result;
      },
      maybeSingle: async () => await resolveOne(),
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        // Bare `await client.from(table)....` with no terminal call: used
        // for a plain select-list, a plain insert, or a plain update (no
        // `.select()` requested back).
        if (mode === "insert" && insertRow) {
          return resolveOne().then(onFulfilled, onRejected);
        }
        if (mode === "update") {
          const rows = currentRows();
          const updated: Row[] = [];
          for (let i = 0; i < rows.length; i += 1) {
            if (matches(rows[i], filters)) {
              rows[i] = { ...rows[i], ...patch };
              updated.push(rows[i]);
            }
          }
          return Promise.resolve({ data: updated, error: null }).then(
            onFulfilled,
            onRejected,
          );
        }
        const rows = currentRows().filter((row) => matches(row, filters));
        return Promise.resolve({ data: rows, error: null }).then(
          onFulfilled,
          onRejected,
        );
      },
    };
    return api;
  }

  const storageApi = {
    from(bucket: string) {
      if (!storage.has(bucket)) storage.set(bucket, new Map());
      const bucketMap = storage.get(bucket)!;
      return {
        async download(path: string) {
          const object = bucketMap.get(path);
          if (!object) {
            return { data: null, error: { message: "object not found" } };
          }
          const blob = new Blob([object.bytes as unknown as BlobPart]);
          return { data: blob, error: null };
        },
        async upload(
          path: string,
          bytes: Uint8Array,
          opts: { contentType?: string; upsert?: boolean } = {},
        ) {
          await handle.uploadHook(bucket, path);
          if (bucketMap.has(path) && !opts.upsert) {
            return {
              data: null,
              error: { message: `object already exists: ${bucket}/${path}` },
            };
          }
          bucketMap.set(path, {
            bytes: new Uint8Array(bytes),
            contentType: opts.contentType ?? "application/octet-stream",
          });
          ops.push(`upload:${bucket}/${path}`);
          return { data: { path }, error: null };
        },
      };
    },
  };

  handle.client = { from, storage: storageApi } as unknown as SupabaseClient<Database>;
  return handle;
}

/** Convenience no-op actor for tests that don't care about who acted. */
export const TEST_ACTOR = { userId: "admin-user-1", email: "wedding@rachandzach.com" };

export function noopSpy() {
  return vi.fn();
}
