"use client";

import type { ClientGalleryFacets } from "@/lib/gallery/client-types";
import type { ClientFaceDirectory } from "@/lib/people/face-types";
import { PersonPicker } from "@/components/gallery/PersonPicker";

export interface MyWeekendSetupProps {
  people: ClientGalleryFacets["people"];
  faces: ClientFaceDirectory;
  onSelect: (personSlug: string) => void;
  /** The guest's own name, if they have claimed one. Marks their tile. */
  claimedSlug?: string | null;
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
export function MyWeekendSetup({
  people,
  faces,
  onSelect,
  claimedSlug = null,
}: MyWeekendSetupProps) {
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
        <p className="atlas-kicker">Everyone at the wedding</p>
        <h2 id="person-setup-title">Find yourself, or anyone else.</h2>
        {/*
         * Deliberately invites browsing other people. Tapping a face opens
         * that person's photographs and nothing more -- it does not tell the
         * site who you are, so looking up the couple or your table is free.
         */}
        <p className="atlas-person-setup-intro">
          Tap any face to see their photos, grouped by event.
        </p>
      </div>
      <div className="atlas-person-setup-picker">
        <PersonPicker
          people={people}
          // Marks the guest's own tile if they have claimed one. Purely a
          // "you are here" cue: PersonPicker treats this as the active tile,
          // and tapping any other face still just navigates.
          selected={claimedSlug}
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
