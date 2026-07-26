"use client";

import { useState } from "react";
import type { ClientGalleryFacets } from "@/lib/gallery/client-types";
import { PersonPicker } from "@/components/gallery/PersonPicker";

export interface MyWeekendSetupProps {
  people: ClientGalleryFacets["people"];
  faceSlugs: readonly string[];
  onSelect: (personSlug: string) => void;
}

/**
 * First-visit picker: choose a confirmed name, then confirm. Reuses task
 * 06's PersonPicker for the searchable list so the interaction and visual
 * language match the Photos filter exactly. PersonPicker always offers an
 * "Everyone" chip (selected -> null); that state simply leaves the confirm
 * button disabled here, since "everyone" is not a valid My Weekend person.
 */
export function MyWeekendSetup({
  people,
  faceSlugs, onSelect }: MyWeekendSetupProps) {
  const [pending, setPending] = useState<string | null>(null);

  if (people.length === 0) {
    return (
      <p className="atlas-personal-state">
        No one has been tagged in photos yet. Check back soon.
      </p>
    );
  }

  return (
    <section className="atlas-person-setup" aria-labelledby="person-setup-title">
      <div className="atlas-person-setup-copy">
        <p className="atlas-kicker">Tell us who you are</p>
        <h2 id="person-setup-title">Your photos, in one place.</h2>
        {/*
         * The page header already says the selection stays private, so this
         * line carries only what it does not: the photographs arrive grouped
         * by event. Two columns of near-identical copy left the picker
         * stranded in a third column beside a tall empty quadrant.
         */}
        <p className="atlas-person-setup-intro">
          Your photos arrive grouped by event.
        </p>
      </div>
      <div className="atlas-person-setup-picker">
        <PersonPicker
          people={people}
          selected={pending}
          onSelect={setPending}
          variant="faces"
          faceSlugs={faceSlugs}
        />
        <button
          type="button"
          disabled={!pending}
          onClick={() => {
            if (pending) onSelect(pending);
          }}
          className="atlas-inline-action disabled:cursor-not-allowed disabled:opacity-40"
        >
          Show my photos
        </button>
      </div>
    </section>
  );
}
