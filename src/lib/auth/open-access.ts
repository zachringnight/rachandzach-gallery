/**
 * Open-access mode: the guest password removed and admin reachable without a
 * magic link. Requested by Zach on 2026-07-26 so the guest manager and review
 * queue could actually be used, after confirming what it exposes.
 *
 * TWO conditions, both required, and the second is the important one.
 *
 * `OPEN_ACCESS=1` is the intent. `VERCEL_ENV !== "production"` is the guard:
 * an environment variable is a value that can be copied between Vercel scopes
 * by a routine "copy env to production" action, and the original comment
 * claiming this was preview-only was enforced by nothing but that comment.
 * With this check, setting the variable in Production has no effect at all --
 * the bypass is structurally unreachable there rather than merely unintended.
 *
 * `VERCEL_ENV` is undefined outside Vercel, so local development still honours
 * the flag.
 *
 * While open, everything is public: all 1,721 photographs, the guest face
 * crops, every guest name, each person's /{slug} page, the upload form and
 * signed originals. Admin is worse than open reading -- anyone reaching
 * /admin can rename, hide or remove guests and moderate uploads against the
 * live database.
 *
 * This is temporary. The real cause of the sign-in problem is that no gallery
 * URL sits in the Supabase auth redirect allowlist, so magic links land on a
 * different product. Fix that and delete this module.
 */
export function isOpenAccess(): boolean {
  return (
    process.env.OPEN_ACCESS === "1" && process.env.VERCEL_ENV !== "production"
  );
}
