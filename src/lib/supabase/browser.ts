import { createBrowserClient as createSupabaseBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Browser-side Supabase client, bound to the anon key. With RLS in
 * default-deny mode this client cannot read or write any table or bucket
 * directly; it exists for auth session plumbing and for consuming
 * server-minted signed URLs. Fails closed when configuration is missing.
 */
export function createBrowserClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase browser client is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. There is no fallback.",
    );
  }

  return createSupabaseBrowserClient<Database>(url, anonKey);
}
