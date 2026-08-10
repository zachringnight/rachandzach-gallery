"use client";

import {
  Calendar,
  Check,
  Grid3X3,
  Images,
  Minus,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  Tags,
  UserRound,
  UserRoundPlus,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import type {
  AdminCatalogFilters,
  AdminCatalogNeeds,
  AdminCatalogPage,
  AdminCatalogPhoto,
  CatalogOption,
} from "@/lib/admin/catalog";
import { ADMIN_CATALOG_MAX_SELECTION } from "@/lib/admin/catalog";
import { PhotoImage } from "@/components/gallery/PhotoImage";
import { PhotoPeopleTagger } from "@/components/admin/PhotoPeopleTagger";
import { CopyCurrentViewButton } from "@/components/ui/CopyCurrentViewButton";

export interface CatalogTaggerProps {
  initialPage: AdminCatalogPage;
  initialFilters: AdminCatalogFilters;
  initialView?: CatalogViewMode;
  events: CatalogOption[];
  people: CatalogOption[];
}

export type CatalogViewMode = "grid" | "table";
type PersonOperation = "add" | "remove";
type KeywordOperation = "add" | "remove";
type Notice =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string }
  | null;

const NEEDS_OPTIONS: Array<{ value: AdminCatalogNeeds; label: string }> = [
  { value: "all", label: "All metadata" },
  { value: "missing-people", label: "Missing people" },
  { value: "missing-keywords", label: "Missing keywords" },
  { value: "missing-event", label: "Missing event" },
  { value: "complete", label: "Complete" },
];

function catalogUrl(
  filters: AdminCatalogFilters,
  cursor: string | null = null,
): string {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.needs !== "all") params.set("needs", filters.needs);
  if (filters.event) params.set("event", filters.event);
  if (filters.person) params.set("person", filters.person);
  if (filters.source) params.set("source", filters.source);
  if (filters.sort !== "weekend") params.set("sort", filters.sort);
  if (cursor) params.set("cursor", cursor);
  return `/api/admin/catalog?${params.toString()}`;
}

function catalogPageUrl(
  filters: AdminCatalogFilters,
  view: CatalogViewMode,
): string {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.needs !== "all") params.set("needs", filters.needs);
  if (filters.event) params.set("event", filters.event);
  if (filters.person) params.set("person", filters.person);
  if (filters.source) params.set("source", filters.source);
  if (filters.sort !== "weekend") params.set("sort", filters.sort);
  if (view !== "grid") params.set("view", view);
  const query = params.toString();
  return query ? `/admin/catalog?${query}` : "/admin/catalog";
}

function completenessLabel(photo: AdminCatalogPhoto): string {
  if (photo.completeness === "complete") return "Ready";
  if (photo.completeness === "missing-event") return "Needs event";
  if (photo.completeness === "missing-people") return "Needs people";
  if (photo.completeness === "missing-keywords") return "Needs keywords";
  return "Needs attention";
}

function photoLabel(photo: AdminCatalogPhoto): string {
  const names = photo.people.map((person) => person.displayName).join(", ");
  return names
    ? `${photo.eventName || "Unassigned"} with ${names}`
    : photo.eventName || photo.originalFilename;
}

export function CatalogTagger({
  initialPage,
  initialFilters,
  initialView = "grid",
  events,
  people,
}: CatalogTaggerProps) {
  const [filters, setFilters] =
    useState<AdminCatalogFilters>(initialFilters);
  const [queryDraft, setQueryDraft] = useState(initialFilters.query);
  const [viewMode, setViewMode] = useState<CatalogViewMode>(initialView);
  const [page, setPage] = useState(initialPage);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [taggingPhotoId, setTaggingPhotoId] = useState<string | null>(null);
  const [eventMode, setEventMode] = useState("unchanged");
  const [personSlug, setPersonSlug] = useState("");
  const [personOperation, setPersonOperation] =
    useState<PersonOperation>("add");
  const [keyword, setKeyword] = useState("");
  const [keywordOperation, setKeywordOperation] =
    useState<KeywordOperation>("add");
  const requestSeq = useRef(0);
  const taggingReturnFocus = useRef<HTMLElement | null>(null);

  const openPeopleTagger = useCallback(
    (photoId: string, trigger: HTMLElement) => {
      taggingReturnFocus.current = trigger;
      setTaggingPhotoId(photoId);
    },
    [],
  );

  const load = useCallback(
    async (
      nextFilters: AdminCatalogFilters,
      options: {
        cursor?: string | null;
        append?: boolean;
        preserveSelection?: boolean;
      } = {},
    ) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setNotice(null);
      if (!options.preserveSelection) setSelected(new Set<string>());
      try {
        const response = await fetch(
          catalogUrl(nextFilters, options.cursor ?? null),
          { cache: "no-store" },
        );
        const body = (await response.json()) as AdminCatalogPage & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? "Could not load the catalog.");
        }
        if (seq !== requestSeq.current) return;
        setPage((current) =>
          options.append
            ? {
                ...body,
                photos: [
                  ...current.photos,
                  ...body.photos.filter(
                    (photo) =>
                      !current.photos.some(
                        (existing) => existing.id === photo.id,
                      ),
                  ),
                ],
              }
            : body,
        );
      } catch (error) {
        if (seq !== requestSeq.current) return;
        setNotice({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not load the catalog.",
        });
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [],
  );

  const updateFilters = useCallback(
    (patch: Partial<AdminCatalogFilters>) => {
      const next = { ...filters, ...patch };
      setFilters(next);
      window.history.replaceState({}, "", catalogPageUrl(next, viewMode));
      void load(next);
    },
    [filters, load, viewMode],
  );

  const togglePhoto = useCallback(
    (photoId: string) => {
      const next = new Set(selected);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else if (next.size < ADMIN_CATALOG_MAX_SELECTION) {
        next.add(photoId);
      } else {
        setNotice({
          tone: "error",
          message: `The desk holds up to ${ADMIN_CATALOG_MAX_SELECTION} photos at once.`,
        });
        return;
      }
      setSelected(next);
    },
    [selected],
  );

  const selectLoaded = useCallback(() => {
    const next = new Set(selected);
    let reachedLimit = false;
    for (const photo of page.photos) {
      if (next.has(photo.id)) continue;
      if (next.size >= ADMIN_CATALOG_MAX_SELECTION) {
        reachedLimit = true;
        break;
      }
      next.add(photo.id);
    }
    setSelected(next);
    if (reachedLimit) {
      setNotice({
        tone: "error",
        message: `The desk holds up to ${ADMIN_CATALOG_MAX_SELECTION} photos at once. Your first ${ADMIN_CATALOG_MAX_SELECTION} stay selected.`,
      });
    }
  }, [page.photos, selected]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const taggingPhoto = useMemo(
    () => page.photos.find((photo) => photo.id === taggingPhotoId) ?? null,
    [page.photos, taggingPhotoId],
  );
  const trimmedKeyword = keyword.trim();
  const hasEdit =
    eventMode !== "unchanged" ||
    personSlug.length > 0 ||
    trimmedKeyword.length > 0;

  const save = useCallback(async () => {
    if (selectedIds.length === 0 || !hasEdit) return;
    setSaving(true);
    setNotice(null);
    const body = {
      photoIds: selectedIds,
      ...(eventMode === "unchanged"
        ? {}
        : { eventSlug: eventMode === "clear" ? null : eventMode }),
      addPeopleSlugs:
        personSlug && personOperation === "add" ? [personSlug] : [],
      removePeopleSlugs:
        personSlug && personOperation === "remove" ? [personSlug] : [],
      addKeywords:
        trimmedKeyword && keywordOperation === "add"
          ? [trimmedKeyword]
          : [],
      removeKeywords:
        trimmedKeyword && keywordOperation === "remove"
          ? [trimmedKeyword]
          : [],
    };
    try {
      const response = await fetch("/api/admin/catalog", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        error?: string;
        updated?: number;
        failed?: number;
        results?: Array<{ photoId: string; ok: boolean }>;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Could not save those tags.");
      }
      const failedIds = new Set(
        (result.results ?? [])
          .filter((item) => !item.ok)
          .map((item) => item.photoId),
      );
      if (failedIds.size === 0) {
        setEventMode("unchanged");
        setPersonSlug("");
        setKeyword("");
      }
      await load(filters, { preserveSelection: true });
      setSelected(failedIds);
      setNotice({
        tone: failedIds.size > 0 ? "error" : "success",
        message:
          failedIds.size > 0
            ? `Updated ${result.updated ?? 0}. ${failedIds.size} still need another try.`
            : `Updated ${result.updated ?? selectedIds.length} ${
                selectedIds.length === 1 ? "photo" : "photos"
              }.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not save those tags.",
      });
    } finally {
      setSaving(false);
    }
  }, [
    eventMode,
    filters,
    hasEdit,
    keywordOperation,
    load,
    personOperation,
    personSlug,
    selectedIds,
    trimmedKeyword,
  ]);

  return (
    <>
      <section
        className="atlas-catalog"
        inert={taggingPhoto ? true : undefined}
        aria-hidden={taggingPhoto ? "true" : undefined}
      >
      <header className="atlas-catalog-heading">
        <div>
          <p>The archive desk</p>
          <h1>Catalog tags</h1>
        </div>
        <div className="atlas-catalog-heading-copy">
          <p>
            Keep the names, events, and search words behind every guest page
            accurate.
          </p>
          <strong>{page.total.toLocaleString()} matching photos</strong>
        </div>
      </header>

      <form
        className="atlas-catalog-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const next = { ...filters, query: queryDraft.trim() };
          setFilters(next);
          window.history.replaceState({}, "", catalogPageUrl(next, viewMode));
          void load(next);
        }}
      >
        <label className="atlas-catalog-search">
          <span className="sr-only">
            Search filenames, people, events, or keywords
          </span>
          <Search aria-hidden="true" size={17} strokeWidth={1.6} />
          <input
            type="search"
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="Search names, events, filenames, keywords"
          />
          <button type="submit">Search</button>
        </label>

        <label>
          <span>Tag status</span>
          <select
            value={filters.needs}
            onChange={(event) =>
              updateFilters({
                needs: event.target.value as AdminCatalogNeeds,
              })
            }
          >
            {NEEDS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Event</span>
          <select
            value={filters.event ?? ""}
            onChange={(event) =>
              updateFilters({ event: event.target.value || null })
            }
          >
            <option value="">Every event</option>
            {events.map((event) => (
              <option key={event.slug} value={event.slug}>
                {event.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Person</span>
          <select
            value={filters.person ?? ""}
            onChange={(event) =>
              updateFilters({ person: event.target.value || null })
            }
          >
            <option value="">Everyone</option>
            {people.map((person) => (
              <option key={person.slug} value={person.slug}>
                {person.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Source</span>
          <select
            value={filters.source ?? ""}
            onChange={(event) =>
              updateFilters({
                source:
                  event.target.value === "photographer" ||
                  event.target.value === "guest"
                    ? event.target.value
                    : null,
              })
            }
          >
            <option value="">Every source</option>
            <option value="photographer">Photographer</option>
            <option value="guest">Guests</option>
          </select>
        </label>

        <label>
          <span>Order</span>
          <select
            value={filters.sort}
            onChange={(event) =>
              updateFilters({
                sort: event.target.value === "newest" ? "newest" : "weekend",
              })
            }
          >
            <option value="weekend">Weekend order</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
      </form>

      {notice ? (
        <p
          className="atlas-catalog-notice"
          data-tone={notice.tone}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}

      <div className="atlas-catalog-workspace">
        <div className="atlas-catalog-contact-sheet" aria-busy={loading}>
          <div className="atlas-catalog-sheet-actions">
            <p>
              {selectedIds.length > 0
                ? `${selectedIds.length.toLocaleString()} selected`
                : "Select frames to edit together"}
            </p>
            <div>
              <div
                className="atlas-catalog-view-switch"
                role="group"
                aria-label="Catalog view"
              >
                <button
                  type="button"
                  onClick={() => {
                    setViewMode("grid");
                    window.history.replaceState(
                      {},
                      "",
                      catalogPageUrl(filters, "grid"),
                    );
                  }}
                  aria-label="Contact sheet view"
                  aria-pressed={viewMode === "grid"}
                  title="Contact sheet view"
                >
                  <Grid3X3 aria-hidden="true" size={15} strokeWidth={1.6} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode("table");
                    window.history.replaceState(
                      {},
                      "",
                      catalogPageUrl(filters, "table"),
                    );
                  }}
                  aria-label="Table view"
                  aria-pressed={viewMode === "table"}
                  title="Table view"
                >
                  <Rows3 aria-hidden="true" size={16} strokeWidth={1.6} />
                </button>
              </div>
              <button type="button" onClick={selectLoaded}>
                <Images aria-hidden="true" size={15} strokeWidth={1.6} />
                Select loaded
              </button>
              <CopyCurrentViewButton />
              <button
                type="button"
                onClick={() => void load(filters)}
                disabled={loading}
              >
                <RefreshCw aria-hidden="true" size={15} strokeWidth={1.6} />
                Refresh
              </button>
            </div>
          </div>

          {page.photos.length > 0 ? (
            viewMode === "grid" ? (
              <ol className="atlas-catalog-grid">
                {page.photos.map((photo, index) => {
                  const isSelected = selected.has(photo.id);
                  return (
                    <li
                      key={photo.id}
                      className="atlas-catalog-card"
                      data-selected={isSelected ? "true" : "false"}
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSelected}
                        aria-label={`${isSelected ? "Deselect" : "Select"} ${photoLabel(photo)}`}
                        onClick={() => togglePhoto(photo.id)}
                        className="atlas-catalog-image"
                      >
                        <PhotoImage
                          photo={photo}
                          alt={photoLabel(photo)}
                          tier="card"
                          targetWidth={420}
                          className="h-full w-full"
                          imageClassName="h-full w-full object-cover"
                        />
                        <span className="atlas-catalog-check">
                          <Check
                            aria-hidden="true"
                            size={16}
                            strokeWidth={2}
                          />
                        </span>
                      </button>

                      <div className="atlas-catalog-card-copy">
                        <div>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <strong>{photo.eventName || "Unassigned event"}</strong>
                        </div>
                        <p title={photo.originalFilename}>
                          {photo.originalFilename}
                        </p>
                        <dl>
                          <div>
                            <dt>
                              <UserRound
                                aria-label="People"
                                size={13}
                                strokeWidth={1.6}
                              />
                            </dt>
                            <dd>
                              {photo.people.length > 0
                                ? photo.people
                                    .slice(0, 2)
                                    .map((person) => person.displayName)
                                    .join(", ")
                                : "No people"}
                              {photo.people.length > 2
                                ? ` +${photo.people.length - 2}`
                                : ""}
                            </dd>
                          </div>
                          <div>
                            <dt>
                              <Tags
                                aria-label="Keywords"
                                size={13}
                                strokeWidth={1.6}
                              />
                            </dt>
                            <dd>
                              {photo.keywords.length > 0
                                ? photo.keywords.slice(0, 2).join(", ")
                                : "No keywords"}
                              {photo.keywords.length > 2
                                ? ` +${photo.keywords.length - 2}`
                                : ""}
                            </dd>
                          </div>
                        </dl>
                        <div className="atlas-catalog-card-actions">
                          <span
                            className="atlas-catalog-state"
                            data-state={photo.completeness}
                          >
                            {completenessLabel(photo)}
                          </span>
                          <button
                            type="button"
                            onClick={(event) =>
                              openPeopleTagger(photo.id, event.currentTarget)
                            }
                            aria-label={`Tag people in ${photo.originalFilename}`}
                          >
                            <UserRoundPlus
                              aria-hidden="true"
                              size={14}
                              strokeWidth={1.7}
                            />
                            Tag people
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <CatalogTable
                photos={page.photos}
                selected={selected}
                onToggle={togglePhoto}
                onTag={openPeopleTagger}
              />
            )
          ) : (
            <div className="atlas-catalog-empty">
              <p>No photos match this desk.</p>
              <button
                type="button"
                onClick={() => {
                  setQueryDraft("");
                  const next: AdminCatalogFilters = {
                    query: "",
                    needs: "all",
                    event: null,
                    person: null,
                    source: null,
                    sort: "weekend",
                  };
                  setFilters(next);
                  window.history.replaceState(
                    {},
                    "",
                    catalogPageUrl(next, viewMode),
                  );
                  void load(next);
                }}
              >
                Clear the filters
              </button>
            </div>
          )}

          {page.nextCursor ? (
            <button
              type="button"
              className="atlas-catalog-load"
              disabled={loading}
              onClick={() =>
                void load(filters, {
                  cursor: page.nextCursor,
                  append: true,
                  preserveSelection: true,
                })
              }
            >
              {loading ? "Loading…" : "Load the next set"}
            </button>
          ) : null}
        </div>

        <aside className="atlas-catalog-inspector" aria-label="Bulk tag editor">
          <div className="atlas-catalog-inspector-heading">
            <span>{selectedIds.length.toLocaleString()}</span>
            <div>
              <p>{selectedIds.length === 1 ? "frame" : "frames"}</p>
              <strong>on the desk</strong>
            </div>
            {selectedIds.length > 0 ? (
              <button
                type="button"
                onClick={() => setSelected(new Set<string>())}
                aria-label="Clear selected photos"
              >
                <X aria-hidden="true" size={17} strokeWidth={1.6} />
              </button>
            ) : null}
          </div>

          <p className="atlas-catalog-inspector-intro">
            Changes add to each frame. Existing names and keywords stay unless
            you choose remove.
          </p>

          <label className="atlas-catalog-edit-field">
            <span>
              <Calendar aria-hidden="true" size={14} strokeWidth={1.6} />
              Event
            </span>
            <select
              value={eventMode}
              onChange={(event) => setEventMode(event.target.value)}
            >
              <option value="unchanged">Keep each current event</option>
              <option value="clear">Clear the event</option>
              {events.map((event) => (
                <option key={event.slug} value={event.slug}>
                  Set {event.name}
                </option>
              ))}
            </select>
          </label>

          <div className="atlas-catalog-edit-field">
            <label htmlFor="catalog-person">Person</label>
            <select
              id="catalog-person"
              value={personSlug}
              onChange={(event) => setPersonSlug(event.target.value)}
            >
              <option value="">Choose a person</option>
              {people.map((person) => (
                <option key={person.slug} value={person.slug}>
                  {person.name}
                </option>
              ))}
            </select>
            <div className="atlas-catalog-operation">
              <button
                type="button"
                aria-pressed={personOperation === "add"}
                onClick={() => setPersonOperation("add")}
              >
                <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
                Add
              </button>
              <button
                type="button"
                aria-pressed={personOperation === "remove"}
                onClick={() => setPersonOperation("remove")}
              >
                <Minus aria-hidden="true" size={13} strokeWidth={1.8} />
                Remove
              </button>
            </div>
          </div>

          <div className="atlas-catalog-edit-field">
            <label htmlFor="catalog-keyword">Keyword</label>
            <input
              id="catalog-keyword"
              value={keyword}
              maxLength={80}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="first dance"
            />
            <div className="atlas-catalog-operation">
              <button
                type="button"
                aria-pressed={keywordOperation === "add"}
                onClick={() => setKeywordOperation("add")}
              >
                <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
                Add
              </button>
              <button
                type="button"
                aria-pressed={keywordOperation === "remove"}
                onClick={() => setKeywordOperation("remove")}
              >
                <Minus aria-hidden="true" size={13} strokeWidth={1.8} />
                Remove
              </button>
            </div>
          </div>

          <button
            type="button"
            className="atlas-catalog-apply"
            disabled={
              saving || selectedIds.length === 0 || !hasEdit
            }
            onClick={() => void save()}
          >
            {saving
              ? "Saving changes…"
              : `Apply to ${selectedIds.length || 0} ${
                  selectedIds.length === 1 ? "photo" : "photos"
                }`}
          </button>
        </aside>
      </div>
      </section>
      {taggingPhoto ? (
        <PhotoPeopleTagger
          key={taggingPhoto.id}
          photo={taggingPhoto}
          people={people}
          returnFocusRef={taggingReturnFocus}
          onClose={() => setTaggingPhotoId(null)}
          onSaved={async () => {
            await load(filters, { preserveSelection: true });
            setTaggingPhotoId(null);
            setNotice({
              tone: "success",
              message: `Updated people in ${taggingPhoto.originalFilename}.`,
            });
          }}
        />
      ) : null}
    </>
  );
}

function CatalogTable({
  photos,
  selected,
  onToggle,
  onTag,
}: {
  photos: AdminCatalogPhoto[];
  selected: ReadonlySet<string>;
  onToggle: (photoId: string) => void;
  onTag: (photoId: string, trigger: HTMLButtonElement) => void;
}) {
  return (
    <div className="atlas-catalog-table-wrap">
      <table className="atlas-catalog-table">
        <caption className="sr-only">
          Loaded catalog photos and metadata
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Select</span>
            </th>
            <th scope="col">Photo</th>
            <th scope="col">Event</th>
            <th scope="col">People</th>
            <th scope="col">Keywords</th>
            <th scope="col">Source</th>
            <th scope="col">Status</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {photos.map((photo) => {
            const isSelected = selected.has(photo.id);
            return (
              <tr
                key={photo.id}
                data-selected={isSelected ? "true" : "false"}
              >
                <td>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(photo.id)}
                    aria-label={`${isSelected ? "Deselect" : "Select"} ${photoLabel(photo)}`}
                  />
                </td>
                <td>
                  <div className="atlas-catalog-table-photo">
                    <PhotoImage
                      photo={photo}
                      alt=""
                      tier="thumbnail"
                      className="atlas-catalog-table-thumb"
                      imageClassName="h-full w-full object-cover"
                    />
                    <div>
                      <strong title={photo.originalFilename}>
                        {photo.originalFilename}
                      </strong>
                      <span>
                        {photo.orientation} / {photo.width} x {photo.height}
                      </span>
                    </div>
                  </div>
                </td>
                <td>{photo.eventName || "Unassigned"}</td>
                <td>
                  {photo.people.length > 0
                    ? photo.people
                        .map((person) => person.displayName)
                        .join(", ")
                    : "No people"}
                </td>
                <td>
                  {photo.keywords.length > 0
                    ? photo.keywords.join(", ")
                    : "No keywords"}
                </td>
                <td>
                  {photo.source === "guest" ? "Guest" : "Photographer"}
                </td>
                <td>
                  <span
                    className="atlas-catalog-state"
                    data-state={photo.completeness}
                  >
                    {completenessLabel(photo)}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="atlas-catalog-table-tag"
                    onClick={(event) => onTag(photo.id, event.currentTarget)}
                    aria-label={`Tag people in ${photo.originalFilename}`}
                  >
                    <UserRoundPlus
                      aria-hidden="true"
                      size={14}
                      strokeWidth={1.7}
                    />
                    Tag people
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
