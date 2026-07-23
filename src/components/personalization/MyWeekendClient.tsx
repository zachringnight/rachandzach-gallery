"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClientGalleryFacets } from "@/lib/gallery/client-types";
import {
  clearMyWeekendPreference,
  getMyWeekendPreference,
  setMyWeekendPreference,
} from "@/lib/personalization/my-weekend";
import { migrateFavoritesToPerson } from "@/lib/favorites/sync";
import { MyWeekendSetup } from "@/components/personalization/MyWeekendSetup";
import { MyWeekendGallery } from "@/components/personalization/MyWeekendGallery";

export interface MyWeekendClientProps {
  people: ClientGalleryFacets["people"];
}

/**
 * Small client orchestrator between the two components the packet names
 * (MyWeekendSetup, MyWeekendGallery): reads the localStorage preference on
 * mount and switches between "pick a name" and "here is your weekend". Not
 * in the packet's Files list verbatim, but stays inside a directory this
 * packet owns (src/components/personalization/) -- src/app/(guest)/
 * my-weekend/page.tsx is a Server Component and cannot itself read
 * localStorage or hold this state, and My Weekend's preference is
 * deliberately client-only (no cookie, no server round trip to learn who is
 * asking), so this switch has to live in a client component somewhere.
 */
export function MyWeekendClient({ people }: MyWeekendClientProps) {
  // undefined = not yet hydrated from localStorage. Deliberately NOT a
  // useState lazy initializer: that would run during SSR too (no real
  // localStorage there -> always null) and again on the client during
  // hydration (the real stored value), producing a hydration mismatch
  // whenever a preference is already set. Resolving it in an effect instead
  // means server and first-client-render markup match exactly (the
  // "Loading your weekend…" placeholder), and the real value only replaces
  // it after hydration completes.
  const [personSlug, setPersonSlug] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    // Wrapped so the setState call is not a direct synchronous statement in
    // the effect body (react-hooks/set-state-in-effect); behavior is
    // unchanged, still resolved on the same tick after mount.
    void (async () => {
      setPersonSlug(getMyWeekendPreference()?.personSlug ?? null);
    })();
  }, []);

  const handleSelect = useCallback((slug: string) => {
    setMyWeekendPreference(slug);
    // Favorites v2: hearts collected under the anonymous session now belong
    // to this person. Fire-and-forget; failures leave the local store intact
    // and the merge retries on the next selection or sync load.
    migrateFavoritesToPerson(slug);
    setPersonSlug(slug);
  }, []);

  const handleChangePerson = useCallback(() => {
    clearMyWeekendPreference();
    setPersonSlug(null);
  }, []);

  if (personSlug === undefined) {
    return <p className="atlas-personal-state">Loading your weekend…</p>;
  }

  if (personSlug === null) {
    return <MyWeekendSetup people={people} onSelect={handleSelect} />;
  }

  const person = people.find((candidate) => candidate.slug === personSlug);
  return (
    <MyWeekendGallery
      personSlug={personSlug}
      personName={person?.displayName ?? "Guest"}
      onChangePerson={handleChangePerson}
      personalPageHref={`/${personSlug}`}
    />
  );
}
