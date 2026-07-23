import { cookies } from "next/headers";
import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Request-scoped Supabase client for Server Components, Route Handlers, and
 * Server Actions. Uses the anon key plus the caller's auth cookies, so it is
 * still subject to RLS (default deny; only packet 04's policies, if any, and
 * signed URLs open doors). Fails closed when configuration is missing.
 */
export async function createServerClient(): Promise<SupabaseClient<Database>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase server client is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. There is no fallback.",
    );
  }

  const cookieStore = await cookies();

  return createSupabaseServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll was called from a Server Component, where cookies are
          // read-only. Session refresh is handled by middleware instead.
        }
      },
    },
  });
}
