/**
 * Build the read-only/additive live sync plan without opening a network
 * connection. Kept separate so the name/merge guards are unit-testable.
 */
export function planLiveCatalogSync(
  state,
  { attendance, reviewedTags, personMerges },
) {
  const peopleBySlug = new Map(state.people.map((row) => [row.slug, row]));
  const overridesBySlug = new Map(
    state.overrides.map((row) => [row.person_slug, row]),
  );
  const photosByHash = new Map(
    state.photos.map((row) => [row.image_data_hash, row]),
  );
  const joinKeys = new Set(
    state.joins.map((row) => `${row.photo_id}:${row.person_id}`),
  );

  const effectiveNameOverrides = [];
  const hiddenNameOverrides = [];
  const peopleToAdd = [];
  for (const attendee of attendance.attendees) {
    const existing = peopleBySlug.get(attendee.personSlug);
    if (existing) {
      const override = overridesBySlug.get(attendee.personSlug);
      const overrideName = override?.display_name;
      // A hidden duplicate is not a guest-facing rename. Validate its stable
      // catalog identity instead; the override can retain an administrative
      // label explaining which visible record superseded it.
      const effectiveName = override?.hidden
        ? existing.display_name
        : overrideName || existing.display_name;
      if (effectiveName !== attendee.displayName) {
        throw new Error(
          `Live effective name mismatch for ${attendee.personSlug}: ` +
            `${effectiveName} != ${attendee.displayName} ` +
            `(base: ${existing.display_name}, override: ${overrideName ?? "none"})`,
        );
      }
      if (existing.display_name !== effectiveName) {
        effectiveNameOverrides.push({
          slug: attendee.personSlug,
          baseDisplayName: existing.display_name,
          effectiveDisplayName: effectiveName,
        });
      } else if (override?.hidden && overrideName && overrideName !== existing.display_name) {
        hiddenNameOverrides.push({
          slug: attendee.personSlug,
          baseDisplayName: existing.display_name,
          hiddenOverrideDisplayName: overrideName,
        });
      }
      continue;
    }
    if (attendee.resolution !== "added") {
      throw new Error(
        `Seating attendee ${attendee.seatingName} resolved as ` +
          `${attendee.resolution}, but ${attendee.personSlug} is missing live`,
      );
    }
    peopleToAdd.push({
      slug: attendee.personSlug,
      displayName: attendee.displayName,
    });
  }

  if (personMerges?.schemaVersion !== 1 || !Array.isArray(personMerges.merges)) {
    throw new Error("Tracked person-merge manifest has an unsupported shape");
  }
  const personMergesPending = [];
  const personMergesAlreadyApplied = [];
  for (const merge of personMerges.merges) {
    const source = peopleBySlug.get(merge.fromSlug);
    const target = peopleBySlug.get(merge.intoSlug);
    if (source && target) {
      personMergesPending.push({
        fromSlug: merge.fromSlug,
        intoSlug: merge.intoSlug,
        sourcePhotoCount: source.photo_count,
        targetPhotoCount: target.photo_count,
      });
    } else if (!source && target) {
      personMergesAlreadyApplied.push({
        fromSlug: merge.fromSlug,
        intoSlug: merge.intoSlug,
      });
    } else {
      throw new Error(
        `Tracked person merge ${merge.fromSlug} -> ${merge.intoSlug} references ` +
          `${source ? "a missing target" : "missing live identities"}`,
      );
    }
  }

  const tagsToAdd = [];
  const tagsAlreadyPresent = [];
  for (const addition of reviewedTags.additions) {
    const photo = photosByHash.get(addition.photoId);
    if (!photo || photo.status !== "published") {
      throw new Error(
        `Reviewed tag photo ${addition.photoId} is missing or not published`,
      );
    }
    const person = peopleBySlug.get(addition.personSlug);
    if (!person) {
      // Reviewed face profiles are existing catalog people. A missing one is
      // drift, not an invitation to invent an identity in this phase.
      throw new Error(
        `Reviewed tag person ${addition.personSlug} is missing live`,
      );
    }
    const key = `${photo.id}:${person.id}`;
    const row = {
      photo_id: photo.id,
      person_id: person.id,
      photoHash: addition.photoId,
      personSlug: addition.personSlug,
    };
    if (joinKeys.has(key)) tagsAlreadyPresent.push(row);
    else tagsToAdd.push(row);
  }

  return {
    peopleToAdd,
    effectiveNameOverrides,
    hiddenNameOverrides,
    personMergesPending,
    personMergesAlreadyApplied,
    tagsToAdd,
    tagsAlreadyPresent,
    liveCounts: {
      people: state.people.length,
      overrides: state.overrides.length,
      photos: state.photos.length,
      photoPeople: state.joins.length,
    },
  };
}
