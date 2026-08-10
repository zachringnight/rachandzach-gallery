"use client";

import { Check, Search, UserRoundPlus, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { PhotoImage } from "@/components/gallery/PhotoImage";
import type { AdminCatalogPhoto, CatalogOption } from "@/lib/admin/catalog";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

interface PhotoPeopleTaggerProps {
  photo: AdminCatalogPhoto;
  people: CatalogOption[];
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

interface SaveResponse {
  error?: string;
  failed?: number;
  results?: Array<{ photoId: string; ok: boolean; error?: string }>;
}

function setFrom(values: Iterable<string>): Set<string> {
  return new Set(values);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join("");
}

/**
 * Admin-only, single-photo people editor. It deliberately sends additive and
 * subtractive deltas instead of replacing the complete join set, so a stale
 * browser cannot erase an unrelated tag that landed concurrently.
 */
export function PhotoPeopleTagger({
  photo,
  people,
  returnFocusRef,
  onClose,
  onSaved,
}: PhotoPeopleTaggerProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const previousFocus = useRef<Element | null>(null);
  const initialSlugs = useMemo(
    () => setFrom(photo.people.map((person) => person.slug)),
    [photo.people],
  );
  const [selectedSlugs, setSelectedSlugs] = useState<ReadonlySet<string>>(() =>
    setFrom(initialSlugs),
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => {
    const bySlug = new Map(people.map((person) => [person.slug, person]));
    for (const person of photo.people) {
      if (!bySlug.has(person.slug)) {
        bySlug.set(person.slug, {
          slug: person.slug,
          name: person.displayName,
        });
      }
    }
    return [...bySlug.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "en-US"),
    );
  }, [people, photo.people]);

  const optionBySlug = useMemo(
    () => new Map(options.map((person) => [person.slug, person])),
    [options],
  );

  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter((person) =>
      `${person.name}\n${person.slug}`.toLocaleLowerCase().includes(needle),
    );
  }, [options, query]);

  const selectedPeople = useMemo(
    () =>
      [...selectedSlugs]
        .map((slug) => optionBySlug.get(slug))
        .filter((person): person is CatalogOption => Boolean(person))
        .sort((left, right) => left.name.localeCompare(right.name, "en-US")),
    [optionBySlug, selectedSlugs],
  );

  const addedSlugs = useMemo(
    () => [...selectedSlugs].filter((slug) => !initialSlugs.has(slug)),
    [initialSlugs, selectedSlugs],
  );
  const removedSlugs = useMemo(
    () => [...initialSlugs].filter((slug) => !selectedSlugs.has(slug)),
    [initialSlugs, selectedSlugs],
  );
  const changeCount = addedSlugs.length + removedSlugs.length;

  useEffect(() => {
    previousFocus.current =
      returnFocusRef.current ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    searchRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (
        previousFocus.current instanceof HTMLElement &&
        previousFocus.current.isConnected
      ) {
        previousFocus.current.focus();
      }
    };
  }, [returnFocusRef]);

  const toggle = (slug: string) => {
    setSelectedSlugs((current) => {
      const next = setFrom(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
    setError(null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !saving) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const save = async () => {
    if (changeCount === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/catalog", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          photoIds: [photo.id],
          addPeopleSlugs: addedSlugs,
          removePeopleSlugs: removedSlugs,
          addKeywords: [],
          removeKeywords: [],
        }),
      });
      const result = (await response.json()) as SaveResponse;
      const photoResult = result.results?.find(
        (item) => item.photoId === photo.id,
      );
      if (
        !response.ok ||
        (result.failed ?? 0) > 0 ||
        photoResult?.ok === false
      ) {
        throw new Error(
          photoResult?.error ??
            result.error ??
            "Could not save these people tags.",
        );
      }
      await onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save these people tags.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="atlas-people-tagger-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="atlas-people-tagger"
        role="dialog"
        aria-modal="true"
        aria-labelledby="people-tagger-title"
        aria-describedby="people-tagger-help"
        onKeyDown={handleKeyDown}
      >
        <figure className="atlas-people-tagger-figure">
          <PhotoImage
            photo={photo}
            alt={`Tag people in ${photo.originalFilename}`}
            tier="lightbox"
            loading="eager"
            fetchPriority="high"
            className="atlas-people-tagger-photo"
            imageClassName="h-full w-full object-contain"
          />
          <figcaption>
            <span>{photo.eventName || "Unassigned event"}</span>
            <strong>{photo.originalFilename}</strong>
          </figcaption>
        </figure>

        <section className="atlas-people-tagger-panel">
          <header className="atlas-people-tagger-heading">
            <div>
              <p>Photo names</p>
              <h2 id="people-tagger-title">Who is in this photo?</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label="Close people tagger"
            >
              <X aria-hidden="true" size={18} strokeWidth={1.7} />
            </button>
          </header>

          <p id="people-tagger-help" className="atlas-people-tagger-help">
            Check every person you recognize. Unchecking a current name removes
            only that name from this photo.
          </p>

          <div className="atlas-people-tagger-current">
            <div>
              <span>Tagged now</span>
              <strong>{selectedPeople.length}</strong>
            </div>
            {selectedPeople.length > 0 ? (
              <ul aria-label="People currently selected">
                {selectedPeople.map((person) => (
                  <li key={person.slug}>
                    <button
                      type="button"
                      onClick={() => toggle(person.slug)}
                      aria-label={`Remove ${person.name}`}
                    >
                      {person.name}
                      <X aria-hidden="true" size={12} strokeWidth={1.8} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No one tagged yet.</p>
            )}
          </div>

          <label className="atlas-people-tagger-search">
            <Search aria-hidden="true" size={17} strokeWidth={1.6} />
            <span className="sr-only">Search people</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the guest list"
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                aria-label="Clear people search"
              >
                <X aria-hidden="true" size={15} strokeWidth={1.7} />
              </button>
            ) : null}
          </label>

          <div
            className="atlas-people-tagger-list"
            role="group"
            aria-label="People"
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((person) => {
                const selected = selectedSlugs.has(person.slug);
                return (
                  <label
                    key={person.slug}
                    className="atlas-people-tagger-option"
                    data-selected={selected ? "true" : "false"}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggle(person.slug)}
                    />
                    <span aria-hidden="true">
                      {selected ? (
                        <Check size={15} strokeWidth={2} />
                      ) : (
                        initials(person.name)
                      )}
                    </span>
                    <strong>{person.name}</strong>
                    <small>{selected ? "Tagged" : "Add"}</small>
                  </label>
                );
              })
            ) : (
              <div className="atlas-people-tagger-empty">
                <UserRoundPlus aria-hidden="true" size={22} strokeWidth={1.5} />
                <p>No one matches “{query.trim()}”.</p>
                <span>Add missing guests in Guests &amp; faces first.</span>
              </div>
            )}
          </div>

          {error ? (
            <p className="atlas-people-tagger-error" role="alert">
              {error}
            </p>
          ) : null}

          <footer className="atlas-people-tagger-actions">
            <p aria-live="polite">
              {changeCount === 0
                ? "No unsaved changes"
                : `${changeCount} unsaved ${changeCount === 1 ? "change" : "changes"}`}
            </p>
            <div>
              <button type="button" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || changeCount === 0}
                className="atlas-people-tagger-save"
              >
                {saving ? "Saving…" : "Save people"}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
