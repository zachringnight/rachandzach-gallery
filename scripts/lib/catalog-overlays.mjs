import { promises as fs } from "node:fs";
import { join } from "node:path";

const PERSON_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ATTENDANCE_PATH = join("metadata", "wedding-attendees.json");
const FACE_TAGS_PATH = join("metadata", "reviewed-face-tag-additions.json");
const FACE_TAG_REMOVALS_PATH = join("metadata", "reviewed-face-tag-removals.json");

function invariant(condition, message) {
  if (!condition) throw new Error(`Catalog overlay invalid: ${message}`);
}

function validateAttendance(manifest) {
  invariant(manifest?.schemaVersion === 1, "attendance schemaVersion must be 1");
  invariant(Array.isArray(manifest.attendees), "attendance attendees must be an array");
  invariant(
    manifest.source?.attendeeCount === manifest.attendees.length,
    "attendance source count does not match attendee rows",
  );

  const seatingNames = new Set();
  const personSlugs = new Set();
  for (const attendee of manifest.attendees) {
    invariant(
      typeof attendee.seatingName === "string" && attendee.seatingName.length > 0,
      "attendee seatingName is required",
    );
    invariant(
      typeof attendee.displayName === "string" && attendee.displayName.length > 0,
      `attendee ${attendee.seatingName} has no displayName`,
    );
    invariant(
      PERSON_SLUG_PATTERN.test(attendee.personSlug),
      `attendee ${attendee.seatingName} has invalid slug ${attendee.personSlug}`,
    );
    invariant(
      ["existing", "alias", "added"].includes(attendee.resolution),
      `attendee ${attendee.seatingName} has invalid resolution`,
    );
    invariant(
      !seatingNames.has(attendee.seatingName),
      `duplicate seating name ${attendee.seatingName}`,
    );
    invariant(
      !personSlugs.has(attendee.personSlug),
      `multiple seating attendees resolve to ${attendee.personSlug}`,
    );
    seatingNames.add(attendee.seatingName);
    personSlugs.add(attendee.personSlug);
  }
}

function validateFaceTags(manifest) {
  invariant(manifest?.schemaVersion === 1, "face-tag schemaVersion must be 1");
  invariant(Array.isArray(manifest.additions), "face-tag additions must be an array");
  invariant(
    manifest.source?.candidatesApproved === manifest.additions.length,
    "face-tag approved count does not match additions",
  );

  const reviewWaves = new Map(
    (manifest.source.reviewWaves ?? []).map((wave) => [wave.wave, wave]),
  );
  const pairs = new Set();
  for (const addition of manifest.additions) {
    const reviewWave =
      addition.reviewWave === undefined
        ? null
        : reviewWaves.get(addition.reviewWave);
    invariant(
      addition.reviewWave === undefined || reviewWave,
      `face-tag ${addition.photoId}/${addition.personSlug} references unknown review wave`,
    );
    invariant(
      typeof addition.photoId === "string" && addition.photoId.length > 0,
      "face-tag photoId is required",
    );
    invariant(
      PERSON_SLUG_PATTERN.test(addition.personSlug),
      `face-tag has invalid slug ${addition.personSlug}`,
    );
    if (addition.confirmationKind === "human-face-naming") {
      // Rachel named this face herself in the local naming session. Like the
      // recurring-cluster kind, it carries no model score because none was
      // used: the evidence is a person who was there saying who it is.
      invariant(
        reviewWave?.manualConfirmation === true,
        `face-tag ${addition.photoId}/${addition.personSlug} is missing a manual-confirmation review wave`,
      );
      invariant(
        addition.faceIndex === null ||
          (Number.isInteger(addition.faceIndex) && addition.faceIndex >= 0),
        `face-tag ${addition.photoId}/${addition.personSlug} has invalid face index`,
      );
      invariant(
        /^[0-9a-f]{64}$/.test(addition.reviewFingerprint),
        `face-tag ${addition.photoId}/${addition.personSlug} has invalid review fingerprint`,
      );
      invariant(
        typeof addition.contextEvidence === "string" &&
          addition.contextEvidence.length >= 20,
        `face-tag ${addition.photoId}/${addition.personSlug} needs human confirmation context`,
      );
    } else if (addition.confirmationKind === "human-recurring-cluster") {
      invariant(
        reviewWave?.manualConfirmation === true,
        `face-tag ${addition.photoId}/${addition.personSlug} is missing a manual-confirmation review wave`,
      );
      invariant(
        /^(z\d{3}|c\d{4})$/.test(addition.clusterId),
        `face-tag ${addition.photoId}/${addition.personSlug} has invalid recurring cluster`,
      );
      invariant(
        Number.isInteger(addition.faceIndex) && addition.faceIndex >= 0,
        `face-tag ${addition.photoId}/${addition.personSlug} has invalid face index`,
      );
      invariant(
        /^[0-9a-f]{64}$/.test(addition.clusterFingerprint),
        `face-tag ${addition.photoId}/${addition.personSlug} has invalid cluster fingerprint`,
      );
      invariant(
        typeof addition.contextEvidence === "string" &&
          addition.contextEvidence.length >= 20,
        `face-tag ${addition.photoId}/${addition.personSlug} needs human confirmation context`,
      );
    } else {
      const minSimilarity =
        reviewWave?.minSimilarity ?? manifest.source.minSimilarity;
      const minMargin = reviewWave?.minMargin ?? manifest.source.minMargin;
      invariant(
        Number.isFinite(addition.similarity) &&
          addition.similarity >= minSimilarity,
        `face-tag ${addition.photoId}/${addition.personSlug} is below similarity threshold`,
      );
      invariant(
        Number.isFinite(addition.margin) &&
          addition.margin >= minMargin,
        `face-tag ${addition.photoId}/${addition.personSlug} is below margin threshold`,
      );
    }
    const key = `${addition.photoId}:${addition.personSlug}`;
    invariant(!pairs.has(key), `duplicate face-tag pair ${key}`);
    pairs.add(key);
  }
}

function validateFaceTagRemovals(manifest, additions) {
  if (manifest === null || manifest === undefined) return;
  invariant(manifest.schemaVersion === 1, "face-tag removal schemaVersion must be 1");
  invariant(Array.isArray(manifest.removals), "face-tag removals must be an array");
  const added = new Set(
    additions.map((a) => `${a.photoId}:${a.personSlug}`),
  );
  const seen = new Set();
  for (const removal of manifest.removals) {
    invariant(
      typeof removal.photoId === "string" && removal.photoId.length > 0,
      "face-tag removal photoId is required",
    );
    invariant(
      PERSON_SLUG_PATTERN.test(removal.personSlug),
      `face-tag removal has invalid slug ${removal.personSlug}`,
    );
    // A removal deletes someone's original tag, so it carries a written
    // reason the same way an addition carries a similarity score.
    invariant(
      typeof removal.reason === "string" && removal.reason.length >= 20,
      `face-tag removal ${removal.photoId}/${removal.personSlug} needs a reviewed reason`,
    );
    const key = `${removal.photoId}:${removal.personSlug}`;
    invariant(!seen.has(key), `duplicate face-tag removal ${key}`);
    invariant(
      !added.has(key),
      `face-tag ${key} is both added and removed; the two lists disagree`,
    );
    seen.add(key);
  }
}

export function applyCatalogOverlays(catalog, attendance, faceTags, faceTagRemovals) {
  validateAttendance(attendance);
  validateFaceTags(faceTags);
  validateFaceTagRemovals(faceTagRemovals, faceTags.additions);
  invariant(Array.isArray(catalog?.people), "catalog people must be an array");
  invariant(Array.isArray(catalog?.photos), "catalog photos must be an array");

  const peopleBySlug = new Map(catalog.people.map((person) => [person.slug, person]));
  let peopleAdded = 0;
  for (const attendee of attendance.attendees) {
    const existing = peopleBySlug.get(attendee.personSlug);
    if (existing) {
      invariant(
        existing.name === attendee.displayName,
        `${attendee.personSlug} name is ${existing.name}, expected ${attendee.displayName}`,
      );
      continue;
    }
    invariant(
      attendee.resolution === "added",
      `${attendee.seatingName} was resolved as ${attendee.resolution} but is missing`,
    );
    const person = {
      slug: attendee.personSlug,
      name: attendee.displayName,
      photoCount: 0,
    };
    catalog.people.push(person);
    peopleBySlug.set(person.slug, person);
    peopleAdded += 1;
  }

  const photosById = new Map();
  for (const photo of catalog.photos) {
    photosById.set(photo.id, photo);
    photosById.set(photo.imageDataHash, photo);
  }
  let faceTagsAdded = 0;
  let faceTagsAlreadyPresent = 0;
  for (const addition of faceTags.additions) {
    const photo = photosById.get(addition.photoId);
    invariant(
      photo,
      `reviewed face tag references missing photo ${addition.photoId}`,
    );
    invariant(
      photo.originalRelativePath === addition.path,
      `reviewed face tag path drift for ${addition.photoId}`,
    );
    invariant(
      peopleBySlug.has(addition.personSlug),
      `reviewed face tag references missing person ${addition.personSlug}`,
    );
    if (photo.peopleSlugs.includes(addition.personSlug)) {
      faceTagsAlreadyPresent += 1;
      continue;
    }
    photo.peopleSlugs.push(addition.personSlug);
    photo.peopleSlugs.sort();
    faceTagsAdded += 1;
  }

  // Removals run after additions so the photoCount recount below sees the
  // final state, and so an add/remove disagreement is caught by validation
  // rather than resolved silently by ordering.
  let faceTagsRemoved = 0;
  let faceTagsAlreadyAbsent = 0;
  for (const removal of faceTagRemovals?.removals ?? []) {
    const photo = photosById.get(removal.photoId);
    invariant(
      photo,
      `reviewed face tag removal references missing photo ${removal.photoId}`,
    );
    invariant(
      photo.originalRelativePath === removal.path,
      `reviewed face tag removal path drift for ${removal.photoId}`,
    );
    const index = photo.peopleSlugs.indexOf(removal.personSlug);
    if (index === -1) {
      faceTagsAlreadyAbsent += 1;
      continue;
    }
    photo.peopleSlugs.splice(index, 1);
    faceTagsRemoved += 1;
  }

  const counts = new Map(catalog.people.map((person) => [person.slug, 0]));
  for (const photo of catalog.photos) {
    for (const slug of photo.peopleSlugs) {
      invariant(counts.has(slug), `photo ${photo.id} references unknown person ${slug}`);
      counts.set(slug, counts.get(slug) + 1);
    }
  }
  for (const person of catalog.people) {
    person.photoCount = counts.get(person.slug);
  }
  catalog.people.sort((a, b) => a.name.localeCompare(b.name, "en-US"));
  if (catalog.stats && typeof catalog.stats === "object") {
    catalog.stats.people = catalog.people.length;
  }

  return {
    attendanceCount: attendance.attendees.length,
    peopleAdded,
    peopleTotal: catalog.people.length,
    reviewedFaceTags: faceTags.additions.length,
    faceTagsAdded,
    faceTagsAlreadyPresent,
    reviewedFaceTagRemovals: faceTagRemovals?.removals?.length ?? 0,
    faceTagsRemoved,
    faceTagsAlreadyAbsent,
  };
}

export async function applyTrackedCatalogOverlays(catalog, repoRoot) {
  const [attendance, faceTags] = await Promise.all([
    fs
      .readFile(join(repoRoot, ATTENDANCE_PATH), "utf8")
      .then((value) => JSON.parse(value)),
    fs
      .readFile(join(repoRoot, FACE_TAGS_PATH), "utf8")
      .then((value) => JSON.parse(value)),
  ]);
  // Optional: no removals file means no removals, which is how this repo
  // behaved before removals existed.
  const faceTagRemovals = await fs
    .readFile(join(repoRoot, FACE_TAG_REMOVALS_PATH), "utf8")
    .then((value) => JSON.parse(value))
    .catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  return applyCatalogOverlays(catalog, attendance, faceTags, faceTagRemovals);
}
