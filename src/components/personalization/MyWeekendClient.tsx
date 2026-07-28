"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientGalleryFacets } from "@/lib/gallery/client-types";
import type { ClientFaceDirectory } from "@/lib/people/face-types";
import {
  clearMyWeekendPreference,
  getMyWeekendPreference,
} from "@/lib/personalization/my-weekend";
import { personHref } from "@/lib/people/person-href";
import { MyWeekendSetup } from "@/components/personalization/MyWeekendSetup";

export interface MyWeekendClientProps {
  /** The picker roster: hidden people out, renames applied. */
  people: ClientGalleryFacets["people"];
  /**
   * Name resolution for a saved selection, hidden people included: hiding
   * is picker-only, so a guest who already chose themselves must keep
   * resolving to their real name even after being hidden from the picker.
   */
  identities: { slug: string; displayName: string }[];
  /** How to draw each face; built server-side, never bundled. */
  faces: ClientFaceDirectory;
}

/**
 * Find me's client half: read the localStorage preference on mount, then
 * either offer the face picker or hand the guest straight to their own page.
 *
 * There is exactly ONE person view now (/{slug}, rendering PersonGalleryClient).
 * This screen used to render a second, near-identical inline copy of the
 * gallery for anyone with a saved preference, so the same guest saw two
 * different-looking versions of "your photos" depending on how they arrived.
 * Now every path lands on the same URL, which is also the one that is safe to
 * bookmark and forward.
 *
 * src/app/(guest)/my-weekend/page.tsx is a Server Component and cannot read
 * localStorage, and the preference is deliberately client-only (no cookie, no
 * server round trip to learn who is asking), so this has to live in a client
 * component.
 */
export function MyWeekendClient({
  people,
  identities,
  faces,
}: MyWeekendClientProps) {
  // undefined = not yet hydrated from localStorage. Deliberately NOT a
  // useState lazy initializer: that would run during SSR too (no real
  // localStorage there -> always null) and again on the client during
  // hydration (the real stored value), producing a hydration mismatch
  // whenever a preference is already set. Resolving it in an effect instead
  // means server and first-client-render markup match exactly (the
  // "Loading your weekend…" placeholder), and the real value only replaces
  // it after hydration completes.
  const [personSlug, setPersonSlug] = useState<string | null | undefined>(undefined);
  const router = useRouter();

  useEffect(() => {
    // Wrapped so the setState call is not a direct synchronous statement in
    // the effect body (react-hooks/set-state-in-effect); behavior is
    // unchanged, still resolved on the same tick after mount.
    void (async () => {
      setPersonSlug(getMyWeekendPreference()?.personSlug ?? null);
    })();
  }, []);

  // Resolve from identities, not the picker roster: a hidden person's saved
  // selection must still resolve to their own name. No identity at all means
  // the saved slug is stale (hidden people ARE in `identities` precisely so
  // they still resolve). The realistic case is a guest who picked an
  // admin-added person before that person was removed; the preference lives
  // only in this browser, so nothing cleaned it up.
  const saved = personSlug
    ? (identities.find((candidate) => candidate.slug === personSlug) ?? null)
    : null;
  const staleSelection = Boolean(personSlug) && saved === null;

  useEffect(() => {
    if (staleSelection) clearMyWeekendPreference();
  }, [staleSelection]);

  /*
   * Tapping a face BROWSES. It does not claim an identity.
   *
   * Guests want to look at photos of other people -- the couple, their table,
   * whoever they spent the night talking to -- and doing that must not
   * silently rewrite who this browser says they are. This used to call
   * setMyWeekendPreference() and migrateFavoritesToPerson() on every tap,
   * which meant opening someone else's photos reassigned your identity AND
   * pushed your saved hearts onto their record server-side (the favorites
   * sync reads this same preference; see getPersonSlug in
   * src/lib/favorites/sync.ts). Browsing is not a claim.
   *
   * Claiming "this is me" now happens deliberately, on the person's own page.
   */
  const handleSelect = useCallback(
    (slug: string) => {
      router.push(personHref(slug));
    },
    [router],
  );

  if (personSlug === undefined) {
    return <p className="atlas-personal-state">Loading the guest list…</p>;
  }

  /*
   * The picker always renders, even for a guest who has already claimed a
   * name. It used to redirect them straight to their own page, which quietly
   * made this route unusable for its other job: finding anybody else.
   * `saved` is passed down only so their own tile can be marked.
   */
  return (
    <MyWeekendSetup
      people={people}
      faces={faces}
      onSelect={handleSelect}
      claimedSlug={saved?.slug ?? null}
    />
  );
}
