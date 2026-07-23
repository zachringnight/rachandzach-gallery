/**
 * Guest logout (packet 04). Clears the guest session cookie and returns to
 * the public home page. Needs no configuration and never fails.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  GUEST_SESSION_COOKIE,
  guestSessionCookieOptions,
} from "@/lib/auth/guest-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Cross-origin logout rejected." }, { status: 403 });
  }
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(GUEST_SESSION_COOKIE, "", {
    ...guestSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
