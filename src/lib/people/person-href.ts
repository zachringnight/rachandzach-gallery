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

export function compactPersonSlug(slug: string): string {
  return slug.replace(/[^a-z0-9]/g, "");
}

export function personHref(slug: string): string {
  return `/${compactPersonSlug(slug)}`;
}
