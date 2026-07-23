/**
 * In-memory fake for the memories wall, mirroring exactly the call shapes
 * src/lib/memories/server.ts makes (the tests/moderation/fake-supabase.ts
 * philosophy: a mismatch is a signal the production code changed shape, not
 * a gap in the mock). It also implements the rate-limit rpc seam so route
 * tests can drive the fail-closed paths.
 *
 * Fidelity choices that matter to the tests:
 *  - select() returns ONLY the requested columns, like PostgREST. If a
 *    guest-facing query ever asked for owner_key, the leak would surface in
 *    the serialized response assertions.
 *  - insert() enforces the same bounds as the Postgres check constraints
 *    (body 1..500, display_name <= 80, enum checks, photo FK), so "the
 *    database would have rejected this" scenarios are simulated honestly.
 */
import type { RateLimitClient } from "@/lib/auth/rate-limit";
import type { MemoriesDbClient, MemoryInsertRow } from "@/lib/memories/server";

export interface FakeMemoryRow {
  id: string;
  photo_id: string;
  owner_kind: string;
  owner_key: string;
  display_name: string | null;
  body: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}

export type RateLimitBehavior = "allow" | "deny" | "error" | "throw";

export interface FakeMemoriesDb {
  client: MemoriesDbClient & RateLimitClient;
  rows: () => FakeMemoryRow[];
  rpcCalls: () => Array<Record<string, unknown>>;
  setRateLimit: (behavior: RateLimitBehavior) => void;
}

interface SeedMemory {
  photo_id: string;
  body: string;
  status?: string;
  owner_kind?: string;
  owner_key?: string;
  display_name?: string | null;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `${String(idCounter).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
}

export function createFakeMemoriesDb(seed: {
  people?: string[];
  photos?: Array<{ id: string; status: string }>;
  memories?: SeedMemory[];
}): FakeMemoriesDb {
  const people = new Set(seed.people ?? []);
  const photos = new Map((seed.photos ?? []).map((p) => [p.id, p.status]));
  let clock = 0;
  const stamp = () =>
    `2026-07-22T00:00:${String((clock += 1)).padStart(2, "0")}.000Z`;
  const memories: FakeMemoryRow[] = (seed.memories ?? []).map((row) => ({
    id: nextId(),
    photo_id: row.photo_id,
    owner_kind: row.owner_kind ?? "session",
    owner_key: row.owner_key ?? "seed-session",
    display_name: row.display_name ?? null,
    body: row.body,
    status: row.status ?? "pending",
    created_at: stamp(),
    reviewed_at: null,
  }));
  const rpcCalls: Array<Record<string, unknown>> = [];
  let rateLimit: RateLimitBehavior = "allow";

  function pick(row: FakeMemoryRow, columns: string): Record<string, unknown> {
    const wanted = columns.split(",").map((column) => column.trim());
    const out: Record<string, unknown> = {};
    for (const column of wanted) {
      out[column] = row[column as keyof FakeMemoryRow];
    }
    return out;
  }

  function insertViolation(row: MemoryInsertRow): string | null {
    if (!photos.has(row.photo_id)) return "foreign key violation on photo_id";
    if (row.body.length < 1 || row.body.length > 500) {
      return "check constraint violation on body";
    }
    if (row.display_name !== null && row.display_name.length > 80) {
      return "check constraint violation on display_name";
    }
    if (!["session", "person"].includes(row.owner_kind)) {
      return "check constraint violation on owner_kind";
    }
    if (!["pending", "approved", "rejected"].includes(row.status)) {
      return "check constraint violation on status";
    }
    return null;
  }

  function from(table: string) {
    if (table === "rachandzach_people") {
      return {
        select: () => ({
          eq: (_col: string, value: unknown) => ({
            maybeSingle: async () =>
              people.has(String(value))
                ? { data: { slug: value }, error: null }
                : { data: null, error: null },
          }),
        }),
      };
    }
    if (table === "rachandzach_photos") {
      return {
        select: () => ({
          eq: (_idCol: string, id: unknown) => ({
            eq: (_statusCol: string, status: unknown) => ({
              maybeSingle: async () =>
                photos.get(String(id)) === status
                  ? { data: { id }, error: null }
                  : { data: null, error: null },
            }),
          }),
        }),
      };
    }
    if (table === "rachandzach_photo_memories") {
      return {
        select(columns: string) {
          const filters: Partial<Record<"photo_id" | "status", string>> = {};
          const builder = {
            eq(column: "photo_id" | "status", value: string) {
              filters[column] = value;
              return builder;
            },
            order() {
              return builder;
            },
            then(
              onFulfilled: (value: unknown) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) {
              const rows = memories
                .filter((row) =>
                  Object.entries(filters).every(
                    ([column, value]) =>
                      row[column as "photo_id" | "status"] === value,
                  ),
                )
                .sort((a, b) =>
                  a.created_at === b.created_at
                    ? a.id.localeCompare(b.id)
                    : a.created_at.localeCompare(b.created_at),
                )
                .map((row) => pick(row, columns));
              return Promise.resolve({ data: rows, error: null }).then(
                onFulfilled,
                onRejected,
              );
            },
          };
          return builder;
        },
        insert(row: MemoryInsertRow) {
          return {
            select: () => ({
              single: async () => {
                const violation = insertViolation(row);
                if (violation) {
                  return { data: null, error: { message: violation } };
                }
                const stored: FakeMemoryRow = {
                  id: nextId(),
                  photo_id: row.photo_id,
                  owner_kind: row.owner_kind,
                  owner_key: row.owner_key,
                  display_name: row.display_name,
                  body: row.body,
                  status: row.status,
                  created_at: stamp(),
                  reviewed_at: null,
                };
                memories.push(stored);
                return { data: { id: stored.id }, error: null };
              },
            }),
          };
        },
        update(patch: { status: string; reviewed_at: string }) {
          return {
            eq: (_col: string, id: unknown) => ({
              select: () => ({
                maybeSingle: async () => {
                  const row = memories.find((candidate) => candidate.id === id);
                  if (!row) return { data: null, error: null };
                  row.status = patch.status;
                  row.reviewed_at = patch.reviewed_at;
                  return {
                    data: { id: row.id, status: row.status },
                    error: null,
                  };
                },
              }),
            }),
          };
        },
      };
    }
    throw new Error(`fake memories db: unexpected table ${table}`);
  }

  function rpc(fn: string, args: Record<string, unknown>) {
    rpcCalls.push({ fn, ...args });
    if (rateLimit === "throw") {
      return Promise.reject(new Error("rate limit transport down"));
    }
    if (rateLimit === "error") {
      return Promise.resolve({ data: null, error: { message: "rpc failed" } });
    }
    return Promise.resolve({ data: rateLimit === "allow", error: null });
  }

  return {
    client: { from, rpc } as unknown as MemoriesDbClient & RateLimitClient,
    rows: () => memories.map((row) => ({ ...row })),
    rpcCalls: () => [...rpcCalls],
    setRateLimit: (behavior) => {
      rateLimit = behavior;
    },
  };
}
