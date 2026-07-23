/**
 * Moment Search client-safe contracts (packet 07; split out during wave 4
 * integration to fix a real `npm run build` failure).
 *
 * Pure, environment-free constants and types shared by the client search UI
 * (src/components/search/MomentSearch.tsx), the search core
 * (src/lib/search/moment-search.ts, which imports and re-exports these so
 * its existing public API is unchanged), and the API route. Nothing here
 * imports "server-only", a Supabase client, or next/headers, so it is safe
 * to import from a Client Component.
 *
 * Why this file exists: Next.js's client/server module-graph analysis treats
 * a module as tainted if it is reachable via ANY import -- including a
 * dynamic import() deferred inside a function body -- from a module that a
 * Client Component imports. moment-search.ts defers its server-only
 * dependencies (src/lib/supabase/admin.ts, src/lib/gallery/supabase-source.ts,
 * src/lib/search/query-embedding.ts) behind dynamic import() specifically so
 * plain Vitest never evaluates them (see that file's "Import hygiene" doc
 * comment) -- that defers *evaluation*, but `next build` still bundles the
 * dynamically-imported chunk into the client graph and fails with a
 * "You're importing a module that depends on 'server-only'" error, because
 * MomentSearch.tsx imported two constants and a type directly from
 * moment-search.ts. Keeping MomentSearch.tsx's import scoped to this leaf
 * file (no edge to moment-search.ts at all) is what actually keeps the
 * client bundle clean. This mirrors the same contracts.ts split already used
 * by src/lib/downloads/contracts.ts and src/lib/uploads/contracts.ts.
 */

/** Mirrors the packet's validation range: 2 to 80 characters. */
export const MOMENT_SEARCH_MIN_QUERY_LENGTH = 2;
export const MOMENT_SEARCH_MAX_QUERY_LENGTH = 80;

export type MomentMatchType = "embedding" | "keyword";
