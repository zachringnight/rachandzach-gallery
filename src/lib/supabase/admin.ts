import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { STORAGE_BUCKETS } from "./schema";

/**
 * Service-role Supabase client. SERVER-ONLY.
 *
 * This is the only client allowed to mutate catalog tables and storage
 * objects (approve, reject, move, delete). It bypasses RLS, so it must never
 * be created in, imported into, or serialized toward browser code, and the
 * service-role key must never appear in NEXT_PUBLIC_* variables.
 *
 * Fails closed: missing configuration throws instead of degrading.
 */
export function createAdminClient(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error(
      "createAdminClient() is server-only and must never run in the browser.",
    );
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase admin client is not configured: set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY. There is no fallback.",
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Application-layer overwrite guard, mirroring the database trigger in
 * 202607220002_storage_policies.sql for hosted environments where triggers
 * on storage.objects may be restricted. Call before any admin upload into
 * the immutable buckets.
 */
export function assertNotOverwritingImmutableObject(
  bucket: string,
  objectExists: boolean,
): void {
  const immutable: string[] = [STORAGE_BUCKETS.originals, STORAGE_BUCKETS.previews];
  if (immutable.includes(bucket) && objectExists) {
    throw new Error(
      `Objects in ${bucket} are immutable. Upload under a new content-hash name instead of overwriting.`,
    );
  }
}
