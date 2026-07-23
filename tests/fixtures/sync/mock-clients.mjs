// Packet 13 test doubles: in-memory Supabase storage and database clients.
//
// These mirror only the exact API surface the sync scripts use (verified in
// docs/plans/2026-07-22-0719-digital-wedding-home/spikes/platform-apis.md):
//   storage: from(bucket).upload(path, body, opts) / .info(path) / .list(prefix)
//   db:      from(table).upsert(rows,{onConflict}).select(cols)
//            from(table).select(cols,{count,head}).eq()/.in()
//            from(table).update(patch).eq()
// No network anywhere. Every call is recorded for assertions.

function bodyToBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  throw new Error(`Mock storage received an unsupported body type: ${typeof body}`);
}

/**
 * @param {object} [config]
 * @param {Record<string, {bytes:number, metadata:object, contentType?:string}>} [config.preloaded]
 *   Remote objects that already exist, keyed by `${bucket}/${path}`.
 * @param {Set<string>|string[]} [config.failUploads] keys that fail with a 500-style error.
 */
export function createMockStorage(config = {}) {
  const objects = new Map();
  const failUploads = new Set(config.failUploads ?? []);
  for (const [key, value] of Object.entries(config.preloaded ?? {})) {
    objects.set(key, {
      bytes: value.bytes,
      metadata: value.metadata ?? {},
      contentType: value.contentType ?? "application/octet-stream",
      cacheControl: value.cacheControl ?? "no-cache",
    });
  }
  const calls = [];

  function from(bucket) {
    return {
      async upload(path, body, options = {}) {
        const key = `${bucket}/${path}`;
        calls.push({ op: "upload", bucket, path, options: { ...options, body: undefined } });
        if (failUploads.has(key)) {
          return {
            data: null,
            error: { message: "simulated storage outage", status: 500, statusCode: "500" },
          };
        }
        if (objects.has(key) && options.upsert !== true) {
          // Matches the storage server's KeyAlreadyExists contract.
          return {
            data: null,
            error: { message: "The resource already exists", status: 409, statusCode: "409" },
          };
        }
        const buffer = bodyToBuffer(body);
        objects.set(key, {
          bytes: buffer.byteLength,
          metadata: options.metadata ?? {},
          contentType: options.contentType ?? "application/octet-stream",
          cacheControl: options.cacheControl ?? "no-cache",
        });
        return { data: { id: key, path, fullPath: key }, error: null };
      },

      async info(path) {
        const key = `${bucket}/${path}`;
        calls.push({ op: "info", bucket, path });
        const object = objects.get(key);
        if (!object) {
          return { data: null, error: { message: "Object not found", status: 404, statusCode: "404" } };
        }
        return {
          data: {
            name: path,
            size: object.bytes,
            contentType: object.contentType,
            cacheControl: object.cacheControl,
            metadata: object.metadata,
          },
          error: null,
        };
      },

      async list(prefix, options = {}) {
        calls.push({ op: "list", bucket, prefix, options });
        const normalized = prefix ? `${prefix.replace(/\/$/, "")}/` : "";
        const names = new Set();
        for (const key of objects.keys()) {
          if (!key.startsWith(`${bucket}/`)) continue;
          const path = key.slice(bucket.length + 1);
          if (!path.startsWith(normalized)) continue;
          const remainder = path.slice(normalized.length);
          names.add(remainder.split("/")[0]);
        }
        const limit = options.limit ?? 100;
        const offset = options.offset ?? 0;
        const data = [...names].sort().slice(offset, offset + limit).map((name) => ({ name }));
        return { data, error: null };
      },
    };
  }

  return {
    client: { storage: { from } },
    objects,
    calls,
    uploadCount: () => calls.filter((call) => call.op === "upload").length,
    networkWrites: () => calls.filter((call) => call.op === "upload").length,
  };
}

let mockIdCounter = 0;
function nextMockId() {
  mockIdCounter += 1;
  return `00000000-0000-4000-8000-${String(mockIdCounter).padStart(12, "0")}`;
}

const TABLES_WITH_ID = new Set([
  "rachandzach_events",
  "rachandzach_people",
  "rachandzach_photos",
]);

/**
 * Minimal relational mock. Rows live in Maps keyed by their conflict key.
 * @param {object} [config]
 * @param {Array<{table:string, op:"upsert"|"select"|"update", times?:number}>} [config.failures]
 */
export function createMockDatabase(config = {}) {
  const tables = new Map();
  const calls = [];
  const failures = (config.failures ?? []).map((failure) => ({ ...failure, remaining: failure.times ?? 1 }));

  function tableRows(name) {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  }

  function takeFailure(table, op) {
    const failure = failures.find(
      (candidate) => candidate.table === table && candidate.op === op && candidate.remaining > 0,
    );
    if (!failure) return null;
    failure.remaining -= 1;
    return { message: `simulated ${op} failure on ${table}`, code: "MOCK" };
  }

  function matches(row, filters) {
    return filters.every((filter) =>
      filter.kind === "eq" ? row[filter.column] === filter.value : filter.values.includes(row[filter.column]),
    );
  }

  function from(table) {
    return {
      upsert(rows, options = {}) {
        const list = Array.isArray(rows) ? rows : [rows];
        const onConflict = (options.onConflict ?? "id").split(",").map((s) => s.trim());
        const run = () => {
          calls.push({ op: "upsert", table, count: list.length, onConflict });
          const error = takeFailure(table, "upsert");
          if (error) return { data: null, error };
          const stored = tableRows(table);
          const affected = [];
          for (const row of list) {
            const existing = stored.find((candidate) =>
              onConflict.every((column) => candidate[column] === row[column]),
            );
            if (existing) {
              Object.assign(existing, row);
              affected.push(existing);
            } else {
              const inserted = { ...row };
              if (TABLES_WITH_ID.has(table) && inserted.id === undefined) {
                inserted.id = nextMockId();
              }
              stored.push(inserted);
              affected.push(inserted);
            }
          }
          return { data: affected.map((row) => ({ ...row })), error: null };
        };
        return {
          select() {
            return Promise.resolve(run());
          },
          then(resolve, reject) {
            const result = run();
            return Promise.resolve({ data: null, error: result.error }).then(resolve, reject);
          },
        };
      },

      select(...selectArgs) {
        const options = selectArgs[1] ?? {};
        const filters = [];
        const builder = {
          eq(column, value) {
            filters.push({ kind: "eq", column, value });
            return builder;
          },
          in(column, values) {
            filters.push({ kind: "in", column, values });
            return builder;
          },
          then(resolve, reject) {
            calls.push({ op: "select", table, options, filters: [...filters] });
            const error = takeFailure(table, "select");
            if (error) {
              return Promise.resolve({ data: null, count: null, error }).then(resolve, reject);
            }
            const rows = tableRows(table).filter((row) => matches(row, filters));
            const result = options.head
              ? { data: null, count: rows.length, error: null }
              : { data: rows.map((row) => ({ ...row })), count: options.count ? rows.length : null, error: null };
            return Promise.resolve(result).then(resolve, reject);
          },
        };
        return builder;
      },

      update(patch) {
        const filters = [];
        const builder = {
          eq(column, value) {
            filters.push({ kind: "eq", column, value });
            return builder;
          },
          then(resolve, reject) {
            calls.push({ op: "update", table, filters: [...filters] });
            const error = takeFailure(table, "update");
            if (error) return Promise.resolve({ data: null, error }).then(resolve, reject);
            let updated = 0;
            for (const row of tableRows(table)) {
              if (matches(row, filters)) {
                Object.assign(row, patch);
                updated += 1;
              }
            }
            return Promise.resolve({ data: null, error: null, count: updated }).then(resolve, reject);
          },
        };
        return builder;
      },
    };
  }

  return {
    client: { from },
    tables,
    calls,
    rows: (table) => tableRows(table),
  };
}
