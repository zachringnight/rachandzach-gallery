"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientGalleryFacets } from "@/lib/gallery/client-types";
import type { ClientFaceDirectory } from "@/lib/people/face-types";
import {
  clearMyWeekendPreference,
  getMyWeekendPreference,
  setMyWeekendPreference,
} from "@/lib/personalization/my-weekend";
import { migrateFavoritesToPerson } from "@/lib/favorites/sync";
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
  // selection must still land on their own name. No identity at all means the
  // saved slug is stale, not hidden -- hidden people are in `identities`
  // precisely so they still resolve. The realistic case is a guest who picked
  // an admin-added person before that person was removed; the preference lives
  // only in this browser, so nothing cleaned it up. Sending them on would have
  // pushed them to a route that 404s, so the stale preference is dropped and
  // they get the picker back.
  const saved = personSlug
    ? (identities.find((candidate) => candidate.slug === personSlug) ?? null)
    : null;
  const staleSelection = Boolean(personSlug) && saved === null;

  useEffect(() => {
    if (staleSelection) clearMyWeekendPreference();
  }, [staleSelection]);

  // A returning guest goes straight to their own page rather than to a second
  // rendering of it here. replace(), not push(), so Back leaves the site as
  // the guest expects instead of bouncing off this redirect forever.
  useEffect(() => {
    if (saved) router.replace(personHref(saved.slug));
  }, [saved, router]);

  const handleSelect = useCallback(
    (slug: string) => {
      setMyWeekendPreference(slug);
      // Favorites v2: hearts collected under the anonymous session now belong
      // to this person. Fire-and-forget; failures leave the local store intact
      // and the merge retries on the next selection or sync load.
      migrateFavoritesToPerson(slug);
      router.push(personHref(slug));
    },
    [router],
  );

  if (personSlug === undefined) {
    return <p className="atlas-personal-state">Loading your photos…</p>;
  }

  if (saved) {
    return <p className="atlas-personal-state">Opening your photos…</p>;
  }

  return <MyWeekendSetup people={people} faces={faces} onSelect={handleSelect} />;
}
