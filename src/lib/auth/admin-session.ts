/**
 * Admin authentication (packet 04).
 *
 * Admin access rides Supabase Auth magic links, entirely separate from the
 * shared guest session: a valid guest cookie never grants admin access, and
 * an admin needs no guest cookie. The allowlist is an exact lowercase email
 * list containing only the wedding admin address.
 *
 * requireAdmin() must be called in every /admin server component tree and
 * every /api/admin route handler. The proxy only performs a cheap structural
 * gate (a Supabase auth cookie must exist); this function is the real check.
 */
import { createServerClient } from "@/lib/supabase/server";
import { isOpenAccess } from "@/lib/auth/open-access";

export const ADMIN_EMAIL_ALLOWLIST = ["wedding@rachandzach.com"] as const;

export type AdminEmail = (typeof ADMIN_EMAIL_ALLOWLIST)[number];

/** The caller is not the allowed admin. Handlers map status to the response. */
export class AdminAccessError extends Error {
  readonly status: 401 | 403;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "AdminAccessError";
    this.status = status;
  }
}

/** Exact lowercase allowlist check. */
export function isAdminEmail(
  email: string | null | undefined,
): email is AdminEmail {
  if (typeof email !== "string") return false;
  return (ADMIN_EMAIL_ALLOWLIST as readonly string[]).includes(
    email.trim().toLowerCase(),
  );
}

/**
 * Resolves the current Supabase user and enforces the admin allowlist.
 * Throws AdminAccessError with status 401 (not signed in) or 403 (signed in
 * but not the admin). Never consults the guest session.
 */
export async function requireAdmin(): Promise<{
  userId: string;
  email: AdminEmail;
}> {
  // Open-access mode: see src/lib/auth/open-access.ts, which requires
  // VERCEL_ENV !== "production" as well as the flag, so this bypass is
  // structurally unreachable in production even if the variable is copied
  // there. While on, anyone reaching /admin can rename, hide or remove guests
  // and moderate uploads against the LIVE database.
  if (isOpenAccess()) {
    return { userId: "open-access", email: ADMIN_EMAIL_ALLOWLIST[0] };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    throw new AdminAccessError("Admin access requires authentication.", 401);
  }
  const email = data.user.email?.trim().toLowerCase();
  if (!isAdminEmail(email)) {
    throw new AdminAccessError(
      "This account is not allowed to administer the gallery.",
      403,
    );
  }
  return { userId: data.user.id, email };
}
