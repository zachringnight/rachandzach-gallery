"use client";

import { useState } from "react";
import type { ClientGalleryFacets } from "@/lib/gallery/client-types";
import { PersonPicker } from "@/components/gallery/PersonPicker";

export interface MyWeekendSetupProps {
  people: ClientGalleryFacets["people"];
  onSelect: (personSlug: string) => void;
}

/**
 * First-visit picker: choose a confirmed name, then confirm. Reuses task
 * 06's PersonPicker for the searchable list so the interaction and visual
 * language match the Photos filter exactly. PersonPicker always offers an
 * "Everyone" chip (selected -> null); that state simply leaves the confirm
 * button disabled here, since "everyone" is not a valid My Weekend person.
 */
export function MyWeekendSetup({ people, onSelect }: MyWeekendSetupProps) {
  const [pending, setPending] = useState<string | null>(null);

  if (people.length === 0) {
    return (
      <p className="text-sm text-ink/70">
        No one has been tagged in photos yet. Check back soon.
      </p>
    );
  }

  return (
    <div className="max-w-xl">
      <p className="mb-4 text-ink/70">
        Pick your name to see your weekend, grouped by event. Your choice stays on this device
        only. We never send it anywhere.
      </p>
      <PersonPicker people={people} selected={pending} onSelect={setPending} />
      <button
        type="button"
        disabled={!pending}
        onClick={() => {
          if (pending) onSelect(pending);
        }}
        className="mt-4 rounded-md bg-ink px-4 py-2 text-sm font-medium text-cream disabled:cursor-not-allowed disabled:opacity-40"
      >
        Show my weekend
      </button>
    </div>
  );
}
