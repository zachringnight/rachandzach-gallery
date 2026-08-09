/**
 * Supabase magic-link callback for admin sign-in (packet 04).
 *
 * Flow: Supabase emails wedding@rachandzach.com a link; following it lands
 * here with either a PKCE `code` or an email OTP `token_hash`. The exchange
 * sets Supabase auth cookies via the SSR client, then the allowlist is
 * enforced immediately: any authenticated user who is not the wedding admin
 * is signed straight back out.
 *
 * Every failure path returns the same generic redirect so responses never
 * reveal whether the admin account exists. The `next` parameter follows the
 * packet redirect convention: relative paths only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/auth/admin-session";
import { sanitizeNextPath } from "@/lib/auth/guest-session";

export const runtime = "nodejs";

const DEFAULT_DESTINATION = "/admin";

function failure(request: NextRequest): NextResponse {
  // The /enter door this used to land on is gone with the password gate; the
  // home page is the neutral destination now. `error=link` is kept in the URL
  // as the one breadcrumb for an admin whose magic link did not take.
  const url = new URL("/", request.url);
  url.searchParams.set("error", "link");
  return NextResponse.redirect(url, 303);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const nextPath = sanitizeNextPath(params.get("next"), DEFAULT_DESTINATION);

  if (!code && !tokenHash) {
    return failure(request);
  }

  let supabase: Awaited<ReturnType<typeof createServerClient>>;
  try {
    supabase = await createServerClient();
  } catch (error) {
    // Missing Supabase configuration fails closed and loudly.
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json(
      { error: `Admin sign-in is not configured. ${message}` },
      { status: 500 },
    );
  }

  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      type: "email",
      token_hash: tokenHash,
    });
    if (error) return failure(request);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failure(request);
  }

  const { data, error: userError } = await supabase.auth.getUser();
  const email = data?.user?.email;
  if (userError || !data?.user || !isAdminEmail(email)) {
    // Not the admin: revoke the session immediately, answer generically.
    try {
      await supabase.auth.signOut();
    } catch {
      // The generic failure response stands even if sign-out itself fails.
    }
    return failure(request);
  }

  return NextResponse.redirect(new URL(nextPath, request.url), 303);
}
