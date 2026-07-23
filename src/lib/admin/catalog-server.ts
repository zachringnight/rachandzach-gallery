import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AdminCatalogFilters,
  AdminCatalogPage,
  AdminCatalogPhoto,
  CatalogMetadataPatch,
} from "@/lib/admin/catalog";
import {
  ADMIN_CATALOG_PAGE_SIZE,
  catalogCompleteness,
  filterAdminCatalogPhotos,
} from "@/lib/admin/catalog";
import { recordModerationAction } from "@/lib/moderation/audit";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import type {
  GalleryDataSource,
} from "@/lib/gallery/query";
import { getGalleryPage } from "@/lib/gallery/query";
import { serializeGalleryPage } from "@/lib/gallery/serialize";

type Db = SupabaseClient<Database>;

interface CatalogPhotoRow {
  id: string;
  event_id: string | null;
  status: string;
  submitted_batch_id: string | null;
}

interface CatalogPersonRow {
  photo_id: string;
  person_id: string;
  source: string;
  confidence: string;
}

interface CatalogKeywordRow {
  photo_id: string;
  keyword: string;
}

export interface CatalogMetadataResult {
  photoId: string;
  ok: boolean;
  error?: string;
}

export class CatalogMetadataInputError extends Error {
  readonly status: 404 | 422;

  constructor(message: string, status: 404 | 422 = 422) {
    super(message);
    this.name = "CatalogMetadataInputError";
    this.status = status;
  }
}

export async function loadAdminCatalogPage(
  filters: AdminCatalogFilters,
  cursor: string | null = null,
  client: Db = createAdminClient(),
): Promise<AdminCatalogPage> {
  const source = createSupabaseGalleryDataSource(client);
  const all = await source.listPhotos();
  const filtered = filterAdminCatalogPhotos(all, filters);
  const byId = new Map(filtered.map((photo) => [photo.id, photo]));
  const filteredSource: GalleryDataSource = {
    listPhotos: async () => filtered,
    listEvents: source.listEvents,
    listPeople: source.listPeople,
  };
  const page = await getGalleryPage(
    {
      cursor,
      limit: ADMIN_CATALOG_PAGE_SIZE,
      sort: filters.sort,
    },
    filteredSource,
  );
  const serialized = await serializeGalleryPage(page, client);

  return {
    ...serialized,
    photos: serialized.photos.map((photo): AdminCatalogPhoto => {
      const sourcePhoto = byId.get(photo.id);
      return {
        ...photo,
        originalFilename: sourcePhoto?.originalFilename ?? "Untitled photo",
        completeness: sourcePhoto
          ? catalogCompleteness(sourcePhoto)
          : "needs-attention",
      };
    }),
  };
}

function rowsByPhoto<T extends { photo_id: string }>(
  rows: T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const current = grouped.get(row.photo_id) ?? [];
    current.push(row);
    grouped.set(row.photo_id, current);
  }
  return grouped;
}

function normalizeKeywords(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLocaleLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

async function restorePhotoMetadata(
  db: Db,
  photo: CatalogPhotoRow,
  people: CatalogPersonRow[],
  keywords: CatalogKeywordRow[],
): Promise<void> {
  const photoUpdate = await db
    .from("rachandzach_photos")
    .update({ event_id: photo.event_id })
    .eq("id", photo.id);
  if (photoUpdate.error) throw photoUpdate.error;

  const peopleDelete = await db
    .from("rachandzach_photo_people")
    .delete()
    .eq("photo_id", photo.id);
  if (peopleDelete.error) throw peopleDelete.error;
  if (people.length > 0) {
    const peopleInsert = await db.from("rachandzach_photo_people").insert(
      people.map((row) => ({
        photo_id: row.photo_id,
        person_id: row.person_id,
        source: row.source,
        confidence: row.confidence,
      })),
    );
    if (peopleInsert.error) throw peopleInsert.error;
  }

  const keywordDelete = await db
    .from("rachandzach_photo_keywords")
    .delete()
    .eq("photo_id", photo.id);
  if (keywordDelete.error) throw keywordDelete.error;
  if (keywords.length > 0) {
    const keywordInsert = await db.from("rachandzach_photo_keywords").insert(
      keywords.map((row) => ({
        photo_id: row.photo_id,
        keyword: row.keyword,
      })),
    );
    if (keywordInsert.error) throw keywordInsert.error;
  }
}

export async function applyCatalogMetadataPatch(
  patch: CatalogMetadataPatch,
  actorUserId: string,
  db: Db = createAdminClient(),
): Promise<CatalogMetadataResult[]> {
  const [{ data: photosData, error: photosError }, { data: peopleCatalog, error: peopleError }] =
    await Promise.all([
      db
        .from("rachandzach_photos")
        .select("id, event_id, status, submitted_batch_id")
        .in("id", patch.photoIds),
      db
        .from("rachandzach_people")
        .select("id, slug"),
    ]);
  if (photosError || peopleError) {
    throw new Error("Could not prepare the catalog metadata update.");
  }

  const photos = (photosData ?? []) as CatalogPhotoRow[];
  const published = photos.filter((photo) => photo.status === "published");
  if (published.length !== patch.photoIds.length) {
    throw new CatalogMetadataInputError(
      "One or more selected photos are no longer available.",
      404,
    );
  }

  const personIdBySlug = new Map(
    (peopleCatalog ?? []).map((person) => [person.slug, person.id]),
  );
  const requestedPeople = [
    ...patch.addPeopleSlugs,
    ...patch.removePeopleSlugs,
  ];
  const missingPerson = requestedPeople.find(
    (slug) => !personIdBySlug.has(slug),
  );
  if (missingPerson) {
    throw new CatalogMetadataInputError(
      `The person tag "${missingPerson}" no longer exists.`,
    );
  }

  let eventId: string | null | undefined;
  if (patch.eventSlug !== undefined) {
    if (patch.eventSlug === null) {
      eventId = null;
    } else {
      const { data: event, error } = await db
        .from("rachandzach_events")
        .select("id")
        .eq("slug", patch.eventSlug)
        .maybeSingle();
      if (error) throw new Error("Could not look up the selected event.");
      if (!event) {
        throw new CatalogMetadataInputError(
          `The event "${patch.eventSlug}" no longer exists.`,
        );
      }
      eventId = event.id;
    }
  }

  const [
    { data: existingPeopleData, error: existingPeopleError },
    { data: existingKeywordsData, error: existingKeywordsError },
  ] = await Promise.all([
    db
      .from("rachandzach_photo_people")
      .select("photo_id, person_id, source, confidence")
      .in("photo_id", patch.photoIds),
    db
      .from("rachandzach_photo_keywords")
      .select("photo_id, keyword")
      .in("photo_id", patch.photoIds),
  ]);
  if (existingPeopleError || existingKeywordsError) {
    throw new Error("Could not read the selected photos' metadata.");
  }

  const existingPeople = rowsByPhoto(
    (existingPeopleData ?? []) as CatalogPersonRow[],
  );
  const existingKeywords = rowsByPhoto(
    (existingKeywordsData ?? []) as CatalogKeywordRow[],
  );
  const addPersonIds = patch.addPeopleSlugs.map(
    (slug) => personIdBySlug.get(slug)!,
  );
  const removePersonIds = patch.removePeopleSlugs.map(
    (slug) => personIdBySlug.get(slug)!,
  );
  const slugByPersonId = new Map(
    (peopleCatalog ?? []).map((person) => [person.id, person.slug]),
  );
  const results: CatalogMetadataResult[] = [];

  for (const photoId of patch.photoIds) {
    const photo = published.find((row) => row.id === photoId)!;
    const beforePeople = existingPeople.get(photoId) ?? [];
    const beforeKeywords = existingKeywords.get(photoId) ?? [];
    try {
      if (eventId !== undefined) {
        const update = await db
          .from("rachandzach_photos")
          .update({ event_id: eventId })
          .eq("id", photoId);
        if (update.error) throw update.error;
      }

      if (removePersonIds.length > 0) {
        const deletion = await db
          .from("rachandzach_photo_people")
          .delete()
          .eq("photo_id", photoId)
          .in("person_id", removePersonIds);
        if (deletion.error) throw deletion.error;
      }
      if (addPersonIds.length > 0) {
        const upsert = await db.from("rachandzach_photo_people").upsert(
          addPersonIds.map((personId) => ({
            photo_id: photoId,
            person_id: personId,
            source: "manual",
            confidence: "confirmed",
          })),
          { onConflict: "photo_id,person_id" },
        );
        if (upsert.error) throw upsert.error;
      }

      if (patch.removeKeywords.length > 0) {
        const deletion = await db
          .from("rachandzach_photo_keywords")
          .delete()
          .eq("photo_id", photoId)
          .in("keyword", patch.removeKeywords);
        if (deletion.error) throw deletion.error;
      }
      if (patch.addKeywords.length > 0) {
        const upsert = await db.from("rachandzach_photo_keywords").upsert(
          patch.addKeywords.map((keyword) => ({
            photo_id: photoId,
            keyword,
          })),
          { onConflict: "photo_id,keyword", ignoreDuplicates: true },
        );
        if (upsert.error) throw upsert.error;
      }

      const afterPeopleIds = new Set(
        beforePeople
          .map((row) => row.person_id)
          .filter((id) => !removePersonIds.includes(id)),
      );
      for (const id of addPersonIds) afterPeopleIds.add(id);
      const afterKeywords = normalizeKeywords([
        ...beforeKeywords
          .map((row) => row.keyword)
          .filter((keyword) => !patch.removeKeywords.includes(keyword)),
        ...patch.addKeywords,
      ]);

      await recordModerationAction(db, {
        batchId: photo.submitted_batch_id,
        itemId: null,
        actorUserId,
        action: "edit_metadata",
        before: {
          photoId,
          eventId: photo.event_id,
          people: beforePeople
            .map((row) => slugByPersonId.get(row.person_id))
            .filter(Boolean),
          keywords: beforeKeywords.map((row) => row.keyword),
        },
        after: {
          photoId,
          eventId: eventId === undefined ? photo.event_id : eventId,
          people: [...afterPeopleIds]
            .map((id) => slugByPersonId.get(id))
            .filter(Boolean),
          keywords: afterKeywords,
        },
      });
      results.push({ photoId, ok: true });
    } catch {
      try {
        await restorePhotoMetadata(
          db,
          photo,
          beforePeople,
          beforeKeywords,
        );
      } catch {
        // The response stays generic. The append-only audit contains no
        // success row, so this photo remains visibly failed in the workbench.
      }
      results.push({
        photoId,
        ok: false,
        error: "Could not save this photo's tags.",
      });
    }
  }

  return results;
}
