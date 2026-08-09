/**
 * Admin bypass for non-production environments.
 *
 * This flag used to do two jobs: open the guest archive and open /admin. The
 * first job is gone -- the shared password was removed on 2026-08-09 and the
 * archive is open to everyone, everywhere, flag or no flag. What is left is
 * the second, which is the one that still matters: it lets Zach reach the
 * guest manager and the review queue in preview and locally while the real
 * cause of the sign-in problem is outstanding (no gallery URL sits in the
 * Supabase auth redirect allowlist, so magic links land on a different
 * product). Fix that and delete this module.
 *
 * TWO conditions, both required, and the second is the important one.
 *
 * `OPEN_ACCESS=1` is the intent. `VERCEL_ENV !== "production"` is the guard:
 * an environment variable is a value that can be copied between Vercel scopes
 * by a routine "copy env to production" action, and a comment claiming this
 * was preview-only would be enforced by nothing but that comment. With this
 * check, setting the variable in Production has no effect at all -- the
 * bypass is structurally unreachable there rather than merely unintended.
 *
 * `VERCEL_ENV` is undefined outside Vercel, so local development still honours
 * the flag.
 *
 * While open, anyone reaching /admin can rename, hide or remove guests and
 * moderate uploads against the live database. That is strictly worse than the
 * open reading the whole site now allows, which is why the production guard
 * stays even though the archive itself is no longer secret.
 */
export function isOpenAccess(): boolean {
  return (
    process.env.OPEN_ACCESS === "1" && process.env.VERCEL_ENV !== "production"
  );
}
