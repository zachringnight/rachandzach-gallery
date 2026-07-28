/**
 * Guest-page URLs. The catalog slug stays hyphenated (`phil-campbell`) because
 * it is the key for override rows, favorites, saved preferences, and the
 * committed face files at /faces/{slug}.webp. The URL guests are handed is the
 * hyphen-free form (`/philcampbell`), which survives being typed from memory,
 * read aloud, or pasted into a text message.
 *
 * Slugs are `[a-z0-9-]+`, so compacting only ever removes hyphens. Verified
 * collision-free against the live catalog (189 people); a future name that
 * collided would have to differ from an existing one only in hyphenation.
 */

/**
 * Lowercase FIRST, then strip. Catalog slugs are already lowercase, but this
 * also runs on whatever a guest types into the address bar, and these URLs
 * exist precisely to be typed from memory or read off a phone screen. Without
 * the fold, "/PhilCampbell" would have had its capitals deleted rather than
 * lowered -- yielding "hilampbell", matching nobody, and 404ing on a spelling
 * a person could very reasonably use.
 */
export function compactPersonSlug(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function personHref(slug: string): string {
  return `/${compactPersonSlug(slug)}`;
}
