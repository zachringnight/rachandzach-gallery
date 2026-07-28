"use client";

import type { ClientGalleryFacets } from "@/lib/gallery/client-types";
import type { ClientFaceDirectory } from "@/lib/people/face-types";
import { PersonPicker } from "@/components/gallery/PersonPicker";

export interface MyWeekendSetupProps {
  people: ClientGalleryFacets["people"];
  faces: ClientFaceDirectory;
  onSelect: (personSlug: string) => void;
}

/**
 * First-visit picker: tap a face, land on that person's photos. There is no
 * confirm step -- picking your own name out of a wall of faces is already the
 * decision, and making guests then find a button was the single most-reported
 * friction on this screen.
 *
 * Reuses PersonPicker for the searchable list so the interaction and visual
 * language match the Photos filter exactly. PersonPicker always offers an
 * "Everyone" tile (selected -> null), which is not a valid person here and is
 * simply ignored.
 */
export function MyWeekendSetup({ people, faces, onSelect }: MyWeekendSetupProps) {
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
          Tap your face to open your photos, grouped by event.
        </p>
      </div>
      <div className="atlas-person-setup-picker">
        <PersonPicker
          people={people}
          selected={null}
          onSelect={(slug) => {
            if (slug) onSelect(slug);
          }}
          variant="faces"
          faces={faces}
        />
      </div>
    </section>
  );
}
