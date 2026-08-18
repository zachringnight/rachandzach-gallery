/**
 * Persist rotated Supabase Auth cookies from the Next.js proxy.
 *
 * createServerClient() in src/lib/supabase/server.ts swallows cookie writes
 * from Server Components. If the proxy only checks that an auth cookie name
 * exists, a refresh token is consumed and then discarded, and the next load
 * 401s. This helper is the write path the server client already assumed
 * existed: call getUser() here, and copy any Set-Cookie values onto the
 * outgoing response.
 *
 * Fail-soft when URL or anon key is missing so guest routes still render in
 * tests and misconfigured deploys. Admin gating is the caller's job.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function applySupabaseAuthRefresh(request: NextRequest): Promise<{
  response: NextResponse;
  hasUser: boolean;
}> {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { response, hasUser: false };
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  try {
    const { data } = await supabase.auth.getUser();
    return { response, hasUser: Boolean(data.user) };
  } catch {
    return { response, hasUser: false };
  }
}

/** Copy cookies from a prior response onto a newly constructed next(). */
export function copyResponseCookies(
  from: NextResponse,
  to: NextResponse,
): NextResponse {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
  return to;
}
