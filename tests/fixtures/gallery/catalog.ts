/**
 * Deterministic in-memory gallery catalog for packet 06 query tests.
 *
 * No live database: this builds a GalleryDataSource over synthetic rows. The
 * generator is seeded (mulberry32) so every run produces the identical catalog,
 * which is what makes cursor-paging and facet assertions reproducible.
 *
 * The fixture deliberately includes:
 *  - a full 1,721 approved-photo catalog across 14 events,
 *  - non-approved rows (pending / hidden / rejected) that must never surface,
 *  - null and tied capture times (exercise the multi-level comparator),
 *  - a person ("ghost") tagged only as uncertain/background (confirmed-only),
 *  - uncertain/background links alongside confirmed ones on approved photos.
 */
import type {
  GalleryDataSource,
  GalleryEventMeta,
  GalleryOrientation,
  GalleryPersonLink,
  GalleryPersonMeta,
  GalleryPhotoSource,
  GalleryPreviewObject,
  GallerySource,
} from "@/lib/gallery/query";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EVENT_COUNT = 14;
const PERSON_COUNT = 24;

function buildEvents(): GalleryEventMeta[] {
  return Array.from({ length: EVENT_COUNT }, (_, i) => ({
    slug: `event-${String(i).padStart(2, "0")}`,
    name: `Event ${i}`,
    order: i,
  }));
}

function buildPeople(): GalleryPersonMeta[] {
  const people = Array.from({ length: PERSON_COUNT }, (_, i) => ({
    slug: `person-${String(i).padStart(2, "0")}`,
    displayName: `Person ${i}`,
  }));
  // A person who is only ever an uncertain/background tag, never confirmed.
  people.push({ slug: "ghost", displayName: "Ghost Guest" });
  return people;
}

function orientationFor(rng: number): {
  orientation: GalleryOrientation;
  width: number;
  height: number;
} {
  if (rng < 0.45) return { orientation: "landscape", width: 6000, height: 4000 };
  if (rng < 0.85) return { orientation: "portrait", width: 4000, height: 6000 };
  return { orientation: "square", width: 4000, height: 4000 };
}

function previewsFor(id: string): GalleryPreviewObject[] {
  return [
    {
      objectPath: `previews/${id}/640.webp`,
      bucket: "rachandzach-previews",
      width: 640,
      format: "webp",
    },
    {
      objectPath: `previews/${id}/1280.webp`,
      bucket: "rachandzach-previews",
      width: 1280,
      format: "webp",
    },
  ];
}

export interface GalleryFixture {
  dataSource: GalleryDataSource;
  photos: GalleryPhotoSource[];
  approved: GalleryPhotoSource[];
  events: GalleryEventMeta[];
  people: GalleryPersonMeta[];
  approvedIds: string[];
  pendingId: string;
  hiddenId: string;
  rejectedId: string;
  /** person-00 is confirmed on many photos. */
  confirmedPersonSlug: string;
  /** never confirmed anywhere -> zero facet count, zero filter matches. */
  ghostPersonSlug: string;
}

export function buildGalleryFixture(
  approvedCount = 1721,
  seed = 0x0719c0,
): GalleryFixture {
  const rng = mulberry32(seed);
  const events = buildEvents();
  const people = buildPeople();
  const photos: GalleryPhotoSource[] = [];

  const baseTime = Date.UTC(2025, 6, 18, 12, 0, 0); // 2025-07-18T12:00:00Z

  for (let n = 0; n < approvedCount; n++) {
    const eventIndex = Math.floor(rng() * EVENT_COUNT);
    const event = events[eventIndex];
    const shape = orientationFor(rng());
    const id = `photo-${String(n).padStart(5, "0")}`;

    // ~12% have no capture time; the rest are bucketed to the minute so many
    // photos share a capturedAt, forcing filename+id tiebreaks to matter.
    let capturedAt: string | null = null;
    if (rng() > 0.12) {
      const dayOffset = event.order * 6 * 3600 * 1000;
      const minuteBucket = Math.floor(rng() * 240) * 60 * 1000;
      capturedAt = new Date(baseTime + dayOffset + minuteBucket).toISOString();
    }

    const confirmed: GalleryPersonLink[] = [];
    const confirmedCount = Math.floor(rng() * 4); // 0..3
    for (let k = 0; k < confirmedCount; k++) {
      const personIndex = Math.floor(rng() * PERSON_COUNT);
      const slug = `person-${String(personIndex).padStart(2, "0")}`;
      if (!confirmed.some((p) => p.slug === slug)) {
        confirmed.push({
          slug,
          displayName: `Person ${personIndex}`,
          confidence: "confirmed",
        });
      }
    }
    // Ensure person-00 is genuinely confirmed on a meaningful share.
    if (n % 5 === 0 && !confirmed.some((p) => p.slug === "person-00")) {
      confirmed.push({
        slug: "person-00",
        displayName: "Person 0",
        confidence: "confirmed",
      });
    }

    const links: GalleryPersonLink[] = [...confirmed];
    // Sprinkle non-confirmed links, including the ghost, that must be ignored.
    if (rng() < 0.3) {
      links.push({
        slug: "ghost",
        displayName: "Ghost Guest",
        confidence: rng() < 0.5 ? "background" : "uncertain",
      });
    }
    if (rng() < 0.2) {
      links.push({
        slug: "person-01",
        displayName: "Person 1",
        confidence: "uncertain",
      });
    }

    const source: GallerySource = rng() < 0.1 ? "guest" : "photographer";

    photos.push({
      id,
      status: "published",
      source,
      eventSlug: event.slug,
      eventName: event.name,
      eventOrder: event.order,
      capturedAt,
      originalFilename: `IMG_${String(n).padStart(5, "0")}.JPG`,
      width: shape.width,
      height: shape.height,
      orientation: shape.orientation,
      people: links,
      keywords: eventIndex % 3 === 0 ? ["ceremony"] : ["reception"],
      previews: previewsFor(id),
    });
  }

  const approved = [...photos];
  const approvedIds = approved.map((p) => p.id);

  // Non-approved rows that must never surface anywhere.
  const nonApproved: Array<{ id: string; status: string }> = [
    { id: "pending-0001", status: "pending" },
    { id: "pending-0002", status: "pending" },
    { id: "hidden-0001", status: "hidden" },
    { id: "rejected-0001", status: "rejected" },
  ];
  for (const { id, status } of nonApproved) {
    photos.push({
      id,
      status,
      source: "guest",
      eventSlug: events[0].slug,
      eventName: events[0].name,
      eventOrder: events[0].order,
      capturedAt: new Date(baseTime).toISOString(),
      originalFilename: `${id}.JPG`,
      width: 4000,
      height: 6000,
      orientation: "portrait",
      people: [
        { slug: "person-00", displayName: "Person 0", confidence: "confirmed" },
      ],
      keywords: ["pending"],
      previews: previewsFor(id),
    });
  }

  const dataSource: GalleryDataSource = {
    async listPhotos() {
      return photos;
    },
    async listEvents() {
      return events;
    },
    async listPeople() {
      return people;
    },
  };

  return {
    dataSource,
    photos,
    approved,
    events,
    people,
    approvedIds,
    pendingId: "pending-0001",
    hiddenId: "hidden-0001",
    rejectedId: "rejected-0001",
    confirmedPersonSlug: "person-00",
    ghostPersonSlug: "ghost",
  };
}
