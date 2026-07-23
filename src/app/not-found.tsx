import NotFound from "@/app/(public)/not-found";

/**
 * Root-level 404. Next.js only serves a not-found file from the root app
 * segment for arbitrary unmatched URLs; a not-found.tsx nested inside a
 * route group (like (public)) only renders for notFound() calls within
 * that group's own tree. This file re-exports the same branded page so
 * any bad URL gets the real site 404 instead of Next's default.
 */
export default NotFound;
